import { normalizedNameKey } from './normalization.js'

// ---------------------------------------------------------------------------
// Entity resolution / deduplication. Deterministic signals (domain, phone,
// mobile, email, or name+city together) are strong enough to mark a
// candidate a duplicate outright. A name-only or weak fuzzy match is NEVER
// auto-merged - it always comes back as manual_review with an explanation,
// per "ambiguous match -> manual_review, never automatic merge."
// ---------------------------------------------------------------------------

function tokenSet(text) {
  return new Set((text || '').split(' ').filter((t) => t.length >= 2))
}

function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

const FUZZY_MATCH_THRESHOLD = 0.6

function deterministicMatch(candidateKeys, recordKeys) {
  if (candidateKeys.domain && recordKeys.domain && candidateKeys.domain === recordKeys.domain) {
    return 'دامنه وب‌سایت یکسان'
  }
  if (candidateKeys.mobileKey && recordKeys.mobileKey && candidateKeys.mobileKey === recordKeys.mobileKey) {
    return 'شماره موبایل یکسان'
  }
  if (candidateKeys.phoneKey && recordKeys.phoneKey && candidateKeys.phoneKey === recordKeys.phoneKey) {
    return 'شماره تلفن ثابت یکسان'
  }
  if (candidateKeys.email && recordKeys.email && candidateKeys.email === recordKeys.email) {
    return 'ایمیل یکسان'
  }
  if (
    candidateKeys.nameKey &&
    recordKeys.nameKey &&
    candidateKeys.nameKey === recordKeys.nameKey &&
    candidateKeys.city &&
    recordKeys.city &&
    candidateKeys.city === recordKeys.city
  ) {
    return 'نام و شهر یکسان'
  }
  if (candidateKeys.sourceExternalId && recordKeys.sourceExternalId && candidateKeys.sourceExternalId === recordKeys.sourceExternalId) {
    return 'شناسه یکسان در همان منبع'
  }
  return null
}

function fuzzyMatch(candidateKeys, recordKeys) {
  if (!candidateKeys.nameKey || !recordKeys.nameKey) return null
  const similarity = jaccardSimilarity(tokenSet(candidateKeys.nameKey), tokenSet(recordKeys.nameKey))
  if (similarity >= FUZZY_MATCH_THRESHOLD) {
    return { similarity, reasonFa: `شباهت نام بالا (${Math.round(similarity * 100)}٪) - نیازمند بررسی دستی` }
  }
  return null
}

// Builds the comparable-keys shape once per record - callers (the discovery
// pipeline) pass already-normalized candidate keys and a list of existing
// records mapped into this same shape.
export function buildMatchKeys({ nameKey, domain, mobileKey, phoneKey, email, city, sourceExternalId }) {
  return { nameKey, domain, mobileKey, phoneKey, email, city, sourceExternalId }
}

// records: [{ kind: 'lead'|'company'|'candidate', id, keys }]
// Returns null (no match), or { matchType: 'duplicate'|'manual_review', kind, id, explanation }.
export function resolveDuplicate(candidateKeys, records) {
  for (const record of records) {
    const reason = deterministicMatch(candidateKeys, record.keys)
    if (reason) {
      return { matchType: 'duplicate', kind: record.kind, id: record.id, explanation: reason }
    }
  }
  let best = null
  for (const record of records) {
    const fuzzy = fuzzyMatch(candidateKeys, record.keys)
    if (fuzzy && (!best || fuzzy.similarity > best.similarity)) {
      best = { ...fuzzy, kind: record.kind, id: record.id }
    }
  }
  if (best) {
    return { matchType: 'manual_review', kind: best.kind, id: best.id, explanation: best.reasonFa }
  }
  return null
}

export { normalizedNameKey }
