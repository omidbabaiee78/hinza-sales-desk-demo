import { supabase } from '../lib/supabaseClient'
import { CLASSIFICATIONS, ROW_ACTIONS } from '../utils/leadImport/duplicateEngine'
import { serializeLeadFieldsForUpdate, serializeLeadForCreate } from './leadPayload'

// "25-50 per batch" per the phase-15B spec - inserts use one multi-row
// INSERT per batch (native, efficient); updates use a bounded Promise.all
// per batch (each lead needs its own .eq('id', ...) filter) - never one
// giant unbounded Promise.all for the whole file.
const INSERT_BATCH_SIZE = 30
const UPDATE_BATCH_SIZE = 25

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
  return chunks
}

// Maps a raw Supabase/Postgres error to a safe, specific Persian category -
// never the raw constraint/message text, which is a technical detail no
// admin should see, but specific enough to actually act on (unlike a single
// generic "ثبت سرنخ جدید با خطا مواجه شد." for every possible failure).
function categorizeDbFailureReason(error) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase()
  if (text.includes('priority')) return 'مقدار اولویت نامعتبر بود.'
  if (text.includes('preferred_channel')) return 'مقدار کانال ترجیحی نامعتبر بود.'
  if (text.includes('loss_reason')) return 'مقدار دلیل از دست رفتن نامعتبر بود.'
  if (text.includes('source_row_number')) return 'شماره ردیف نامعتبر بود.'
  if (text.includes('source')) return 'مقدار منبع نامعتبر بود.'
  if (text.includes('status')) return 'مقدار وضعیت نامعتبر بود.'
  if (text.includes('converted')) return 'اطلاعات تبدیل به مشتری ناسازگار بود.'
  if (text.includes('company_name') || text.includes('contact_name') || text.includes('identity')) {
    return 'اطلاعات اصلی سرنخ (نام شرکت یا شخص تماس) ناقص بود.'
  }
  if (error?.code === '23505') return 'این مقدار در سیستم تکراری است.'
  return 'خطای ثبت در پایگاه داده.'
}

// Never shown to the admin (categorizeDbFailureReason above is what reaches
// the UI) - a dev-console-only trace of the exact payload and Supabase
// error, so a write-contract failure like this can be diagnosed without
// ever exposing raw DB internals in the production UI.
function logDbFailureForDev(context, payload, error) {
  if (!import.meta.env.DEV) return
  console.error(`[leadImport] ${context} failed`, {
    payloadKeys: Object.keys(payload),
    payload,
    supabaseError: { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint },
  })
}

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

// --- Duplicate-engine inputs -------------------------------------------
// Both fetchers below share ONE stable contract:
//   SUCCESS -> resolves to an Array (never undefined, never a raw
//              { data, error } response shape)
//   FAILURE -> throws (a real Supabase error is never swallowed into an
//              empty array - that would silently hide missed duplicates)
// classifyLeadImportRows() is the only consumer and relies on this contract
// instead of re-deriving it per caller.

// Lean, single bulk fetch for the duplicate engine - never one query per row.
// Deliberately narrow columns (no lead_products join, no '*') since this can
// run against a large existing lead bank.
export async function fetchLeadsForDuplicateCheck() {
  const { data, error } = await supabase
    .from('sales_leads')
    .select('id, company_name, contact_name, mobile, phone, email, website, external_ref, status, converted_company_id')
  if (error) throw error
  return data || []
}

// Same contract as fetchLeadsForDuplicateCheck(), for the companies side of
// the duplicate engine - a dedicated fetch (rather than reusing the
// useCompanyDirectory() hook's state) so the import wizard never runs
// classification against a directory that's still mid-load.
export async function fetchExistingCompaniesForDuplicateCheck() {
  const { data, error } = await supabase.from('companies').select('id, name, phone, city, province')
  if (error) throw error
  return data || []
}

export async function createImportBatch({ fileName, sourceLabel, totalRows }) {
  const createdBy = await currentUserId()
  const { data, error } = await supabase
    .from('lead_import_batches')
    .insert({
      file_name: fileName,
      source_label: sourceLabel || null,
      status: 'processing',
      total_rows: totalRows,
      inserted_rows: 0,
      updated_rows: 0,
      skipped_rows: 0,
      invalid_rows: 0,
      created_by: createdBy,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

function computeBatchStatus({ insertedRows, updatedRows, invalidRows, skippedRows, totalRows }) {
  const written = insertedRows + updatedRows
  if (written === 0 && totalRows > 0) return 'failed'
  if (invalidRows > 0 || skippedRows > 0) return 'partial'
  return 'completed'
}

async function finalizeImportBatch(batchId, counts) {
  const status = computeBatchStatus(counts)
  const { error } = await supabase
    .from('lead_import_batches')
    .update({
      inserted_rows: counts.insertedRows,
      updated_rows: counts.updatedRows,
      skipped_rows: counts.skippedRows,
      invalid_rows: counts.invalidRows,
      status,
    })
    .eq('id', batchId)
  if (error) throw error
  return status
}

// Runs the confirmed import: creates new leads, safely updates matched
// leads (only fields present in that row), tracks batch counters, and never
// touches lead_activities/lead_products/conversion fields for existing
// leads - the safe-update rule from the spec.
//
// `rows` is trusted to already be an array (it's always the hook's `rows`
// state, itself only ever set from classifyLeadImportRows()'s output), but
// per the same audit that added the duplicate-engine's Array.isArray guard,
// this boundary gets the identical treatment - a bad caller degrades to
// "nothing to import" instead of throwing on the first .filter() call.
export async function runLeadImport({ rows, batchId, onProgress }) {
  const safeRows = Array.isArray(rows) ? rows : []
  const createdBy = await currentUserId()

  const toCreate = safeRows.filter((r) => r.action === ROW_ACTIONS.CREATE && r.classification !== CLASSIFICATIONS.ERROR)
  const toUpdate = safeRows.filter((r) => r.action === ROW_ACTIONS.UPDATE && r.matchedLeadId)
  const skippedRows = safeRows.filter((r) => r.action === ROW_ACTIONS.SKIP && r.classification !== CLASSIFICATIONS.ERROR).length
  const invalidRows = safeRows.filter((r) => r.classification === CLASSIFICATIONS.ERROR).length

  const total = toCreate.length + toUpdate.length
  let done = 0
  onProgress?.({ done, total })

  let insertedRows = 0
  let updatedRows = 0
  const failures = []

  for (const batch of chunk(toCreate, INSERT_BATCH_SIZE)) {
    const payloads = batch.map((row) =>
      serializeLeadForCreate(row.fields, { createdBy, importBatchId: batchId, sourceRowNumber: row.rowNumber }),
    )
    const { error } = await supabase.from('sales_leads').insert(payloads)
    if (error) {
      // A batch INSERT is all-or-nothing - one bad row fails every row in
      // that batch together, which is exactly what made 24/24 fail as one
      // block. Logged once per failing batch (not per row) to avoid noise.
      logDbFailureForDev('insert', payloads[0], error)
      const reason = categorizeDbFailureReason(error)
      for (const row of batch) failures.push({ rowNumber: row.rowNumber, reason })
    } else {
      insertedRows += batch.length
    }
    done += batch.length
    onProgress?.({ done, total })
  }

  for (const batch of chunk(toUpdate, UPDATE_BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map((row) => {
        const payload = serializeLeadFieldsForUpdate(row.fields, row.presentFields)
        if (Object.keys(payload).length === 0) return Promise.resolve({ row, payload, error: null })
        return supabase
          .from('sales_leads')
          .update(payload)
          .eq('id', row.matchedLeadId)
          .then(({ error }) => ({ row, payload, error }))
      }),
    )
    for (const { row, payload, error } of results) {
      if (error) {
        logDbFailureForDev('update', payload, error)
        failures.push({ rowNumber: row.rowNumber, reason: categorizeDbFailureReason(error) })
      } else {
        updatedRows += 1
      }
    }
    done += batch.length
    onProgress?.({ done, total })
  }

  const counts = { insertedRows, updatedRows, skippedRows, invalidRows: invalidRows + failures.length, totalRows: safeRows.length }
  const status = await finalizeImportBatch(batchId, counts)

  return { insertedRows, updatedRows, skippedRows, invalidRows, failures, status }
}
