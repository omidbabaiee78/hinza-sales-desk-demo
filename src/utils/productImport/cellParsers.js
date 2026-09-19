const MAX_MINI_SPECS = 8

// Every parser returns { present, value?, error? }. `present: false` means
// "this cell was blank or the column was missing" - the safe-update rule
// treats that identically (never touch the existing value on update, use
// the field default only when creating a brand-new product).
function cellText(raw) {
  if (raw == null) return ''
  return String(raw).trim()
}

export function parseTextCell(raw) {
  const text = cellText(raw)
  return text ? { present: true, value: text } : { present: false }
}

const AVAILABILITY_MAP = {
  'موجود': 'available',
  available: 'available',
  'سفارشی': 'made_to_order',
  made_to_order: 'made_to_order',
  'made to order': 'made_to_order',
  'ناموجود': 'unavailable',
  unavailable: 'unavailable',
}

export function parseAvailabilityCell(raw) {
  const text = cellText(raw)
  if (!text) return { present: false }
  const value = AVAILABILITY_MAP[text] || AVAILABILITY_MAP[text.toLowerCase()]
  if (!value) {
    return { present: true, error: `مقدار وضعیت موجودی نامعتبر است: «${text}»` }
  }
  return { present: true, value }
}

const ACTIVE_TRUE_VALUES = ['true', '1', 'فعال', 'بله', 'yes']
const ACTIVE_FALSE_VALUES = ['false', '0', 'غیرفعال', 'خیر', 'no']

export function parseActiveCell(raw) {
  const text = cellText(raw)
  if (!text) return { present: false }
  const lower = text.toLowerCase()
  if (ACTIVE_TRUE_VALUES.includes(text) || ACTIVE_TRUE_VALUES.includes(lower)) {
    return { present: true, value: true }
  }
  if (ACTIVE_FALSE_VALUES.includes(text) || ACTIVE_FALSE_VALUES.includes(lower)) {
    return { present: true, value: false }
  }
  return { present: true, error: `مقدار نمایش به مشتری نامعتبر است: «${text}»` }
}

// Accepts a comma/Persian-comma/pipe/slash separated list in one cell.
export function parseApplicationsCell(raw) {
  const text = cellText(raw)
  if (!text) return { present: false }
  const parts = text
    .split(/[,،|/]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const unique = [...new Set(parts)]
  return unique.length > 0 ? { present: true, value: unique } : { present: false }
}

// Accepts either a JSON array of {label, value} objects, or the simpler
// human-readable "TiO2=69% | ویژگی=پوشش بالا | LF=8" form.
export function parseMiniSpecsCell(raw) {
  const text = cellText(raw)
  if (!text) return { present: false }

  let rows
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('not an array')
      rows = parsed
        .map((row) => ({
          label: cellText(row?.label),
          value: cellText(row?.value),
        }))
        .filter((row) => row.label && row.value)
    } catch {
      return { present: true, error: 'ساختار JSON مشخصات کوتاه نامعتبر است.' }
    }
  } else {
    rows = text
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eqIndex = part.indexOf('=')
        if (eqIndex === -1) return null
        const label = part.slice(0, eqIndex).trim()
        const value = part.slice(eqIndex + 1).trim()
        return label && value ? { label, value } : null
      })
      .filter(Boolean)
  }

  if (rows.length === 0) {
    return { present: true, error: 'قالب مشخصات کوتاه قابل تشخیص نیست.' }
  }
  if (rows.length > MAX_MINI_SPECS) {
    return {
      present: true,
      error: `تعداد مشخصات کوتاه بیش از حد مجاز است (حداکثر ${MAX_MINI_SPECS} مورد).`,
    }
  }
  return { present: true, value: rows }
}
