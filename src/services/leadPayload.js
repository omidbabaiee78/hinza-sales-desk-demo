import { LEAD_PREFERRED_CHANNELS, LEAD_PRIORITIES, LEAD_SOURCES } from '../utils/leadStatus.js'

// ---------------------------------------------------------------------------
// The ONE place a parsed row (from either the standard-table or smart-mode
// importer) turns into a sales_leads-safe payload. UI/display values, free
// text from a source spreadsheet column, and blank strings never reach
// Supabase directly here - only canonical enum values or null. This is
// deliberately separate from the parser (utils/leadImport/*) - it fixes the
// WRITE CONTRACT, not reconstruction.
// ---------------------------------------------------------------------------

const SOURCE_ALIASES = {
  'وب سایت': 'website', 'وب‌سایت': 'website', 'وبسایت': 'website',
  اینستاگرام: 'instagram',
  نمایشگاه: 'exhibition',
  واتساپ: 'whatsapp', 'واتس اپ': 'whatsapp',
  معرفی: 'referral',
  'تماس سرد': 'cold_call',
  'مشتری قبلی': 'existing_customer',
  سایر: 'other',
  اکسل: 'other', excel: 'other', 'فایل اکسل': 'other',
}

// A bulk-imported row's origin is already represented by import_batch_id /
// source_row_number / lead_import_batches - sales_leads.source is a fixed
// enum, so anything that isn't one of the allowed values (a raw free-text
// column value, or nothing at all) becomes 'other', never written verbatim.
// Exported for the manual lead form too - sales_leads.source is NOT NULL,
// so a blank choice must become 'other' there exactly as it does here.
export function normalizeSourceForDb(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return 'other'
  const lower = text.toLowerCase()
  if (LEAD_SOURCES.includes(lower)) return lower
  return SOURCE_ALIASES[text] || SOURCE_ALIASES[lower] || 'other'
}

// priority has no blank option anywhere else in the app (the manual lead
// form always defaults it to 'medium') - a bulk-imported row without a
// recognizable priority column must default the same way, never null.
function normalizePriorityForDb(raw) {
  const lower = String(raw ?? '').trim().toLowerCase()
  return LEAD_PRIORITIES.includes(lower) ? lower : 'medium'
}

const CHANNEL_ALIASES = {
  تماس: 'phone', تلفن: 'phone',
  واتساپ: 'whatsapp',
  پیامک: 'sms',
  بله: 'bale',
  ایمیل: 'email',
}

// Unlike source/priority, preferred_channel genuinely allows null (no
// channel preference recorded) - an unrecognized value degrades to null
// rather than a guessed default, since a wrong channel guess is worse than
// none.
function normalizePreferredChannelForDb(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (LEAD_PREFERRED_CHANNELS.includes(lower)) return lower
  return CHANNEL_ALIASES[text] || CHANNEL_ALIASES[lower] || null
}

function normalizeTagsForDb(raw) {
  if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[,،]/).map((t) => t.trim()).filter(Boolean)
  }
  return []
}

// null or a positive integer - never 0, a numeric string, NaN, or a stray
// spreadsheet label.
function normalizeRowNumberForDb(raw) {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : null
}

function nullableText(raw) {
  if (raw == null) return null
  const text = String(raw).trim()
  return text || null
}

// New leads: every enum-constrained column always gets a valid value (never
// blank/null where the schema requires one) - a new row can never be
// inserted with an invalid or missing enum value.
export function serializeLeadForCreate(fields, { createdBy, importBatchId, sourceRowNumber } = {}) {
  return {
    company_name: nullableText(fields.company_name),
    contact_name: nullableText(fields.contact_name),
    mobile: nullableText(fields.mobile),
    phone: nullableText(fields.phone),
    email: nullableText(fields.email),
    website: nullableText(fields.website),
    province: nullableText(fields.province),
    city: nullableText(fields.city),
    address: nullableText(fields.address),
    industry: nullableText(fields.industry),
    source: normalizeSourceForDb(fields.source),
    priority: normalizePriorityForDb(fields.priority),
    need_note: nullableText(fields.need_note),
    notes: nullableText(fields.notes),
    preferred_channel: normalizePreferredChannelForDb(fields.preferred_channel),
    external_ref: nullableText(fields.external_ref),
    tags: normalizeTagsForDb(fields.tags),
    created_by: createdBy || null,
    import_batch_id: importBatchId,
    source_row_number: normalizeRowNumberForDb(sourceRowNumber),
  }
}

// Existing leads (safe-update rule): ONLY the fields the row actually had
// non-blank data for are included - never invents a value for a field the
// row didn't mention (a blank spreadsheet cell must never erase existing
// data). Any enum field that IS present still goes through the same
// canonical mapping, so an update can never write an invalid value either -
// but an unmapped/blank enum field is simply left out of the payload
// entirely (never defaulted the way a brand-new row is), matching the
// existing safe-update contract exactly.
export function serializeLeadFieldsForUpdate(fields, presentFields) {
  const payload = {}
  for (const field of presentFields) {
    if (field === 'source') payload.source = normalizeSourceForDb(fields.source)
    else if (field === 'priority') payload.priority = normalizePriorityForDb(fields.priority)
    else if (field === 'preferred_channel') payload.preferred_channel = normalizePreferredChannelForDb(fields.preferred_channel)
    else if (field === 'tags') payload.tags = normalizeTagsForDb(fields.tags)
    else payload[field] = fields[field]
  }
  return payload
}
