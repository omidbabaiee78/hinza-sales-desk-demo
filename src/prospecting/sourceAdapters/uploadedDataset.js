import { normalizedNameKey, cleanCompanyName, extractContactNumbers, extractDomain, normalizeEmail } from '../normalization.js'

// ---------------------------------------------------------------------------
// The one source that actually works out of the box in Phase 23 with no
// external credentials and no scraping risk: rows the admin pastes/uploads
// themselves (e.g. an exhibition attendee list, a manually-compiled
// candidate list). "discover" doesn't fetch anything - the rows ARE the
// input, supplied by the caller at invocation time.
//
// Expects a fixed, documented row shape (never the lead importer's full
// column-alias system - that's a deliberate scope choice for this first
// adapter, not a limitation of the architecture):
//   { company_name, website, phone, mobile, email, province, city, address,
//     industry_guess, business_description, source_url, source_external_id }
// ---------------------------------------------------------------------------

export const uploadedDatasetAdapter = {
  sourceType: 'uploaded_dataset',

  async discover(source, context = {}) {
    return context.rows || []
  },

  normalize(rawItem) {
    const contacts = extractContactNumbers([rawItem.phone, rawItem.mobile].filter(Boolean).join(' '))
    const website = rawItem.website ? String(rawItem.website).trim() : null
    const email = normalizeEmail(rawItem.email)
    const canonicalName = cleanCompanyName(rawItem.company_name)

    return {
      canonical_name: canonicalName,
      raw_name: rawItem.company_name || null,
      normalized_name_key: normalizedNameKey(rawItem.company_name),
      website,
      domain: extractDomain(website) || extractDomain(email),
      phone: rawItem.phone ? String(rawItem.phone).trim() : contacts.phone,
      mobile: rawItem.mobile ? String(rawItem.mobile).trim() : contacts.mobile,
      email,
      province: rawItem.province || null,
      city: rawItem.city || null,
      address: rawItem.address || null,
      industry_guess: rawItem.industry_guess || null,
      business_description: rawItem.business_description || null,
      source_url: rawItem.source_url || null,
      source_external_id: rawItem.source_external_id || null,
      raw_data: rawItem,
    }
  },

  async healthCheck() {
    return { ok: true, message: 'منبع دستی - نیازی به بررسی سلامت خارجی ندارد.' }
  },
}
