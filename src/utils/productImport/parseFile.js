import Papa from 'papaparse'
import { readSheet } from 'read-excel-file/browser'
import { resolveColumnKey } from './columnAliases'

const SUPPORTED_EXTENSIONS = ['csv', 'xlsx']
const XLSX_READ_ERROR_MESSAGE = 'خواندن فایل اکسل انجام نشد. لطفاً ساختار فایل را بررسی کنید.'

function getExtension(file) {
  const name = file.name || ''
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

const BOM_PATTERN = new RegExp(`^${String.fromCharCode(0xfeff)}`)

// String(...) first so a number/Date/boolean cell never throws, then strip
// a stray BOM character and surrounding whitespace.
function normalizeHeaderCell(value) {
  return String(value ?? '')
    .replace(BOM_PATTERN, '')
    .trim()
}

function isRowBlank(row) {
  return !row.some((cell) => cell != null && String(cell).trim() !== '')
}

// Maps a raw header+body grid into objects keyed by canonical field name.
// Columns that don't match a known alias are dropped (not an error - extra
// columns such as "وزن"/"Weight" are simply ignored).
function rowsFromGrid(headerRow, bodyRows) {
  const keys = headerRow.map((header) => resolveColumnKey(normalizeHeaderCell(header)))
  return bodyRows
    .filter((row) => Array.isArray(row) && !isRowBlank(row))
    .map((row) => {
      const obj = {}
      keys.forEach((key, i) => {
        if (key) obj[key] = row[i]
      })
      return obj
    })
}

// Defensive shape validation - never call `.map()` (or anything else) on a
// value that isn't actually the array-of-arrays grid we expect, whatever
// the parsing library handed back.
function rowsFromValidatedGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new Error('فایل خالی است یا داده‌ای ندارد.')
  }
  const [headerRow, ...bodyRows] = grid
  if (!Array.isArray(headerRow)) {
    throw new Error(XLSX_READ_ERROR_MESSAGE)
  }
  return rowsFromGrid(headerRow, bodyRows)
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        try {
          resolve(rowsFromValidatedGrid(results.data))
        } catch (err) {
          reject(err)
        }
      },
      error: (err) => reject(new Error(err?.message || 'خواندن فایل CSV با خطا مواجه شد.')),
    })
  })
}

async function parseXlsx(file) {
  // `readSheet()` (a named export) reads a single sheet and resolves
  // directly to Array<Array<CellValue>> - this is deliberately NOT the
  // default export: since read-excel-file v8, the default export instead
  // resolves to an array of ALL sheets, each as { sheet, data }, which is
  // not an array of rows and was the actual cause of "headerRow.map is not
  // a function" here.
  let grid
  try {
    grid = await readSheet(file)
  } catch {
    throw new Error(XLSX_READ_ERROR_MESSAGE)
  }
  return rowsFromValidatedGrid(grid)
}

// Returns an array of raw row objects keyed by canonical field name (see
// columnAliases.js). Throws a Persian-language error for anything that
// prevents parsing at all (bad extension, empty file, unrecognizable
// structure) - never a raw JS/library error message.
export async function parseProductFile(file) {
  const extension = getExtension(file)
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new Error('فرمت فایل پشتیبانی نمی‌شود. فقط فایل xlsx یا csv مجاز است.')
  }

  let rawRows
  try {
    rawRows = extension === 'csv' ? await parseCsv(file) : await parseXlsx(file)
  } catch (err) {
    if (err instanceof Error && err.message) throw err
    throw new Error(
      extension === 'csv' ? 'خواندن فایل CSV با خطا مواجه شد.' : XLSX_READ_ERROR_MESSAGE,
      { cause: err },
    )
  }

  if (rawRows.length === 0) {
    throw new Error('فایل خالی است یا داده‌ای ندارد.')
  }
  return rawRows
}
