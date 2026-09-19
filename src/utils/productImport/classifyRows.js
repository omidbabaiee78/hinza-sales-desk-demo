import {
  parseTextCell,
  parseAvailabilityCell,
  parseActiveCell,
  parseApplicationsCell,
  parseMiniSpecsCell,
} from './cellParsers'
import { buildFullProductPayload } from '../productPayload'

const FIELD_PARSERS = {
  code: parseTextCell,
  name_fa: parseTextCell,
  category: parseTextCell,
  description_fa: parseTextCell,
  polymer_base: parseTextCell,
  applications: parseApplicationsCell,
  packaging: parseTextCell,
  availability: parseAvailabilityCell,
  active: parseActiveCell,
  mini_specs: parseMiniSpecsCell,
}

function parseRowFields(rawRow) {
  const fields = {}
  const errors = []
  for (const [key, parser] of Object.entries(FIELD_PARSERS)) {
    const result = parser(rawRow[key])
    fields[key] = result
    if (result.error) errors.push(result.error)
  }
  return { fields, errors }
}

// existingByCode: Map<code, { id, code }> from a single batched lookup query
// (never one query per row). Returns one classified row per input row, in
// the same order, each with status 'new' | 'update' | 'error'.
export function classifyRows(rawRows, existingByCode) {
  const codeCounts = new Map()
  for (const rawRow of rawRows) {
    const code = String(rawRow.code ?? '').trim()
    if (!code) continue
    codeCounts.set(code, (codeCounts.get(code) || 0) + 1)
  }

  return rawRows.map((rawRow, index) => {
    const rowNumber = index + 1
    const { fields, errors } = parseRowFields(rawRow)
    const code = fields.code.present ? fields.code.value : ''
    const name_fa = fields.name_fa.present ? fields.name_fa.value : ''

    if (!code) errors.push('کد محصول الزامی است.')
    if (!name_fa) errors.push('نام محصول الزامی است.')
    if (code && codeCounts.get(code) > 1) {
      errors.push('این کد در فایل ورودی بیش از یک بار تکرار شده است (کد تکراری).')
    }

    const preview = {
      rowNumber,
      code: code || '—',
      name_fa: name_fa || '—',
      category: fields.category.present ? fields.category.value : '',
      polymer_base: fields.polymer_base.present ? fields.polymer_base.value : '',
      availability: fields.availability.present ? fields.availability.value : '',
    }

    if (errors.length > 0) {
      return { ...preview, status: 'error', errors, payload: null, existingId: null }
    }

    const existing = existingByCode.get(code)

    if (existing) {
      // Safe partial update: only fields actually present in this row are
      // included, so the update never touches (let alone erases) anything
      // the file didn't mention - including image_path, which import never
      // sees at all.
      const payload = { code, name_fa }
      for (const [key, result] of Object.entries(fields)) {
        if (key === 'code' || key === 'name_fa') continue
        if (result.present) payload[key] = result.value
      }
      return { ...preview, status: 'update', errors: [], payload, existingId: existing.id }
    }

    const fullFields = { code, name_fa }
    for (const [key, result] of Object.entries(fields)) {
      if (key === 'code' || key === 'name_fa') continue
      fullFields[key] = result.present ? result.value : undefined
    }
    return {
      ...preview,
      status: 'new',
      errors: [],
      payload: buildFullProductPayload(fullFields),
      existingId: null,
    }
  })
}

export function summarizeClassification(rows) {
  return {
    total: rows.length,
    newCount: rows.filter((r) => r.status === 'new').length,
    updateCount: rows.filter((r) => r.status === 'update').length,
    errorCount: rows.filter((r) => r.status === 'error').length,
  }
}
