import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/browser'

const SUPPORTED_EXTENSIONS = ['csv', 'xlsx']
const XLSX_READ_ERROR_MESSAGE = 'خواندن فایل اکسل انجام نشد. لطفاً ساختار فایل را بررسی کنید.'
const BOM_PATTERN = new RegExp(`^${String.fromCharCode(0xfeff)}`)

function getExtension(file) {
  const name = file.name || ''
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function normalizeHeaderCell(value) {
  return String(value ?? '')
    .replace(BOM_PATTERN, '')
    .trim()
}

function isRowBlank(row) {
  return !row.some((cell) => cell != null && String(cell).trim() !== '')
}

// Splits a raw grid into { headers, bodyRows } for STANDARD mode's benefit
// (row 0 as header) - smart mode ignores this split entirely and instead
// works over the full reconstructed grid (see useLeadImport's `fullRows`).
function sheetFromGrid(name, grid) {
  if (!Array.isArray(grid) || grid.length === 0) return { name, headers: [], bodyRows: [] }
  const [headerRow, ...bodyRows] = grid
  return {
    name,
    headers: Array.isArray(headerRow) ? headerRow.map(normalizeHeaderCell) : [],
    bodyRows: bodyRows.filter((row) => Array.isArray(row) && !isRowBlank(row)),
  }
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(new Error(err?.message || 'خواندن فایل CSV با خطا مواجه شد.')),
    })
  })
}

// Returns { sheets: [{ name, headers, bodyRows }] } - a CSV file is treated
// as one pseudo-sheet; an .xlsx file's every sheet is read up front (one
// file read, not one per sheet-switch) so the admin can pick a different
// worksheet in the structure step without re-uploading.
export async function parseLeadImportWorkbook(file) {
  const extension = getExtension(file)
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new Error('فرمت فایل پشتیبانی نمی‌شود. فقط فایل xlsx یا csv مجاز است.')
  }

  let sheets
  try {
    if (extension === 'csv') {
      const grid = await parseCsv(file)
      sheets = [sheetFromGrid(file.name || 'CSV', grid)]
    } else {
      let rawSheets
      try {
        rawSheets = await readXlsxFile(file)
      } catch {
        throw new Error(XLSX_READ_ERROR_MESSAGE)
      }
      sheets = rawSheets.map((s) => sheetFromGrid(s.sheet, s.data))
    }
  } catch (err) {
    if (err instanceof Error && err.message) throw err
    throw new Error(
      extension === 'csv' ? 'خواندن فایل CSV با خطا مواجه شد.' : XLSX_READ_ERROR_MESSAGE,
      { cause: err },
    )
  }

  if (sheets.length === 0 || sheets.every((s) => s.bodyRows.length === 0 && s.headers.every((h) => !h))) {
    throw new Error('فایل خالی است یا داده‌ای ندارد.')
  }

  return { sheets }
}

// Re-derives { headers, bodyRows } from a sheet after skipping `startRow`
// leading rows (the "choosing the row where records begin" fallback
// control) - row 0 of what's left becomes the effective header row.
export function sliceSheetFromRow(sheet, startRow) {
  if (!startRow) return { headers: sheet.headers, bodyRows: sheet.bodyRows }
  const fullRows = [sheet.headers, ...sheet.bodyRows]
  const sliced = fullRows.slice(startRow)
  const [headerRow, ...bodyRows] = sliced
  return { headers: headerRow || [], bodyRows }
}

// The full grid (header row + body rows, unmapped) that smart mode scans -
// unlike standard mode it never treats row 0 as special.
export function fullGridFromSheet(sheet, startRow = 0) {
  const fullRows = [sheet.headers, ...sheet.bodyRows]
  return startRow ? fullRows.slice(startRow) : fullRows
}
