import { LEAD_PREFERRED_CHANNELS } from '../leadStatus'
import { normalizeDigits } from './digits'
import { extractIranianContactNumbers, joinContactDisplay } from './contactNumbers'

export { normalizeDigits }

function cellText(raw) {
  if (raw == null) return ''
  return normalizeDigits(String(raw)).trim().replace(/\s+/g, ' ')
}

export function normalizeTextField(raw) {
  const text = cellText(raw)
  return text || null
}

// Returns { display, keys } - `display` is every mobile number found in the
// cell, joined for readability (never just the first one - a row can list
// several); `keys` is the array of canonical comparison forms, one per
// distinct number, for the duplicate engine to index individually.
export function normalizeMobileField(raw) {
  const text = cellText(raw)
  if (!text) return { display: null, keys: [] }
  const { mobiles } = extractIranianContactNumbers(text)
  if (mobiles.length === 0) return { display: null, keys: [] }
  return { display: joinContactDisplay(mobiles.map((m) => m.display)), keys: mobiles.map((m) => m.key) }
}

// Same contract as normalizeMobileField, for landlines.
export function normalizePhoneField(raw) {
  const text = cellText(raw)
  if (!text) return { display: null, keys: [] }
  const { landlines } = extractIranianContactNumbers(text)
  if (landlines.length === 0) return { display: null, keys: [] }
  return { display: joinContactDisplay(landlines.map((l) => l.display)), keys: landlines.map((l) => l.key) }
}

export function normalizeEmailField(raw) {
  const text = cellText(raw)
  if (!text) return { display: null, keys: [] }
  const lower = text.toLowerCase()
  return { display: lower, keys: [lower] }
}

// Domain-only comparison key (strips protocol/www/path/trailing slash);
// display value keeps the original text, only gaining an https:// prefix
// when saved so it renders as a clickable link.
export function normalizeWebsiteField(raw) {
  const text = cellText(raw)
  if (!text) return { display: null, keys: [] }
  const withoutProtocol = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  const domain = withoutProtocol.split('/')[0].toLowerCase()
  return { display: text, keys: [domain] }
}

export function normalizeExternalRefField(raw) {
  const text = cellText(raw)
  return { display: text || null, keys: text ? [text.toLowerCase()] : [] }
}

export function normalizeTagsField(raw) {
  const text = cellText(raw)
  if (!text) return []
  const parts = text
    .split(/[,،|]/)
    .map((part) => part.trim())
    .filter(Boolean)
  return [...new Set(parts)]
}

const CHANNEL_ALIASES = {
  phone: 'phone', تماس: 'phone', تلفن: 'phone', 'تماس تلفنی': 'phone',
  whatsapp: 'whatsapp', واتساپ: 'whatsapp', 'واتس اپ': 'whatsapp',
  sms: 'sms', پیامک: 'sms', 'اس ام اس': 'sms',
  bale: 'bale', بله: 'bale',
  email: 'email', ایمیل: 'email',
}

// Returns { value, error }. An unrecognized non-empty value is a validation
// error (never silently guessed/dropped), since preferred_channel drives
// future outreach targeting.
export function normalizePreferredChannelField(raw) {
  const text = cellText(raw)
  if (!text) return { value: null, error: null }
  const key = text.toLowerCase()
  const resolved = CHANNEL_ALIASES[key] || (LEAD_PREFERRED_CHANNELS.includes(key) ? key : null)
  if (!resolved) return { value: null, error: `کانال ترجیحی نامعتبر است: «${text}»` }
  return { value: resolved, error: null }
}

const PRIORITY_ALIASES = {
  low: 'low', کم: 'low',
  medium: 'medium', متوسط: 'medium',
  high: 'high', بالا: 'high', زیاد: 'high',
}

export function normalizePriorityField(raw) {
  const text = cellText(raw).toLowerCase()
  return text ? PRIORITY_ALIASES[text] || null : null
}

// Single dispatch point mapping a canonical field name to its normalized
// value - shared by the standard-table row builder and the smart
// semi-structured record builder, so both modes normalize identically.
// Returns { value, matchKeys, error } - matchKeys is ALWAYS an array (empty
// for fields the duplicate engine doesn't compare on, one entry for
// single-valued contact fields, possibly several for mobile/phone since a
// cell/row can legitimately list more than one number).
export function normalizeCanonicalField(field, raw) {
  switch (field) {
    case 'mobile': {
      const r = normalizeMobileField(raw)
      return { value: r.display, matchKeys: r.keys, error: null }
    }
    case 'phone': {
      const r = normalizePhoneField(raw)
      return { value: r.display, matchKeys: r.keys, error: null }
    }
    case 'email': {
      const r = normalizeEmailField(raw)
      return { value: r.display, matchKeys: r.keys, error: null }
    }
    case 'website': {
      const r = normalizeWebsiteField(raw)
      return { value: r.display, matchKeys: r.keys, error: null }
    }
    case 'external_ref': {
      const r = normalizeExternalRefField(raw)
      return { value: r.display, matchKeys: r.keys, error: null }
    }
    case 'preferred_channel': {
      const r = normalizePreferredChannelField(raw)
      return { value: r.value, matchKeys: [], error: r.error }
    }
    case 'tags':
      return { value: normalizeTagsField(raw), matchKeys: [], error: null }
    case 'priority':
      return { value: normalizePriorityField(raw), matchKeys: [], error: null }
    default:
      return { value: normalizeTextField(raw), matchKeys: [], error: null }
  }
}
