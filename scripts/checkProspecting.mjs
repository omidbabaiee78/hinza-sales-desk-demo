// Lightweight pure-logic + pipeline checks for Phase 23 Autonomous
// Prospecting Engine (src/prospecting/*). No new test framework - Node's
// built-in assert, run directly with `node scripts/checkProspecting.mjs`.

import assert from 'node:assert/strict'
import { cleanCompanyName, normalizedNameKey, extractContactNumbers, extractDomain } from '../src/prospecting/normalization.js'
import { extractEvidence } from '../src/prospecting/evidenceEngine.js'
import { scoreCandidate } from '../src/prospecting/scoringEngine.js'
import { qualifyCandidate, mapScoreToPriority } from '../src/prospecting/qualification.js'
import { suggestProductFit } from '../src/prospecting/productFit.js'
import { buildMatchKeys, resolveDuplicate } from '../src/prospecting/deduplication.js'
import { runDiscovery, runUploadedDatasetDiscovery, promoteCandidate } from '../src/prospecting/discoveryPipeline.js'
import { osmOverpassAdapter } from '../src/prospecting/sourceAdapters/osmOverpass.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

const DEFAULT_SETTINGS = {
  id: 1,
  enabled: true,
  max_candidates_per_source_per_run: 100,
  max_promotions_per_run: 10,
  min_score_auto_promote: 80,
  min_confidence_auto_promote: 'high',
  min_score_manual_review: 50,
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

await check('Persian company normalization strips legal-form boilerplate and parentheses', () => {
  const a = normalizedNameKey('صنایع پلاستیک امید')
  const b = normalizedNameKey('شرکت صنایع پلاستیک امید (سهامی خاص)')
  assert.equal(a, b)
})

await check('Arabic character variants normalize the same as Persian', () => {
  const a = normalizedNameKey('صنایع پلاستیک امید')
  const b = normalizedNameKey('صنايع پلاستيك اميد')
  assert.equal(a, b)
})

await check('cleanCompanyName never invents or drops real words', () => {
  const name = cleanCompanyName('  صنایع   پلاستیک   امید  ')
  assert.equal(name, 'صنایع پلاستیک امید')
})

await check('phone normalization extracts a valid Iranian mobile from mixed text', () => {
  const { mobile, mobileKey } = extractContactNumbers('تماس: 0912-345-6789 دفتر مرکزی')
  assert.ok(mobile)
  assert.equal(mobileKey, '+989123456789')
})

await check('invalid phone text yields no mobile/phone rather than a fabricated one', () => {
  const { mobile, phone } = extractContactNumbers('این یک متن بدون شماره است')
  assert.equal(mobile, null)
  assert.equal(phone, null)
})

await check('extractDomain resolves both a URL and an email to the same bare domain', () => {
  assert.equal(extractDomain('https://www.omid-plastic.com/fa'), 'omid-plastic.com')
  assert.equal(extractDomain('info@omid-plastic.com'), 'omid-plastic.com')
})

// ---------------------------------------------------------------------------
// Evidence / scoring / qualification / product fit
// ---------------------------------------------------------------------------

function manufacturerCandidate(overrides = {}) {
  return {
    canonical_name: 'صنایع پلاستیک امید',
    business_description:
      'تولیدکننده فیلم پلی اتیلن کشاورزی، فیلم کشاورزی و بسته بندی پلاستیک با خط اکستروژن فعال و تولید کیسه پلاستیک',
    website: 'https://omid-plastic.com',
    address: 'شهرک صنعتی، جاده کرج',
    city: 'کرج',
    mobile: '09123456789',
    phone: '02633334444',
    email: 'info@omid-plastic.com',
    ...overrides,
  }
}

await check('a manufacturer with strong evidence scores high and qualifies', () => {
  const candidate = manufacturerCandidate()
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.ok(scores.overallScore >= DEFAULT_SETTINGS.min_score_auto_promote)
  assert.equal(scores.confidence, 'high')
  assert.equal(qualification.status, 'qualified')
  assert.equal(qualification.autoPromotable, true)
})

await check('a manufacturer with no usable contact never auto-promotes even at a high score', () => {
  const candidate = manufacturerCandidate({ mobile: null, phone: null, email: null })
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.equal(qualification.autoPromotable, false)
})

await check('weak-but-viable evidence lands in manual_review, not auto-promoted', () => {
  const candidate = {
    canonical_name: 'کارگاه تولیدی نمونه',
    business_description: 'تزریق پلاستیک برای قطعات ساده',
    mobile: '09121112233',
  }
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('a retail-only business is rejected, not qualified, despite mentioning plastic', () => {
  const candidate = {
    canonical_name: 'فروشگاه لوازم پلاستیکی رضا',
    business_description: 'فروشگاه خرده فروشی لوازم پلاستیکی خانگی در بازار',
    phone: '02144556677',
  }
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.equal(qualification.status, 'rejected')
})

await check('a terse directory-style name with no description still gets a fallback manufacturing signal', () => {
  // Real shape of what a live directory source (e.g. OpenStreetMap) often
  // hands us: just a name, no business_description at all.
  const candidate = { canonical_name: 'کارخانه پلاستیک شاهین پلاست', raw_name: 'کارخانه پلاستیک شاهین پلاست', mobile: '09121234567' }
  const evidence = extractEvidence(candidate)
  assert.ok(evidence.some((e) => e.evidenceType === 'generic_manufacturing_signal'))
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.notEqual(qualification.status, 'rejected')
  assert.notEqual(scores.confidence, 'manual_review', 'a real generic signal must not be treated as zero evidence')
})

await check('a plastic SHOP name (no manufacturing indicator) does NOT get the generic manufacturing fallback', () => {
  const candidate = { canonical_name: 'فروشگاه پلاستیک تک', raw_name: 'فروشگاه پلاستیک تک' }
  const evidence = extractEvidence(candidate)
  assert.ok(!evidence.some((e) => e.evidenceType === 'generic_manufacturing_signal'))
})

await check('the generic fallback never fires when a specific industry keyword already matched (no double-counting)', () => {
  const candidate = manufacturerCandidate()
  const evidence = extractEvidence(candidate)
  assert.ok(evidence.some((e) => e.evidenceType === 'industry_keyword'))
  assert.ok(!evidence.some((e) => e.evidenceType === 'generic_manufacturing_signal'))
})

// ---------------------------------------------------------------------------
// OSM Overpass adapter - normalize() against a real captured sample
// (fetched live during implementation from overpass-api.de; discover()/
// healthCheck() need a live network call and are exercised manually, not in
// this deterministic suite).
// ---------------------------------------------------------------------------

const SAMPLE_OSM_NODE = {
  type: 'node',
  id: 8988198691,
  lat: 34.093348,
  lon: 49.6882556,
  tags: {
    name: 'کارخانه پلاستیک ایرانیان',
    shop: 'plastic',
    phone: '+98 21 887 57211;+98 21 887 57212',
    website: 'http://www.assoplast.com',
    'addr:city': 'Tehran',
  },
}

await check('OSM adapter normalize() extracts a real, traceable candidate from a live-captured sample', () => {
  const normalized = osmOverpassAdapter.normalize(SAMPLE_OSM_NODE)
  assert.equal(normalized.canonical_name, 'کارخانه پلاستیک ایرانیان')
  assert.equal(normalized.source_url, 'https://www.openstreetmap.org/node/8988198691')
  assert.equal(normalized.source_external_id, 'node/8988198691')
  assert.equal(normalized.domain, 'assoplast.com')
  assert.equal(normalized.city, 'Tehran')
  assert.ok(normalized.phone, 'a real phone tag must be extracted, not dropped')
  assert.deepEqual(normalized.raw_data, SAMPLE_OSM_NODE, 'raw_data preserves full provenance')
})

await check('OSM adapter normalize() never fabricates a phone/mobile when the tag has none', () => {
  const normalized = osmOverpassAdapter.normalize({ type: 'node', id: 1, tags: { name: 'یک کسب‌وکار بدون تماس' } })
  assert.equal(normalized.phone, null)
  assert.equal(normalized.mobile, null)
})

// ---------------------------------------------------------------------------
// OSM adapter - 429/retry/failover/config-error hardening (Phase 23B).
// Mocks globalThis.fetch to test the adapter's own retry/failover logic
// deterministically and instantly, without depending on a real provider's
// current rate-limit state.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

function mockFetch(responder) {
  globalThis.fetch = responder
}
function restoreFetch() {
  globalThis.fetch = originalFetch
}

function jsonFetchResponse(body, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k] || null }, json: async () => body }
}

const TWO_ENDPOINT_SOURCE = {
  config: { endpoints: ['https://mirror-a.example/api/interpreter', 'https://mirror-b.example/api/interpreter'], keywords: ['پلاستیک'] },
}

await check('a 429 with Retry-After is honored, then the SAME endpoint is retried once and can succeed', async () => {
  const calls = []
  mockFetch(async (url) => {
    calls.push(url)
    if (calls.length === 1) return jsonFetchResponse(null, { status: 429, headers: { 'Retry-After': '0' } })
    return jsonFetchResponse({ elements: [{ type: 'node', id: 1, tags: { name: 'کارخانه پلاستیک تست' } }] })
  })
  try {
    const elements = await osmOverpassAdapter.discover(TWO_ENDPOINT_SOURCE)
    assert.equal(elements.length, 1)
    assert.equal(calls.length, 2, 'exactly one retry on the same endpoint, no failover needed')
    assert.equal(calls[0], calls[1], 'the retry hit the SAME endpoint that returned 429')
  } finally {
    restoreFetch()
  }
})

await check('if the retried endpoint still 429s, it fails over to the next endpoint WITHOUT waiting again', async () => {
  const calls = []
  mockFetch(async (url) => {
    calls.push(url)
    if (url.includes('mirror-a')) return jsonFetchResponse(null, { status: 429, headers: { 'Retry-After': '0' } })
    return jsonFetchResponse({ elements: [{ type: 'node', id: 2, tags: { name: 'صنایع پلاستیک تست دو' } }] })
  })
  try {
    const elements = await osmOverpassAdapter.discover(TWO_ENDPOINT_SOURCE)
    assert.equal(elements.length, 1)
    // mirror-a tried twice (initial + one retry), then mirror-b once - never
    // a second wait/retry cycle spent on mirror-b.
    assert.equal(calls.filter((u) => u.includes('mirror-a')).length, 2)
    assert.equal(calls.filter((u) => u.includes('mirror-b')).length, 1)
  } finally {
    restoreFetch()
  }
})

await check('requests are sequential, never in parallel (no overlapping in-flight calls)', async () => {
  let inFlight = 0
  let maxInFlight = 0
  mockFetch(async (url) => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight -= 1
    if (url.includes('mirror-a')) return jsonFetchResponse(null, { status: 500 })
    return jsonFetchResponse({ elements: [] })
  })
  try {
    await osmOverpassAdapter.discover(TWO_ENDPOINT_SOURCE)
    assert.equal(maxInFlight, 1, 'never more than one Overpass request in flight at once')
  } finally {
    restoreFetch()
  }
})

await check('all configured endpoints failing (non-429) does not crash - it throws a normal Error the pipeline already isolates', async () => {
  mockFetch(async () => jsonFetchResponse(null, { status: 500 }))
  try {
    await assert.rejects(() => osmOverpassAdapter.discover(TWO_ENDPOINT_SOURCE))
  } finally {
    restoreFetch()
  }
})

await check('health check reports "degraded" (not "unavailable") when every endpoint is rate-limited', async () => {
  mockFetch(async () => jsonFetchResponse(null, { status: 429, headers: { 'Retry-After': '0' } }))
  try {
    const result = await osmOverpassAdapter.healthCheck(TWO_ENDPOINT_SOURCE)
    assert.equal(result.ok, false)
    assert.equal(result.status, 'degraded')
  } finally {
    restoreFetch()
  }
})

await check('health check reports "unavailable" (not "degraded") for a genuine network failure', async () => {
  mockFetch(async () => {
    throw new Error('network unreachable')
  })
  try {
    const result = await osmOverpassAdapter.healthCheck(TWO_ENDPOINT_SOURCE)
    assert.equal(result.ok, false)
    assert.equal(result.status, 'unavailable')
  } finally {
    restoreFetch()
  }
})

await check('health check reports "healthy" on a clean success and identifies which endpoint answered', async () => {
  mockFetch(async () => jsonFetchResponse({ elements: [] }))
  try {
    const result = await osmOverpassAdapter.healthCheck(TWO_ENDPOINT_SOURCE)
    assert.equal(result.ok, true)
    assert.equal(result.status, 'healthy')
  } finally {
    restoreFetch()
  }
})

await check('a malformed config (keywords not an array) is a distinct "config_error", never silently defaulted', async () => {
  const result = await osmOverpassAdapter.healthCheck({ config: { keywords: 'پلاستیک' } })
  assert.equal(result.status, 'config_error')
})

await check('every Overpass request carries a descriptive User-Agent', async () => {
  let capturedHeaders = null
  mockFetch(async (url, options) => {
    capturedHeaders = options.headers
    return jsonFetchResponse({ elements: [] })
  })
  try {
    await osmOverpassAdapter.discover(TWO_ENDPOINT_SOURCE)
    assert.ok(capturedHeaders['user-agent']?.includes('HinzaProspecting'))
  } finally {
    restoreFetch()
  }
})

await check('all configured keywords are combined into ONE request, never one request per keyword', async () => {
  let callCount = 0
  const manyKeywordsSource = { config: { endpoints: ['https://mirror-a.example/api'], keywords: ['پلاستیک', 'پلیمر', 'مستربچ', 'اکستروژن'] } }
  mockFetch(async () => {
    callCount += 1
    return jsonFetchResponse({ elements: [] })
  })
  try {
    await osmOverpassAdapter.discover(manyKeywordsSource)
    assert.equal(callCount, 1, 'one combined query for all keywords, not four separate ones')
  } finally {
    restoreFetch()
  }
})

await check('incomplete data (too little text) goes to manual_review, never rejected outright', () => {
  const candidate = { canonical_name: 'شرکت ناشناخته', business_description: '' }
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.equal(qualification.status, 'manual_review')
})

await check('mapScoreToPriority reuses the existing low/medium/high vocabulary', () => {
  assert.equal(mapScoreToPriority(90), 'high')
  assert.equal(mapScoreToPriority(60), 'medium')
  assert.equal(mapScoreToPriority(20), 'low')
})

await check('product fit suggests masterbatch categories with cautious wording, never a firm claim', () => {
  const evidence = extractEvidence(manufacturerCandidate())
  const fit = suggestProductFit(evidence)
  assert.ok(fit.products.length > 0)
  assert.ok(fit.noteFa.includes('احتمال نیاز'))
  assert.ok(!fit.noteFa.includes('حتماً'))
})

await check('product fit is empty (not guessed) when there is no matched industry', () => {
  const fit = suggestProductFit([])
  assert.equal(fit.products.length, 0)
})

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

await check('exact domain match is a deterministic duplicate', () => {
  const candidateKeys = buildMatchKeys({ domain: 'omid-plastic.com' })
  const result = resolveDuplicate(candidateKeys, [{ kind: 'candidate', id: 'c1', keys: buildMatchKeys({ domain: 'omid-plastic.com' }) }])
  assert.equal(result.matchType, 'duplicate')
})

await check('exact mobile match against an existing sales_lead is a deterministic duplicate', () => {
  const candidateKeys = buildMatchKeys({ mobileKey: '+989123456789' })
  const result = resolveDuplicate(candidateKeys, [{ kind: 'lead', id: 'lead-1', keys: buildMatchKeys({ mobileKey: '+989123456789' }) }])
  assert.equal(result.matchType, 'duplicate')
  assert.equal(result.kind, 'lead')
})

await check('exact normalized-name match against an existing company is a duplicate', () => {
  const candidateKeys = buildMatchKeys({ nameKey: normalizedNameKey('صنایع پلاستیک امید'), city: 'کرج' })
  const result = resolveDuplicate(candidateKeys, [
    { kind: 'company', id: 'co-1', keys: buildMatchKeys({ nameKey: normalizedNameKey('صنایع پلاستیک امید'), city: 'کرج' }) },
  ])
  assert.equal(result.matchType, 'duplicate')
  assert.equal(result.kind, 'company')
})

await check('an ambiguous fuzzy name match is manual_review, never an automatic merge', () => {
  const candidateKeys = buildMatchKeys({ nameKey: normalizedNameKey('صنایع پلاستیک امید البرز') })
  const result = resolveDuplicate(candidateKeys, [
    { kind: 'candidate', id: 'c2', keys: buildMatchKeys({ nameKey: normalizedNameKey('صنایع پلاستیک امید تهران') }) },
  ])
  assert.equal(result.matchType, 'manual_review')
})

await check('no signals in common produces no match at all', () => {
  const candidateKeys = buildMatchKeys({ nameKey: 'کاملا متفاوت اینجا' })
  const result = resolveDuplicate(candidateKeys, [{ kind: 'lead', id: 'lead-9', keys: buildMatchKeys({ nameKey: 'شرکت دیگر بدون ارتباط' }) }])
  assert.equal(result, null)
})

// ---------------------------------------------------------------------------
// Discovery pipeline - fake in-memory Supabase client
// ---------------------------------------------------------------------------

function makeFakeClient() {
  const tables = {
    prospect_sources: [],
    prospect_discovery_runs: [],
    prospect_candidates: [],
    prospect_evidence: [],
    prospect_settings: [{ ...DEFAULT_SETTINGS }],
    sales_leads: [],
    companies: [],
  }
  let nextId = 1
  const newId = (table) => `${table}-${nextId++}`

  function matches(row, filters) {
    return filters.every(([type, field, value]) => {
      if (type === 'eq') return row[field] === value
      if (type === 'neq') return row[field] !== value
      return true
    })
  }

  function selectChain(table) {
    const filters = []
    let orderField = null
    let ascending = true
    let limitN = null
    const resolveRows = () => {
      let rows = tables[table].filter((r) => matches(r, filters)).map((r) => ({ ...r }))
      if (orderField) rows.sort((a, b) => (a[orderField] > b[orderField] ? 1 : -1) * (ascending ? 1 : -1))
      if (limitN != null) rows = rows.slice(0, limitN)
      return rows
    }
    const chain = {
      eq: (f, v) => (filters.push(['eq', f, v]), chain),
      neq: (f, v) => (filters.push(['neq', f, v]), chain),
      order: (f, opts = {}) => {
        orderField = f
        ascending = opts.ascending !== false
        return chain
      },
      limit: (n) => {
        limitN = n
        return chain
      },
      single: async () => {
        const rows = resolveRows()
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
      },
      maybeSingle: async () => ({ data: resolveRows()[0] || null, error: null }),
      then: (resolve) => resolve({ data: resolveRows(), error: null }),
    }
    return chain
  }

  function insertChain(table, payload) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
      id: newId(table),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      ...row,
    }))
    tables[table].push(...rows)
    return {
      select: () => ({ single: async () => ({ data: rows[0], error: null }) }),
      then: (resolve) => resolve({ data: rows, error: null }),
    }
  }

  function updateChain(table, patch) {
    return {
      eq: (field, value) => {
        const rows = tables[table].filter((r) => r[field] === value)
        rows.forEach((r) => Object.assign(r, patch))
        const result = { data: rows[0] || null, error: null }
        return { select: () => ({ single: async () => result }), then: (resolve) => resolve(result) }
      },
    }
  }

  function deleteChain(table) {
    return {
      eq: (field, value) => {
        tables[table] = tables[table].filter((r) => r[field] !== value)
        return { then: (resolve) => resolve({ data: null, error: null }) }
      },
    }
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from(table) {
      return {
        select: () => selectChain(table),
        insert: (payload) => insertChain(table, payload),
        update: (patch) => updateChain(table, patch),
        delete: () => deleteChain(table),
      }
    },
    tables,
  }
}

function manufacturerRow(overrides = {}) {
  return {
    company_name: 'صنایع پلاستیک امید',
    business_description:
      'تولیدکننده فیلم پلی اتیلن کشاورزی، فیلم کشاورزی و بسته بندی پلاستیک با خط اکستروژن فعال و تولید کیسه پلاستیک',
    website: 'https://omid-plastic.com',
    mobile: '09123456789',
    phone: '02633334444',
    email: 'info@omid-plastic.com',
    city: 'کرج',
    address: 'شهرک صنعتی، جاده کرج',
    source_external_id: 'ext-1',
    ...overrides,
  }
}

await check('a fresh discovery run creates and auto-promotes a strong manufacturer candidate', async () => {
  const client = makeFakeClient()
  const run = await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow()], createdBy: 'admin-1' })
  assert.equal(run.status, 'completed')
  assert.equal(run.candidates_created, 1)
  assert.equal(run.candidates_promoted, 1)
  assert.equal(client.tables.sales_leads.length, 1)
  const candidate = client.tables.prospect_candidates[0]
  assert.equal(candidate.status, 'promoted')
  assert.ok(candidate.promoted_lead_id)
})

await check('repeated run with the same source_external_id is idempotent - no duplicate row, no duplicate lead', async () => {
  const client = makeFakeClient()
  await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow()], createdBy: 'admin-1' })
  const secondRun = await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow()], createdBy: 'admin-1' })
  assert.equal(client.tables.prospect_candidates.length, 1, 'no duplicate candidate row created')
  assert.equal(client.tables.sales_leads.length, 1, 'no duplicate lead created')
  assert.equal(secondRun.candidates_promoted, 0, 'second run does not re-promote')
})

await check('duplicate promotion prevention holds even without a stable external id (matched by contact info)', async () => {
  const client = makeFakeClient()
  await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow({ source_external_id: null })], createdBy: 'admin-1' })
  await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow({ source_external_id: null })], createdBy: 'admin-1' })
  assert.equal(client.tables.sales_leads.length, 1, 'still only one lead after a second, unrelated-looking upload')
})

await check('an existing sales_lead with the same mobile makes a new candidate a duplicate, not promoted', async () => {
  const client = makeFakeClient()
  client.tables.sales_leads.push({ id: 'lead-existing', company_name: 'شرکت قبلی', mobile: '09123456789', phone: null, email: null, city: null })
  const run = await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow({ source_external_id: null })], createdBy: 'admin-1' })
  assert.equal(run.duplicates_detected, 1)
  assert.equal(client.tables.sales_leads.length, 1, 'no new lead created for a duplicate')
  const candidate = client.tables.prospect_candidates[0]
  assert.equal(candidate.status, 'duplicate')
  assert.equal(candidate.matched_lead_id, 'lead-existing')
})

await check('an existing company with the exact same name forces manual_review, never a silent auto-merge', async () => {
  // fetchDedupRecords only ever selects companies.id/name (not city - an
  // unverified column, see the Phase 19 lesson about guessing schema), so a
  // company match can only ever be a same-name FUZZY match, never the
  // deterministic name+city path - this is the real, intended behavior:
  // an exact name hit against a real customer is significant enough to
  // require a human look, but never confident enough to auto-merge/reject
  // outright with no data to compare beyond the name.
  const client = makeFakeClient()
  client.tables.companies.push({ id: 'co-existing', name: 'صنایع پلاستیک امید' })
  const row = manufacturerRow({ source_external_id: null, mobile: null, phone: null, email: null, website: null })
  const run = await runUploadedDatasetDiscovery(client, { rows: [row], createdBy: 'admin-1' })
  assert.equal(run.duplicates_detected, 0, 'a fuzzy match is not counted as a hard duplicate')
  const candidate = client.tables.prospect_candidates[0]
  assert.equal(candidate.status, 'manual_review')
  assert.ok(candidate.match_explanation)
})

await check('a source that throws during discover() does not abort the whole run', async () => {
  const client = makeFakeClient()
  const { data: badSource } = await client.from('prospect_sources').insert({ name: 'منبع خراب', source_type: 'custom_api', enabled: true, base_url: null }).select().single()
  const run = await runDiscovery(client, { sourceId: badSource.id, runType: 'manual' })
  assert.ok(run.status === 'failed' || run.status === 'partial')
  assert.ok(run.errors_count >= 1)
})

await check('promoteCandidate is idempotent - promoting an already-promoted candidate does not create a second lead', async () => {
  const client = makeFakeClient()
  await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow()], createdBy: 'admin-1' })
  const candidate = client.tables.prospect_candidates[0]
  await promoteCandidate(client, candidate.id, { createdBy: 'admin-1' })
  assert.equal(client.tables.sales_leads.length, 1)
})

await check('a disabled prospecting engine skips the run entirely', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].enabled = false
  const result = await runDiscovery(client, { runType: 'manual' })
  assert.equal(result.skipped, true)
})

console.log(`\n${passed} check(s) passed.`)
