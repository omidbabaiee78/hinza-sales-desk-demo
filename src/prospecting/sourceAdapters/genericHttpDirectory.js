import { normalizedNameKey, cleanCompanyName, extractContactNumbers, extractDomain, normalizeEmail } from '../normalization.js'

// ---------------------------------------------------------------------------
// A configurable HTTP/JSON directory adapter FOUNDATION - satisfies the
// discover()/normalize()/healthCheck() interface so a real provider can be
// plugged in later purely through prospect_sources.config, without any
// pipeline/engine code changing. Deliberately NOT wired to any specific
// real directory in Phase 23: no verified, credential-free, ToS-compliant
// Iranian industrial directory API was available to point this at safely
// (see the Phase 23 report's blockers section) - inventing one would risk
// exactly what the spec forbids (bypassing access controls, unverified
// data). This is the honest "foundation, not yet a working source" the
// spec explicitly allows for (section 27).
//
// To wire up a real provider later:
//   1. Add a prospect_sources row with source_type='custom_api', the
//      provider's base_url, and any field-mapping needed in `config`
//      (e.g. { fieldMap: { name: 'company_name', ... } }).
//   2. If it needs a key, add it as an Edge Function secret (never in
//      prospect_sources.config, never in this file) and read it via
//      Deno.env.get(...) only inside the server-side discover() call.
//   3. Replace the body of discover() below with the actual fetch() call.
// ---------------------------------------------------------------------------

export const genericHttpDirectoryAdapter = {
  sourceType: 'custom_api',

  async discover(source) {
    if (!source?.base_url) {
      throw new Error(`منبع «${source?.name || 'نامشخص'}»: base_url پیکربندی نشده است.`)
    }
    throw new Error(`منبع «${source.name}»: هنوز به یک ارائه‌دهنده واقعی متصل نشده است (فقط زیرساخت آماده است).`)
  },

  // field mapping is configurable per source (source.config.fieldMap),
  // never hardcoded to one provider's response shape.
  normalize(rawItem, source) {
    const map = source?.config?.fieldMap || {}
    const get = (key, fallbackKey) => rawItem[map[key] || fallbackKey]

    const website = get('website', 'website') ? String(get('website', 'website')).trim() : null
    const email = normalizeEmail(get('email', 'email'))
    const companyName = get('name', 'name')
    const contacts = extractContactNumbers([get('phone', 'phone'), get('mobile', 'mobile')].filter(Boolean).join(' '))

    return {
      canonical_name: cleanCompanyName(companyName),
      raw_name: companyName || null,
      normalized_name_key: normalizedNameKey(companyName),
      website,
      domain: extractDomain(website) || extractDomain(email),
      phone: get('phone', 'phone') || contacts.phone,
      mobile: get('mobile', 'mobile') || contacts.mobile,
      email,
      province: get('province', 'province') || null,
      city: get('city', 'city') || null,
      address: get('address', 'address') || null,
      industry_guess: get('industry', 'industry_guess') || null,
      business_description: get('description', 'business_description') || null,
      source_url: get('url', 'source_url') || null,
      source_external_id: get('id', 'id') != null ? String(get('id', 'id')) : null,
      raw_data: rawItem,
    }
  },

  async healthCheck(source) {
    return { ok: false, message: `منبع «${source?.name}» هنوز به ارائه‌دهنده واقعی متصل نیست.` }
  },
}
