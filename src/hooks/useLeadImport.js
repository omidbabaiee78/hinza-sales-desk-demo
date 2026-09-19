import { useMemo, useState } from 'react'
import { fullGridFromSheet, parseLeadImportWorkbook, sliceSheetFromRow } from '../utils/leadImport/parseGrid'
import { detectColumnMapping } from '../utils/leadImport/columnAliases'
import { buildNormalizedRows } from '../utils/leadImport/buildRows'
import { buildSmartRecords, detectImportMode } from '../utils/leadImport/smartParse'
import { classifyLeadImportRows } from '../utils/leadImport/duplicateEngine'
import {
  createImportBatch,
  fetchExistingCompaniesForDuplicateCheck,
  fetchLeadsForDuplicateCheck,
  runLeadImport,
} from '../services/leadImports'

// Orchestrates the full wizard: انتخاب فایل -> خواندن فایل -> تشخیص حالت
// (جدول استاندارد یا نیمه‌ساختاریافته) -> [تشخیص/تطبیق ستون‌ها فقط در حالت
// استاندارد] -> پیش‌نمایش (با تشخیص تکراری‌ها) -> تأیید -> ورود گروهی ->
// گزارش نهایی. Nothing is written to the DB before `confirmImport`.
export function useLeadImport() {
  const [step, setStep] = useState('select') // select | structure | mapping | preview | importing | result
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [workbook, setWorkbook] = useState(null) // { sheets: [{ name, headers, bodyRows }] }
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [startRow, setStartRow] = useState(0)
  const [modeOverride, setModeOverride] = useState(null) // null = follow auto-detection
  const [mapping, setMapping] = useState({}) // standard mode only: { [columnIndex]: canonicalField }
  const [rows, setRows] = useState([])
  const [ignoredRows, setIgnoredRows] = useState([])
  const [suggestedSourceLabel, setSuggestedSourceLabel] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [buildingPreview, setBuildingPreview] = useState(false)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)

  const activeSheet = workbook?.sheets[activeSheetIndex] || null

  const fullGridRows = useMemo(() => (activeSheet ? fullGridFromSheet(activeSheet, startRow) : []), [activeSheet, startRow])

  const detection = useMemo(() => detectImportMode(fullGridRows), [fullGridRows])
  const mode = modeOverride || detection.mode

  const smartPreview = useMemo(
    () => (mode === 'smart' && fullGridRows.length > 0 ? buildSmartRecords(fullGridRows) : null),
    [mode, fullGridRows],
  )

  const effectiveGrid = useMemo(
    () => (activeSheet ? sliceSheetFromRow(activeSheet, startRow) : { headers: [], bodyRows: [] }),
    [activeSheet, startRow],
  )

  async function loadFile(file) {
    setParseError('')
    setResult(null)
    setFileName(file.name)
    try {
      const parsed = await parseLeadImportWorkbook(file)
      const firstNonEmptyIndex = parsed.sheets.findIndex((s) => s.bodyRows.length > 0)
      setWorkbook(parsed)
      setActiveSheetIndex(firstNonEmptyIndex === -1 ? 0 : firstNonEmptyIndex)
      setStartRow(0)
      setModeOverride(null)
      setStep('structure')
    } catch (err) {
      setParseError(err.message || 'خواندن فایل با خطا مواجه شد.')
    }
  }

  function setColumnMapping(columnIndex, field) {
    setMapping((prev) => {
      const next = { ...prev }
      // Never assigns the same canonical field to two columns - picking a
      // field for this column clears it from whichever column had it.
      for (const key of Object.keys(next)) {
        if (next[key] === field) delete next[key]
      }
      if (field) next[columnIndex] = field
      else delete next[columnIndex]
      return next
    })
  }

  function continueFromStructure() {
    setPreviewError('')
    if (mode === 'standard') {
      setMapping(detectColumnMapping(effectiveGrid.headers))
      setStep('mapping')
    } else {
      buildPreview()
    }
  }

  // Builds the classified preview dataset for BOTH modes and advances to the
  // preview step. This is async (it fetches existing leads for duplicate
  // detection) and is invoked fire-and-forget from a plain onClick handler,
  // so it must never let an exception escape unhandled - a failure here has
  // to surface as a visible Persian error, never a silently frozen button.
  async function buildPreview() {
    setPreviewError('')
    setImportError('')
    setBuildingPreview(true)
    try {
      // Reuses the exact records the structure step already showed the
      // admin ("N سرنخ شناسایی شد") instead of recomputing them - the
      // preview dataset is guaranteed to be the same one the admin saw.
      const normalizedRows =
        mode === 'smart'
          ? smartPreview?.records ?? []
          : buildNormalizedRows(effectiveGrid.headers, effectiveGrid.bodyRows, mapping)
      // Both fetched fresh (not from a possibly-still-loading directory
      // hook) and in parallel - each already guaranteed to resolve to an
      // Array or throw, per their shared contract in services/leadImports.js.
      const [existingLeads, existingCompanies] = await Promise.all([
        fetchLeadsForDuplicateCheck(),
        fetchExistingCompaniesForDuplicateCheck(),
      ])
      const classified = classifyLeadImportRows(normalizedRows, { existingLeads, existingCompanies })
      setRows(classified)
      setIgnoredRows(mode === 'smart' ? smartPreview?.ignoredRows || [] : [])
      setSuggestedSourceLabel(mode === 'smart' ? smartPreview?.titleCandidate || '' : '')
      setStep('preview')
    } catch {
      // Deliberately a fixed Persian message, never err.message - this step
      // is a Supabase fetch plus internal classification logic, so a thrown
      // error here is either a raw technical string or a JS exception
      // (exactly how "existingCompanies is not iterable" reached the UI
      // before) and must never be shown to the admin verbatim.
      setPreviewError('بررسی موارد تکراری انجام نشد. لطفاً دوباره تلاش کنید.')
    } finally {
      setBuildingPreview(false)
    }
  }

  function setRowAction(rowNumber, action) {
    setRows((prev) => prev.map((r) => (r.rowNumber === rowNumber ? { ...r, action } : r)))
  }

  // Creates the batch-tracking row and runs the confirmed import. Like
  // buildPreview, this is invoked fire-and-forget from a plain onClick and
  // must never let an exception escape unhandled - but unlike buildPreview,
  // it optimistically leaves the preview step first (so the progress bar
  // can render while runLeadImport's onProgress ticks come in), so on
  // failure it must explicitly step back to preview rather than just
  // staying put. The result step - which reads as "here's what was
  // imported" - is only ever reached from the try block's normal
  // completion, so a thrown error can never be presented as a success.
  async function confirmImport(sourceLabel) {
    if (importing) return // re-entrancy guard against a rapid double-click
    setImportError('')
    setImporting(true)
    setStep('importing')
    setProgress({ done: 0, total: 0 })
    try {
      const batchId = await createImportBatch({
        fileName,
        sourceLabel,
        totalRows: rows.length,
      })
      const importResult = await runLeadImport({
        rows,
        batchId,
        onProgress: setProgress,
      })
      setResult(importResult)
      setStep('result')
    } catch {
      // Same rule as buildPreview's catch: a fixed Persian message, never
      // a raw thrown error string, for the same reason.
      setImportError('ورود گروهی سرنخ‌ها با خطا مواجه شد. لطفاً دوباره تلاش کنید.')
      setStep('preview')
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep('select')
    setFileName('')
    setParseError('')
    setWorkbook(null)
    setActiveSheetIndex(0)
    setStartRow(0)
    setModeOverride(null)
    setMapping({})
    setRows([])
    setIgnoredRows([])
    setSuggestedSourceLabel('')
    setProgress({ done: 0, total: 0 })
    setResult(null)
    setPreviewError('')
    setBuildingPreview(false)
    setImportError('')
    setImporting(false)
  }

  return {
    step,
    fileName,
    parseError,
    workbook,
    activeSheetIndex,
    setActiveSheetIndex,
    startRow,
    setStartRow,
    mode,
    setMode: setModeOverride,
    detection,
    smartPreview,
    fullGridRows,
    effectiveGrid,
    mapping,
    rows,
    ignoredRows,
    suggestedSourceLabel,
    progress,
    result,
    previewError,
    buildingPreview,
    importError,
    importing,
    loadFile,
    setColumnMapping,
    continueFromStructure,
    buildPreview,
    setRowAction,
    confirmImport,
    reset,
    goToStructure: () => {
      setPreviewError('')
      setImportError('')
      setStep('structure')
    },
    goToMapping: () => {
      setPreviewError('')
      setImportError('')
      setStep('mapping')
    },
  }
}
