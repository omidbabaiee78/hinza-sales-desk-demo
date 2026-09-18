import { formatRial } from './formatters'

// The database and every stored monetary field remain integer RIAL. Toman
// only ever exists transiently in the UI - as a display/entry convenience -
// and is always converted back to Rial before anything is saved.
export const RIAL_PER_TOMAN = 10

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const numberFormatter = new Intl.NumberFormat('fa-IR')

// Accepts Persian digits, Arabic-Indic digits, and ASCII digits, plus
// common thousands separators (Persian ٬، ASCII comma/space), and reduces
// them all to a plain ASCII numeric string so parsing never depends on
// which keyboard/locale the admin typed with.
export function normalizeDigits(input) {
  if (input == null) return ''
  return String(input)
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[،٬,\s]/g, '')
    .trim()
}

// Parses a raw money-input string into a finite, non-negative number, or
// null if it isn't a valid amount (never silently coerces garbage to 0).
export function parseMoneyInput(input) {
  const normalized = normalizeDigits(input)
  if (normalized === '') return null
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function round2(value) {
  return Math.round(value * 100) / 100
}

// Converts a user-entered amount in the given display unit into the
// integer Rial value that is ever sent to Supabase. Rounds defensively so
// a fractional Toman entry can never leak a float into a bigint column.
export function toRial(amount, unit) {
  if (amount == null || Number.isNaN(amount)) return null
  return unit === 'toman' ? Math.round(amount * RIAL_PER_TOMAN) : Math.round(amount)
}

// Re-expresses a stored Rial amount in the given display unit - used both
// to populate an input and to compute the "معادل" equivalent line.
export function fromRial(rialAmount, unit) {
  if (rialAmount == null || Number.isNaN(Number(rialAmount))) return null
  const value = Number(rialAmount)
  return unit === 'toman' ? round2(value / RIAL_PER_TOMAN) : value
}

export function formatToman(amount) {
  if (amount == null || Number.isNaN(amount)) return '—'
  return `${numberFormatter.format(amount)} تومان`
}

// "معادل: ۹۸٬۰۰۰ تومان" - always derived straight from the Rial amount that
// is (or will be) stored, never from a separately-tracked Toman value.
export function formatTomanEquivalent(rialAmount) {
  const toman = fromRial(rialAmount, 'toman')
  if (toman == null) return null
  return `معادل: ${formatToman(toman)}`
}

// "معادل: ۹۸۰٬۰۰۰ ریال" - the reverse direction, used while the Toman unit
// is selected in a money input.
export function formatRialEquivalent(rialAmount) {
  if (rialAmount == null || Number.isNaN(Number(rialAmount))) return null
  return `معادل: ${formatRial(Math.round(Number(rialAmount)))}`
}
