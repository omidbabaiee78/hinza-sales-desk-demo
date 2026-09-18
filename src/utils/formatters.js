const jalaliDateFormatter = new Intl.DateTimeFormat('fa-IR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const jalaliDateTimeFormatter = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const jalaliLongDateFormatter = new Intl.DateTimeFormat('fa-IR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const rialFormatter = new Intl.NumberFormat('fa-IR')

function toValidDate(isoDate) {
  if (!isoDate) return null
  const date = new Date(isoDate)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatJalaliDate(isoDate) {
  const date = toValidDate(isoDate)
  return date ? jalaliDateFormatter.format(date) : '—'
}

export function formatJalaliDateTime(isoDate) {
  const date = toValidDate(isoDate)
  return date ? jalaliDateTimeFormatter.format(date) : '—'
}

export function formatJalaliDateLong(isoDate) {
  const date = toValidDate(isoDate)
  return date ? jalaliLongDateFormatter.format(date) : '—'
}

export function formatRial(amount) {
  if (amount === null || amount === undefined) return '—'
  const value = Number(amount)
  if (Number.isNaN(value)) return '—'
  return `${rialFormatter.format(value)} ریال`
}

export function formatRialPerKg(amount) {
  if (amount === null || amount === undefined) return '—'
  const value = Number(amount)
  if (Number.isNaN(value)) return '—'
  return `${rialFormatter.format(value)} ریال / کیلوگرم`
}

export function formatQuantity(amount) {
  if (amount === null || amount === undefined) return '—'
  const value = Number(amount)
  if (Number.isNaN(value)) return '—'
  return rialFormatter.format(value)
}

export function formatKg(amount) {
  if (amount === null || amount === undefined) return '—'
  const value = Number(amount)
  if (Number.isNaN(value)) return '—'
  return `${rialFormatter.format(value)} کیلوگرم`
}
