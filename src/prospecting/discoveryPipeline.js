// ---------------------------------------------------------------------------
// The DB I/O layer for the Autonomous Prospecting Engine. No Supabase client
// is imported here - every function takes one as its first argument, the
// exact same convention as automation/taskService.js and
// replyIntelligence/replyProcessor.js, so the SAME pipeline runs from the
// admin UI (manual "run now" / upload) or, server-side, from
// supabase/functions/prospect-discovery/index.ts on a daily schedule.
// ---------------------------------------------------------------------------

import { splitContactDisplay, normalizeMobileForComparison, normalizeLandlineForComparison } from '../utils/leadImport/contactNumbers.js'
import { normalizedNameKey, normalizeEmail } from './normalization.js'
import { buildMatchKeys, resolveDuplicate } from './deduplication.js'
import { getSourceAdapter } from './sourceAdapters/index.js'
import { extractEvidence } from './evidenceEngine.js'
import { scoreCandidate } from './scoringEngine.js'
import { qualifyCandidate } from './qualification.js'
import { serializePromotedLead } from './promotion.js'

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

// Only the FIRST number in a possibly multi-number field is used for
// dedup-key purposes - the same accepted simplification
// utils/leadIntelligence.js already uses for lead scoring ("a robustness fix
// for that field shape, not a matching-rule change").
function firstMobileKey(value) {
  const first = splitContactDisplay(value)[0] || value
  return first ? normalizeMobileForComparison(first) || null : null
}
function firstPhoneKey(value) {
  const first = splitContactDisplay(value)[0] || value
  return first ? normalizeLandlineForComparison(first) || null : null
}

function rowToEvidence(row) {
  return { evidenceType: row.evidence_type, value: row.value, weight: Number(row.weight), confidence: row.confidence, sourceUrl: row.source_url }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchProspectSettings(client) {
  const { data, error } = await client.from('prospect_settings').select('*').eq('id', 1).single()
  if (error) throw error
  return data
}

export async function fetchProspectSources(client) {
  const { data, error } = await client.from('prospect_sources').select('*').order('name')
  if (error) throw error
  return data || []
}

async function fetchEnabledSources(client, sourceId) {
  let query = client.from('prospect_sources').select('*').eq('enabled', true)
  if (sourceId) query = query.eq('id', sourceId)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchCandidates(client, { statuses } = {}) {
  let query = client.from('prospect_candidates').select('*, prospect_sources(name, source_type)').order('overall_score', { ascending: false })
  if (statuses?.length) query = query.in('status', statuses)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchCandidateEvidence(client, candidateId) {
  const { data, error } = await client.from('prospect_evidence').select('*').eq('candidate_id', candidateId).order('weight', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToEvidence)
}

export async function fetchDiscoveryRuns(client) {
  const { data, error } = await client
    .from('prospect_discovery_runs')
    .select('*, prospect_sources(name)')
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data || []
}

// Existing sales_leads/companies/prospect_candidates, mapped into the
// generic { kind, id, keys } shape resolveDuplicate() compares against -
// this is THE dedup reference set every new candidate is checked against.
async function fetchDedupRecords(client) {
  const [leadsRes, companiesRes, candidatesRes] = await Promise.all([
    client.from('sales_leads').select('id, company_name, mobile, phone, email, city'),
    client.from('companies').select('id, name'),
    client.from('prospect_candidates').select('id, canonical_name, normalized_name_key, domain, mobile, phone, email, city, source_id, source_external_id').neq('status', 'rejected'),
  ])
  if (leadsRes.error) throw leadsRes.error
  if (companiesRes.error) throw companiesRes.error
  if (candidatesRes.error) throw candidatesRes.error

  const records = []
  for (const lead of leadsRes.data || []) {
    records.push({
      kind: 'lead',
      id: lead.id,
      keys: buildMatchKeys({
        nameKey: normalizedNameKey(lead.company_name),
        mobileKey: firstMobileKey(lead.mobile),
        phoneKey: firstPhoneKey(lead.phone),
        email: normalizeEmail(lead.email),
        city: lead.city || null,
      }),
    })
  }
  for (const company of companiesRes.data || []) {
    records.push({ kind: 'company', id: company.id, keys: buildMatchKeys({ nameKey: normalizedNameKey(company.name) }) })
  }
  for (const candidate of candidatesRes.data || []) {
    records.push({
      kind: 'candidate',
      id: candidate.id,
      keys: buildMatchKeys({
        nameKey: candidate.normalized_name_key,
        domain: candidate.domain,
        mobileKey: firstMobileKey(candidate.mobile),
        phoneKey: firstPhoneKey(candidate.phone),
        email: normalizeEmail(candidate.email),
        city: candidate.city,
        sourceExternalId: candidate.source_id && candidate.source_external_id ? `${candidate.source_id}:${candidate.source_external_id}` : null,
      }),
    })
  }
  return records
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function upsertCandidate(client, payload, sourceExternalId, sourceId) {
  if (sourceExternalId) {
    const { data: existing } = await client
      .from('prospect_candidates')
      .select('id, first_seen_at')
      .eq('source_id', sourceId)
      .eq('source_external_id', sourceExternalId)
      .maybeSingle()
    if (existing) {
      const { data, error } = await client
        .from('prospect_candidates')
        .update({ ...payload, first_seen_at: existing.first_seen_at, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throw error
      return { row: data, created: false }
    }
  }
  const { data, error } = await client.from('prospect_candidates').insert(payload).select('*').single()
  if (error) throw error
  return { row: data, created: true }
}

async function replaceEvidence(client, candidateId, evidence) {
  const { error: deleteError } = await client.from('prospect_evidence').delete().eq('candidate_id', candidateId)
  if (deleteError) throw deleteError
  if (evidence.length === 0) return
  const rows = evidence.map((e) => ({
    candidate_id: candidateId,
    evidence_type: e.evidenceType,
    value: e.value,
    source_url: e.sourceUrl || null,
    weight: e.weight,
    confidence: e.confidence,
  }))
  const { error: insertError } = await client.from('prospect_evidence').insert(rows)
  if (insertError) throw insertError
}

// Never a second write path into sales_leads - reuses the exact same
// serializeLeadForCreate() every manual/import lead creation already uses.
// Idempotent: a candidate already 'promoted' is left untouched.
async function promoteCandidateRow(client, candidateRow, evidence, { createdBy, sourceName }) {
  const leadPayload = serializePromotedLead(candidateRow, evidence, { createdBy, sourceName })
  const { data: lead, error: leadError } = await client.from('sales_leads').insert(leadPayload).select('id').single()
  if (leadError) throw leadError
  const { error: updateError } = await client
    .from('prospect_candidates')
    .update({ status: 'promoted', promoted_lead_id: lead.id, updated_at: new Date().toISOString() })
    .eq('id', candidateRow.id)
  if (updateError) throw updateError
  return lead.id
}

async function processCandidate(client, { rawItem, source, adapter, run, settings, dedupRecords, createdBy, remainingPromotions }) {
  const normalized = adapter.normalize(rawItem, source)
  if (!normalized.canonical_name) {
    throw new Error('candidate is missing a usable company name')
  }

  // Re-discovery of the EXACT same source item (same source_id +
  // source_external_id) across runs is a refresh, never a re-evaluation -
  // an already-promoted or already-duplicate row must never be re-scored
  // or, worse, re-promoted into a second sales_leads row. Cross-entity
  // dedup below only ever runs for a genuinely new item.
  const selfExternalKey = normalized.source_external_id ? `${source.id}:${normalized.source_external_id}` : null
  if (selfExternalKey) {
    const existingSelf = dedupRecords.find((r) => r.kind === 'candidate' && r.keys.sourceExternalId === selfExternalKey)
    if (existingSelf) {
      const { data: updated, error } = await client
        .from('prospect_candidates')
        .update({ last_seen_at: new Date().toISOString(), discovery_run_id: run.id, updated_at: new Date().toISOString() })
        .eq('id', existingSelf.id)
        .select('*')
        .single()
      if (error) throw error
      return { created: false, duplicate: updated.status === 'duplicate', promoted: false }
    }
  }

  const candidateKeys = buildMatchKeys({
    nameKey: normalized.normalized_name_key,
    domain: normalized.domain,
    mobileKey: firstMobileKey(normalized.mobile),
    phoneKey: firstPhoneKey(normalized.phone),
    email: normalizeEmail(normalized.email),
    city: normalized.city,
    sourceExternalId: normalized.source_external_id ? `${source.id}:${normalized.source_external_id}` : null,
  })

  const match = resolveDuplicate(candidateKeys, dedupRecords)
  const nowIso = new Date().toISOString()
  const basePayload = { ...normalized, source_id: source.id, discovery_run_id: run.id, last_seen_at: nowIso }

  if (match?.matchType === 'duplicate') {
    const payload = {
      ...basePayload,
      status: 'duplicate',
      matched_lead_id: match.kind === 'lead' ? match.id : null,
      matched_company_id: match.kind === 'company' ? match.id : null,
      duplicate_of_candidate_id: match.kind === 'candidate' ? match.id : null,
      match_explanation: match.explanation,
    }
    const saved = await upsertCandidate(client, payload, normalized.source_external_id, source.id)
    return { created: saved.created, duplicate: true }
  }

  const evidence = extractEvidence(normalized)
  const scores = scoreCandidate(normalized, evidence)
  const qualification = qualifyCandidate({ candidate: normalized, evidence, scores, settings })

  // A fuzzy (ambiguous) name match ALWAYS forces manual_review, regardless
  // of how strong the qualification signal is - never auto-promoted while
  // a possible duplicate is unresolved.
  const finalStatus = match?.matchType === 'manual_review' ? 'manual_review' : qualification.status

  const payload = {
    ...basePayload,
    relevance_score: scores.relevanceScore,
    contact_quality_score: scores.contactQualityScore,
    overall_score: scores.overallScore,
    confidence: scores.confidence,
    status: finalStatus,
    qualification_reason: finalStatus === 'rejected' ? null : qualification.reason,
    rejection_reason: finalStatus === 'rejected' ? qualification.reason : null,
    matched_lead_id: match?.kind === 'lead' ? match.id : null,
    matched_company_id: match?.kind === 'company' ? match.id : null,
    match_explanation: match?.matchType === 'manual_review' ? match.explanation : null,
  }

  const saved = await upsertCandidate(client, payload, normalized.source_external_id, source.id)
  await replaceEvidence(client, saved.row.id, evidence)

  let promoted = false
  if (qualification.autoPromotable && finalStatus === 'qualified' && remainingPromotions > 0) {
    await promoteCandidateRow(client, saved.row, evidence, { createdBy, sourceName: source.name })
    promoted = true
  }

  return {
    created: saved.created,
    duplicate: false,
    promoted,
    newDedupRecord: { kind: 'candidate', id: saved.row.id, keys: candidateKeys },
  }
}

// ---------------------------------------------------------------------------
// Main entry point - one discovery run across one or all enabled sources.
// Idempotent-by-design: re-running never re-promotes an already-promoted
// candidate, never re-creates a row with the same source+external id, and
// one malformed candidate/source failure never aborts the whole run.
// ---------------------------------------------------------------------------

export async function runDiscovery(client, { sourceId = null, runType = 'manual', uploadedRows = null, createdBy } = {}) {
  const settings = await fetchProspectSettings(client)
  if (!settings.enabled) {
    return { skipped: true, reason: 'موتور کشف مشتری غیرفعال است.' }
  }

  const sources = await fetchEnabledSources(client, sourceId)

  const { data: runRow, error: runError } = await client
    .from('prospect_discovery_runs')
    .insert({ source_id: sourceId, run_type: runType, status: 'running' })
    .select('*')
    .single()
  if (runError) throw runError

  const totals = {
    candidatesFound: 0,
    candidatesCreated: 0,
    candidatesUpdated: 0,
    candidatesPromoted: 0,
    duplicatesDetected: 0,
    errorsCount: 0,
  }
  const sourceSummaries = []
  let dedupRecords = await fetchDedupRecords(client)

  for (const source of sources) {
    try {
      const adapter = getSourceAdapter(source.source_type)
      const rawItems = await adapter.discover(source, { rows: uploadedRows || [] })
      const limit = source.config?.maxCandidatesPerRun ?? settings.max_candidates_per_source_per_run
      const limitedItems = rawItems.slice(0, limit)
      totals.candidatesFound += limitedItems.length

      let sourceErrors = 0
      for (const rawItem of limitedItems) {
        try {
          const remainingPromotions = settings.max_promotions_per_run - totals.candidatesPromoted
          const result = await processCandidate(client, {
            rawItem,
            source,
            adapter,
            run: runRow,
            settings,
            dedupRecords,
            createdBy,
            remainingPromotions,
          })
          if (result.duplicate) totals.duplicatesDetected += 1
          else if (result.created) totals.candidatesCreated += 1
          else totals.candidatesUpdated += 1
          if (result.promoted) totals.candidatesPromoted += 1
          if (result.newDedupRecord) dedupRecords = [...dedupRecords, result.newDedupRecord]
        } catch {
          totals.errorsCount += 1
          sourceErrors += 1
        }
      }

      await client
        .from('prospect_sources')
        .update({ last_run_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: sourceErrors > 0 ? `${sourceErrors} مورد با خطا مواجه شد.` : null })
        .eq('id', source.id)
      sourceSummaries.push({ sourceId: source.id, name: source.name, found: limitedItems.length, errors: sourceErrors })
    } catch (sourceError) {
      // One source failing (e.g. an unconfigured/unreachable adapter) never
      // aborts the whole run - the other sources still get a chance.
      totals.errorsCount += 1
      await client.from('prospect_sources').update({ last_run_at: new Date().toISOString(), last_error: sourceError.message }).eq('id', source.id)
      sourceSummaries.push({ sourceId: source.id, name: source.name, error: sourceError.message })
    }
  }

  const status = totals.errorsCount === 0 ? 'completed' : totals.candidatesFound > 0 ? 'partial' : 'failed'
  const { data: finishedRun, error: finishError } = await client
    .from('prospect_discovery_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      candidates_found: totals.candidatesFound,
      candidates_created: totals.candidatesCreated,
      candidates_updated: totals.candidatesUpdated,
      candidates_promoted: totals.candidatesPromoted,
      duplicates_detected: totals.duplicatesDetected,
      errors_count: totals.errorsCount,
      summary: { sources: sourceSummaries },
    })
    .eq('id', runRow.id)
    .select('*')
    .single()
  if (finishError) throw finishError
  return finishedRun
}

// ---------------------------------------------------------------------------
// Admin-triggered single-candidate actions
// ---------------------------------------------------------------------------

export async function promoteCandidate(client, candidateId, { createdBy } = {}) {
  const { data: candidate, error } = await client
    .from('prospect_candidates')
    .select('*, prospect_sources(name)')
    .eq('id', candidateId)
    .single()
  if (error) throw error
  if (candidate.status === 'promoted') return candidate
  if (candidate.status === 'duplicate') {
    throw new Error('این مورد قبلاً به‌عنوان تکراری شناسایی شده و قابل تبدیل به سرنخ نیست.')
  }
  const evidence = await fetchCandidateEvidence(client, candidateId)
  await promoteCandidateRow(client, candidate, evidence, { createdBy, sourceName: candidate.prospect_sources?.name })
  const { data: updated, error: fetchError } = await client.from('prospect_candidates').select('*').eq('id', candidateId).single()
  if (fetchError) throw fetchError
  return updated
}

export async function rejectCandidate(client, candidateId, reason) {
  const { data, error } = await client
    .from('prospect_candidates')
    .update({ status: 'rejected', rejection_reason: reason || 'رد شده توسط ادمین.', updated_at: new Date().toISOString() })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function markCandidateDuplicate(client, candidateId, { duplicateOfCandidateId, matchedLeadId, matchedCompanyId, explanation }) {
  const { data, error } = await client
    .from('prospect_candidates')
    .update({
      status: 'duplicate',
      duplicate_of_candidate_id: duplicateOfCandidateId || null,
      matched_lead_id: matchedLeadId || null,
      matched_company_id: matchedCompanyId || null,
      match_explanation: explanation || 'ثبت‌شده توسط ادمین به‌عنوان تکراری.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateCandidateFields(client, candidateId, fields) {
  const { data, error } = await client
    .from('prospect_candidates')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Re-runs evidence extraction/scoring/qualification against the candidate's
// CURRENT stored fields (e.g. after an admin edits its description/contact
// info via updateCandidateFields) - never re-fetches from the source.
export async function reEvaluateCandidate(client, candidateId) {
  const [{ data: candidate, error }, settings] = await Promise.all([
    client.from('prospect_candidates').select('*').eq('id', candidateId).single(),
    fetchProspectSettings(client),
  ])
  if (error) throw error

  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings })

  await replaceEvidence(client, candidateId, evidence)
  const { data: updated, error: updateError } = await client
    .from('prospect_candidates')
    .update({
      relevance_score: scores.relevanceScore,
      contact_quality_score: scores.contactQualityScore,
      overall_score: scores.overallScore,
      confidence: scores.confidence,
      status: qualification.status,
      qualification_reason: qualification.status === 'rejected' ? null : qualification.reason,
      rejection_reason: qualification.status === 'rejected' ? qualification.reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (updateError) throw updateError
  return updated
}

async function ensureSourceExists(client, { name, sourceType, config }) {
  const { data: existing } = await client.from('prospect_sources').select('*').eq('name', name).maybeSingle()
  if (existing) return existing
  const { data: created, error } = await client
    .from('prospect_sources')
    .insert({ name, source_type: sourceType, enabled: true, config: config || {} })
    .select('*')
    .single()
  if (error) throw error
  return created
}

const UPLOADED_DATASET_SOURCE_NAME = 'آپلود دستی'
const OSM_SOURCE_NAME = 'دایرکتوری نقشه باز (OpenStreetMap)'

// Registers the built-in sources the admin UI always shows, if they don't
// already exist - idempotent, safe to call on every page load. Nothing here
// enables anything the admin didn't already leave enabled on a prior visit
// (ensureSourceExists never touches an existing row's `enabled` flag).
export async function ensureDefaultSources(client) {
  const uploaded = await ensureSourceExists(client, { name: UPLOADED_DATASET_SOURCE_NAME, sourceType: 'uploaded_dataset' })
  const osm = await ensureSourceExists(client, {
    name: OSM_SOURCE_NAME,
    sourceType: 'public_directory',
    config: { keywords: ['پلاستیک', 'پلیمر', 'مستربچ'], countryCode: 'IR', limit: 80 },
  })
  return [uploaded, osm]
}

export async function setSourceEnabled(client, sourceId, enabled) {
  const { data, error } = await client
    .from('prospect_sources')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', sourceId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// "Test source" - calls the adapter's own healthCheck() without discovering
// or writing any candidates, and records the result on the source row so
// its "آخرین خطا" stays accurate even between real runs.
export async function testSource(client, sourceId) {
  const { data: source, error } = await client.from('prospect_sources').select('*').eq('id', sourceId).single()
  if (error) throw error
  const adapter = getSourceAdapter(source.source_type)
  const result = await adapter.healthCheck(source)
  const { data: updated, error: updateError } = await client
    .from('prospect_sources')
    .update({
      last_run_at: new Date().toISOString(),
      last_success_at: result.ok ? new Date().toISOString() : source.last_success_at,
      last_error: result.ok ? null : result.message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId)
    .select('*')
    .single()
  if (updateError) throw updateError
  return { source: updated, result }
}

// Convenience wrapper for the admin UI's "upload a list" flow - ensures a
// single reusable 'uploaded_dataset' source row exists, then runs the same
// discovery pipeline against the pasted/uploaded rows.
export async function runUploadedDatasetDiscovery(client, { rows, createdBy }) {
  const source = await ensureSourceExists(client, { name: UPLOADED_DATASET_SOURCE_NAME, sourceType: 'uploaded_dataset' })
  return runDiscovery(client, { sourceId: source.id, runType: 'manual', uploadedRows: rows, createdBy })
}
