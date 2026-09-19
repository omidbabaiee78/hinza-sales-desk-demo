import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { parseProductFile } from '../utils/productImport/parseFile'
import { classifyRows } from '../utils/productImport/classifyRows'

// "25-50 per batch" per the spec - inserts use one multi-row INSERT per
// batch (native, efficient); updates use a bounded Promise.all per batch
// (each product needs its own .eq('id', ...) filter, so they can't be
// combined into a single statement) - never one giant unbounded Promise.all
// for the whole file.
const INSERT_BATCH_SIZE = 30
const UPDATE_BATCH_SIZE = 25
const CODE_LOOKUP_CHUNK_SIZE = 200

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
  return chunks
}

// One batched lookup (chunked only if the file has many distinct codes),
// never a query per row.
async function fetchExistingProductsByCode(codes) {
  const uniqueCodes = [...new Set(codes)].filter(Boolean)
  const map = new Map()
  if (uniqueCodes.length === 0) return map

  const results = await Promise.all(
    chunk(uniqueCodes, CODE_LOOKUP_CHUNK_SIZE).map((codeChunk) =>
      supabase.from('products').select('id, code').in('code', codeChunk),
    ),
  )
  for (const { data, error } of results) {
    if (error) throw new Error('خطا در بررسی کدهای موجود. لطفاً دوباره تلاش کنید.')
    for (const row of data || []) map.set(row.code, row)
  }
  return map
}

export function useProductImport() {
  const [rows, setRows] = useState([])
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)

  async function loadFile(file) {
    setParseError('')
    setRows([])
    setResult(null)
    setParsing(true)
    try {
      const rawRows = await parseProductFile(file)
      const codes = rawRows.map((r) => String(r.code ?? '').trim()).filter(Boolean)
      const existingByCode = await fetchExistingProductsByCode(codes)
      setRows(classifyRows(rawRows, existingByCode))
    } catch (err) {
      setParseError(err.message || 'خواندن فایل با خطا مواجه شد.')
    } finally {
      setParsing(false)
    }
  }

  function reset() {
    setRows([])
    setParseError('')
    setResult(null)
    setProgress({ done: 0, total: 0 })
  }

  // Each batch is isolated: a failure in one batch is recorded per-row and
  // never stops the remaining batches, and never re-touches rows that
  // already succeeded (so a corrected re-run of the same file can't
  // duplicate anything - already-inserted codes simply classify as
  // "بروزرسانی" the next time the file is loaded).
  async function runImport() {
    const newRows = rows.filter((r) => r.status === 'new')
    const updateRows = rows.filter((r) => r.status === 'update')
    const total = newRows.length + updateRows.length

    setImporting(true)
    setProgress({ done: 0, total })

    let insertedCount = 0
    let updatedCount = 0
    const failures = []
    let done = 0

    for (const batch of chunk(newRows, INSERT_BATCH_SIZE)) {
      const { error } = await supabase.from('products').insert(batch.map((row) => row.payload))
      if (error) {
        for (const row of batch) {
          failures.push({
            rowNumber: row.rowNumber,
            code: row.code,
            reason: 'ثبت محصول جدید با خطا مواجه شد.',
          })
        }
      } else {
        insertedCount += batch.length
      }
      done += batch.length
      setProgress({ done, total })
    }

    for (const batch of chunk(updateRows, UPDATE_BATCH_SIZE)) {
      const batchResults = await Promise.all(
        batch.map((row) =>
          supabase
            .from('products')
            .update(row.payload)
            .eq('id', row.existingId)
            .then(({ error }) => ({ row, error })),
        ),
      )
      for (const { row, error } of batchResults) {
        if (error) {
          failures.push({
            rowNumber: row.rowNumber,
            code: row.code,
            reason: 'بروزرسانی محصول با خطا مواجه شد.',
          })
        } else {
          updatedCount += 1
        }
      }
      done += batch.length
      setProgress({ done, total })
    }

    setResult({ insertedCount, updatedCount, failures })
    setImporting(false)
  }

  return {
    rows,
    parsing,
    parseError,
    importing,
    progress,
    result,
    loadFile,
    runImport,
    reset,
  }
}
