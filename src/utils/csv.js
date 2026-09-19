// Shared CSV building/downloading - used by both the product bulk-import
// template and admin report exports, so escaping/download behavior stays
// identical everywhere a CSV leaves the app.
export function toCsvValue(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildCsv(rows) {
  return rows.map((row) => row.map(toCsvValue).join(',')).join('\r\n')
}

// A UTF-8 BOM prefix keeps Excel from mangling Persian text when it opens
// the downloaded CSV.
export function downloadCsv(filename, csvContent) {
  const bom = String.fromCharCode(0xfeff)
  const blob = new Blob([`${bom}${csvContent}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
