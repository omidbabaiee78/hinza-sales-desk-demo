// English + Persian header aliases -> canonical products column name.
// Matching is case-insensitive and trims whitespace; an unrecognized
// header is simply ignored (not an error - the file may have extra columns).
const COLUMN_ALIASES = {
  code: ['code', 'کد', 'کد محصول'],
  name_fa: ['name_fa', 'name', 'نام', 'نام محصول'],
  category: ['category', 'دسته', 'دسته بندی', 'دسته‌بندی'],
  description_fa: ['description_fa', 'description', 'توضیح', 'توضیحات', 'توضیح کوتاه'],
  polymer_base: ['polymer_base', 'پایه', 'پایه پلیمری'],
  applications: ['applications', 'application', 'کاربرد', 'کاربردها'],
  packaging: ['packaging', 'بسته بندی', 'بسته‌بندی'],
  availability: ['availability', 'وضعیت', 'وضعیت موجودی'],
  active: ['active', 'نمایش', 'نمایش به مشتری'],
  mini_specs: ['mini_specs', 'مشخصات', 'مشخصات کوتاه'],
}

const ALIAS_LOOKUP = new Map()
for (const [canonicalKey, aliases] of Object.entries(COLUMN_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_LOOKUP.set(alias.trim().toLowerCase(), canonicalKey)
  }
}

// Returns the canonical field key for a header, or null if it isn't one of
// the recognized product columns (the caller just ignores those cells).
export function resolveColumnKey(header) {
  const normalized = String(header || '').trim().toLowerCase()
  return ALIAS_LOOKUP.get(normalized) || null
}

export const REQUIRED_COLUMNS = ['code', 'name_fa']
