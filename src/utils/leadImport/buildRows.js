import {
  normalizeEmailField,
  normalizeExternalRefField,
  normalizeMobileField,
  normalizePhoneField,
  normalizePreferredChannelField,
  normalizePriorityField,
  normalizeTagsField,
  normalizeTextField,
  normalizeWebsiteField,
} from './normalize'

// Fields that were non-blank IN THIS ROW - the safe-update rule (a blank
// spreadsheet cell must never erase existing data) checks this, never just
// "was the column mapped" (which is import-wide, not per-row). Shared by
// both the standard-table and smart semi-structured row builders so the
// safe-update behavior is identical either way.
export function computePresentFields(fields) {
  return new Set(
    Object.entries(fields)
      .filter(([key, value]) => (key === 'tags' ? value.length > 0 : value != null))
      .map(([key]) => key),
  )
}

// Informational only (never rejects a row for lacking a mobile number) -
// how usable a reconstructed/imported lead's contact info is for direct
// outreach. Shared by both row builders so the preview shows one consistent
// tri-state badge regardless of which parsing path produced the row.
export const CONTACT_QUALITY_LABELS = {
  complete: 'تماس کامل',
  limited: 'تماس محدود',
  incomplete: 'اطلاعات تماس ناقص',
}

export function computeContactQuality(fields) {
  if (fields.mobile) return 'complete'
  if (fields.phone || fields.email || fields.website) return 'limited'
  return 'incomplete'
}

// mapping: { [columnIndex]: canonicalField }. Applies the mapping to the raw
// grid and normalizes every recognized field. Unmapped columns are simply
// never read - only mapped fields are ever imported.
export function buildNormalizedRows(headers, bodyRows, mapping) {
  return bodyRows.map((row, index) => {
    const raw = {}
    for (const [columnIndex, field] of Object.entries(mapping)) {
      raw[field] = row[Number(columnIndex)]
    }

    const errors = []

    const companyName = normalizeTextField(raw.company_name)
    const contactName = normalizeTextField(raw.contact_name)
    const mobile = normalizeMobileField(raw.mobile)
    const phone = normalizePhoneField(raw.phone)
    const email = normalizeEmailField(raw.email)
    const website = normalizeWebsiteField(raw.website)
    const externalRef = normalizeExternalRefField(raw.external_ref)
    const channel = normalizePreferredChannelField(raw.preferred_channel)

    if (!companyName && !contactName) {
      errors.push('نام شرکت یا نام شخص تماس الزامی است.')
    }
    if (channel.error) errors.push(channel.error)

    const hasAnyContactRoute = Boolean(mobile.display || phone.display || email.display || website.display)

    const fields = {
      company_name: companyName,
      contact_name: contactName,
      mobile: mobile.display,
      phone: phone.display,
      email: email.display,
      website: website.display,
      province: normalizeTextField(raw.province),
      city: normalizeTextField(raw.city),
      address: normalizeTextField(raw.address),
      industry: normalizeTextField(raw.industry),
      source: normalizeTextField(raw.source),
      priority: normalizePriorityField(raw.priority),
      need_note: normalizeTextField(raw.need_note),
      notes: normalizeTextField(raw.notes),
      preferred_channel: channel.value,
      external_ref: externalRef.display,
      tags: normalizeTagsField(raw.tags),
    }

    return {
      rowNumber: index + 1,
      errors,
      contactInfoIncomplete: !hasAnyContactRoute,
      contactQuality: computeContactQuality(fields),
      fields,
      presentFields: computePresentFields(fields),
      // Each an ARRAY of normalized keys - mobile/phone may legitimately
      // hold more than one number (see contactNumbers.js); the duplicate
      // engine indexes every one of them, never just a single combined key.
      matchKeys: {
        mobile: mobile.keys,
        phone: phone.keys,
        email: email.keys,
        website: website.keys,
        externalRef: externalRef.keys,
      },
    }
  })
}
