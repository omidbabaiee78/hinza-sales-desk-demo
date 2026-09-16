export function toE164Iran(input) {
  const digits = String(input || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('0098')) return `+98${digits.slice(4)}`
  if (digits.startsWith('98')) return `+${digits}`
  if (digits.startsWith('0')) return `+98${digits.slice(1)}`
  if (digits.startsWith('9')) return `+98${digits}`
  return `+${digits}`
}

export function isValidIranMobile(input) {
  const e164 = toE164Iran(input)
  return /^\+989\d{9}$/.test(e164)
}
