const jalaliDateFormatter = new Intl.DateTimeFormat('fa-IR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const rialFormatter = new Intl.NumberFormat('fa-IR')

export function formatJalaliDate(isoDate) {
  if (!isoDate) return '—'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '—'
  return jalaliDateFormatter.format(date)
}

export function formatRial(amount) {
  if (amount === null || amount === undefined) return '—'
  const value = Number(amount)
  if (Number.isNaN(value)) return '—'
  return `${rialFormatter.format(value)} ریال`
}
