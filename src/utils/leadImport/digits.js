const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

// Converts Persian/Arabic-Indic digits to ASCII before any numeric parsing -
// spreadsheet cells routinely carry Persian digits for phone numbers. A
// standalone, dependency-free module (not part of normalize.js) so both
// normalize.js and contactNumbers.js can import it without a import cycle.
export function normalizeDigits(text) {
  return String(text ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(ch)
    if (persianIndex !== -1) return String(persianIndex)
    const arabicIndex = ARABIC_DIGITS.indexOf(ch)
    return arabicIndex !== -1 ? String(arabicIndex) : ch
  })
}
