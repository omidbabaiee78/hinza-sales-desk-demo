// Canonical sales_leads import fields (a subset of the table's columns -
// history/status/conversion/do_not_contact are deliberately never
// importable). Order here also drives the mapping-step UI order.
export const CANONICAL_LEAD_FIELDS = [
  'company_name',
  'contact_name',
  'mobile',
  'phone',
  'email',
  'website',
  'province',
  'city',
  'address',
  'industry',
  'source',
  'priority',
  'need_note',
  'notes',
  'preferred_channel',
  'external_ref',
  'tags',
]

export const LEAD_FIELD_LABELS = {
  company_name: 'نام شرکت',
  contact_name: 'شخص تماس',
  mobile: 'موبایل',
  phone: 'تلفن',
  email: 'ایمیل',
  website: 'وب‌سایت',
  province: 'استان',
  city: 'شهر',
  address: 'آدرس',
  industry: 'صنعت',
  source: 'منبع',
  priority: 'اولویت',
  need_note: 'محصول / نیاز',
  notes: 'یادداشت',
  preferred_channel: 'کانال ترجیحی',
  external_ref: 'شناسه خارجی',
  tags: 'تگ‌ها',
}

// English + Persian header aliases -> canonical sales_leads column name.
// Matching is case-insensitive and trims whitespace; an unrecognized header
// is simply left unmapped ("نادیده گرفته شود"), never an error.
const COLUMN_ALIASES = {
  company_name: ['company_name', 'company', 'نام شرکت', 'شرکت', 'نام مجموعه', 'نام سازمان'],
  contact_name: ['contact_name', 'contact', 'شخص تماس', 'نام تماس', 'نام شخص تماس', 'مدیر', 'مسئول', 'نام و نام خانوادگی'],
  mobile: ['mobile', 'موبایل', 'تلفن همراه', 'شماره همراه', 'شماره موبایل', 'همراه'],
  phone: ['phone', 'تلفن', 'شماره ثابت', 'تلفن ثابت', 'تلفن ثابت درج‌شده'],
  email: ['email', 'e-mail', 'ایمیل', 'پست الکترونیک'],
  website: ['website', 'site', 'وبسایت', 'وب‌سایت', 'سایت', 'آدرس سایت'],
  province: ['province', 'state', 'استان'],
  city: ['city', 'شهر'],
  address: ['address', 'آدرس', 'محل کارخانه', 'آدرس کارخانه'],
  industry: ['industry', 'صنعت', 'حوزه فعالیت', 'حوزه کاری'],
  source: ['source', 'منبع'],
  priority: ['priority', 'اولویت'],
  need_note: ['need_note', 'need', 'محصول', 'محصولات', 'نیاز', 'محصول / نیاز', 'محصول موردنیاز', 'محصولات موردنیاز', 'نیاز محصول'],
  notes: ['notes', 'note', 'توضیحات', 'یادداشت', 'توضیح'],
  preferred_channel: ['preferred_channel', 'channel', 'کانال ترجیحی', 'کانال ارتباطی'],
  external_ref: ['external_ref', 'ref', 'شناسه خارجی', 'کد خارجی'],
  tags: ['tags', 'tag', 'تگ‌ها', 'تگ ها', 'برچسب‌ها', 'برچسب ها'],
}

const ALIAS_LOOKUP = new Map()
for (const [canonicalKey, aliases] of Object.entries(COLUMN_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_LOOKUP.set(alias.trim().toLowerCase(), canonicalKey)
  }
}

export function resolveLeadColumnKey(header) {
  return ALIAS_LOOKUP.get(String(header || '').trim().toLowerCase()) || null
}

// Every alias, sorted longest-first so the smart-mode label matcher (a
// looser prefix match, unlike the exact match above) prefers "تلفن همراه"
// over the shorter "تلفن" when a cell's label could match either.
export const ALIAS_ENTRIES_BY_LENGTH = Object.entries(COLUMN_ALIASES)
  .flatMap(([field, aliases]) => aliases.map((alias) => [alias.trim().toLowerCase(), field]))
  .filter(([alias]) => /[؀-ۿ]/.test(alias)) // Persian aliases only - smart mode never guesses off a bare English word inside free text
  .sort((a, b) => b[0].length - a[0].length)

// Best-effort auto-detect only - the mapping step always lets the admin
// override or clear any column, and never assigns the same canonical field
// to two different source columns (first alias match wins).
export function detectColumnMapping(headers) {
  const mapping = {}
  const usedFields = new Set()
  headers.forEach((header, index) => {
    const normalized = String(header || '').trim().toLowerCase()
    const field = ALIAS_LOOKUP.get(normalized)
    if (field && !usedFields.has(field)) {
      mapping[index] = field
      usedFields.add(field)
    }
  })
  return mapping
}
