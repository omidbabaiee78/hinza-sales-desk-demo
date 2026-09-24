// Lightweight pure-logic + pipeline checks for Phase 23 Autonomous
// Prospecting Engine (src/prospecting/*). No new test framework - Node's
// built-in assert, run directly with `node scripts/checkProspecting.mjs`.

import assert from 'node:assert/strict'
import { cleanCompanyName, normalizedNameKey, extractContactNumbers, extractDomain } from '../src/prospecting/normalization.js'
import { extractEvidence, matchedEntityType, matchedBuyerFit, matchedBusinessRole, matchedIdentity } from '../src/prospecting/evidenceEngine.js'
import { scoreCandidate, computeConfidence } from '../src/prospecting/scoringEngine.js'
import { qualifyCandidate, mapScoreToPriority } from '../src/prospecting/qualification.js'
import { classifyEntityType, ENTITY_TYPES } from '../src/prospecting/entityClassification.js'
import { findMatchingKeywordsStrict } from '../src/prospecting/textMatching.js'
import { NEGATIVE_SIGNALS } from '../src/prospecting/industryTaxonomy.js'
import { enrichFromWebsite, fetchIdentitySignals, decodeHtmlEntities } from '../src/prospecting/websiteEnrichment.js'
import { resolveVerifiedIdentity, isPromotableIdentity, isPlausibleOrganizationName, IDENTITY_STATUS, IDENTITY_SOURCES } from '../src/prospecting/identityResolution.js'
import { suggestProductFit } from '../src/prospecting/productFit.js'
import { buildMatchKeys, resolveDuplicate } from '../src/prospecting/deduplication.js'
import {
  runDiscovery,
  runUploadedDatasetDiscovery,
  promoteCandidate,
  ensureDefaultSources,
  reEvaluateManualReviewCandidates,
  dryRunQualification,
  verifyQualificationState,
  runComprehensiveAudit,
  qualifyWithIdentityVerification,
  promoteEligibleCandidates,
  verifyPendingCandidateSites,
  searchOfficialSitesForLeads,
} from '../src/prospecting/discoveryPipeline.js'
import { findLeadEmailViaSearch } from '../src/prospecting/leadSiteSearch.js'
import { osmOverpassAdapter, __testing as osmOverpassTesting } from '../src/prospecting/sourceAdapters/osmOverpass.js'
import { serperSearchAdapter, DEFAULT_QUERY_TEMPLATES as DEFAULT_SERPER_QUERY_TEMPLATES, buildQueryPlan, nextRotationSlice } from '../src/prospecting/sourceAdapters/serperSearch.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

// Phase 24 fields (daily_run_enabled/max_external_requests_per_run/
// run_timeout_ms/dry_run) default here to "fully turned on for testing" -
// this mirrors how `enabled: true` already does NOT reflect production's
// conservative default, it reflects "an admin has already configured and
// enabled this system", which is what most of this suite needs to actually
// exercise the pipeline. Production's real defaults (daily_run_enabled and
// dry_run OFF) live only in supabase/sql/phase24_autonomous_daily_pipeline.sql
// and are asserted independently by the Phase 24 tests below.
const DEFAULT_SETTINGS = {
  id: 1,
  enabled: true,
  max_candidates_per_source_per_run: 100,
  max_promotions_per_run: 10,
  min_score_auto_promote: 80,
  min_confidence_auto_promote: 'high',
  min_score_manual_review: 50,
  daily_run_enabled: true,
  max_external_requests_per_run: 20,
  run_timeout_ms: 240000,
  dry_run: false,
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
    // A real normalize() output always sets `domain` alongside `website`
    // (see e.g. uploadedDataset.js/serperSearch.js) - entityClassification.js
    // reads `domain`, not `website`, so this fixture must set it too or it
    // never reaches entity_type=direct_company/buyer_fit=high, unlike any
    // real candidate row ever would.
    domain: 'omid-plastic.com',
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

await check('a manufacturer with absolutely NO contact channel (no phone, no email, no website) never auto-promotes', () => {
  // 23D.3: a confirmed company-owned WEBSITE now counts as a legitimate
  // contact channel for the direct-company auto-promote gate (see
  // qualification.js's hasUsableContactOrWebsite) - this fixture nulls
  // website too, so it tests the invariant that actually still holds: zero
  // reachable channel of ANY kind must never auto-promote.
  const candidate = manufacturerCandidate({ mobile: null, phone: null, email: null, website: null, domain: null })
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

await check('default endpoint pool has kumi.systems retired and private.coffee first', () => {
  assert.deepEqual(osmOverpassTesting.DEFAULT_ENDPOINTS, [
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ])
  assert.ok(!osmOverpassTesting.DEFAULT_ENDPOINTS.some((e) => e.includes('kumi.systems')), 'kumi.systems must no longer be in the pool')
})

await check('a fully-failed discover() reports a short per-endpoint diagnostic summary, not just the last error', async () => {
  mockFetch(async (url) => {
    if (url.includes('mirror-a')) throw Object.assign(new Error('timeout'), { isTimeout: true })
    return jsonFetchResponse(null, { status: 429, headers: { 'Retry-After': '0' } })
  })
  try {
    await assert.rejects(
      () => osmOverpassAdapter.discover(TWO_ENDPOINT_SOURCE),
      (err) => {
        assert.match(err.message, /mirror-a\.example: timeout/)
        assert.match(err.message, /mirror-b\.example: 429/)
        assert.equal(err.attempts.length, 2)
        return true
      },
    )
  } finally {
    restoreFetch()
  }
})

await check('discover() fails over immediately (no wait) when Retry-After is absent or unreasonably long', async () => {
  const calls = []
  mockFetch(async (url, options) => {
    calls.push({ url, at: Date.now() })
    if (url.includes('mirror-a')) return jsonFetchResponse(null, { status: 429, headers: { 'Retry-After': '3600' } })
    return jsonFetchResponse({ elements: [{ type: 'node', id: 3, tags: { name: 'صنایع پلاستیک تست سه' } }] })
  })
  try {
    const startedAt = Date.now()
    const elements = await osmOverpassAdapter.discover(TWO_ENDPOINT_SOURCE)
    assert.equal(elements.length, 1)
    assert.ok(Date.now() - startedAt < 2000, 'an unreasonably long Retry-After must never be waited out')
    assert.equal(calls.filter((c) => c.url.includes('mirror-a')).length, 1, 'no same-endpoint retry when Retry-After is unreasonable')
  } finally {
    restoreFetch()
  }
})

await check('healthCheck() never waits on a 429 - it fails over to the next endpoint immediately, with no same-endpoint retry', async () => {
  const calls = []
  mockFetch(async (url) => {
    calls.push(url)
    if (url.includes('mirror-a')) return jsonFetchResponse(null, { status: 429, headers: { 'Retry-After': '0' } })
    return jsonFetchResponse({ elements: [] })
  })
  try {
    const startedAt = Date.now()
    const result = await osmOverpassAdapter.healthCheck(TWO_ENDPOINT_SOURCE)
    // Still reported "degraded" (a 429 was seen somewhere in the sequence),
    // even though a later mirror ultimately answered - this test is only
    // about the timing/no-retry behavior, not the resulting status.
    assert.equal(result.status, 'degraded')
    assert.ok(Date.now() - startedAt < 2000, 'health check must never wait out a Retry-After')
    assert.equal(calls.filter((u) => u.includes('mirror-a')).length, 1, 'health check never retries the same endpoint on 429')
  } finally {
    restoreFetch()
  }
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

// ---------------------------------------------------------------------------
// Serper (Google Search) adapter - Phase 23C primary live source. Same
// mocked-fetch approach as the OSM tests above, plus a mocked
// globalThis.Deno (the adapter reads SERPER_API_KEY through it) so both the
// "no key configured" and "key configured" paths are exercised
// deterministically, without a real Edge Function runtime or a real key.
// ---------------------------------------------------------------------------

function withFakeDenoEnv(vars, fn) {
  const previousDeno = globalThis.Deno
  globalThis.Deno = { env: { get: (k) => vars[k] } }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousDeno === undefined) delete globalThis.Deno
      else globalThis.Deno = previousDeno
    })
}

function serperResponse(organic) {
  return jsonFetchResponse({ organic })
}

const SERPER_SOURCE = { config: {} }

await check('serper adapter discover() fails cleanly with credential_required when SERPER_API_KEY is missing', async () => {
  // No globalThis.Deno set at all here (the default Node test environment)
  // - this is exactly what a misconfigured Edge Function looks like.
  await assert.rejects(() => serperSearchAdapter.discover(SERPER_SOURCE), (err) => {
    assert.equal(err.code, 'credential_required')
    assert.match(err.message, /^credential_required:/)
    return true
  })
})

await check('serper adapter healthCheck() reports status "credential_required" when SERPER_API_KEY is missing', async () => {
  const result = await serperSearchAdapter.healthCheck(SERPER_SOURCE)
  assert.equal(result.ok, false)
  assert.equal(result.status, 'credential_required')
})

await check('serper adapter normalize() extracts name/domain/snippet/industry from a real-shaped result, never fabricating contact info', () => {
  const rawItem = {
    title: 'شرکت نمونه پلاستیک | صفحه اصلی',
    link: 'https://example-plastic.ir/about',
    snippet: 'تولیدکننده قطعات پلاستیکی صنعتی در ایران، تماس: 09121234567',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  }
  const normalized = serperSearchAdapter.normalize(rawItem)
  assert.equal(normalized.canonical_name, 'شرکت نمونه پلاستیک')
  assert.equal(normalized.domain, 'example-plastic.ir')
  assert.equal(normalized.website, rawItem.link)
  assert.equal(normalized.source_url, rawItem.link)
  assert.equal(normalized.source_external_id, rawItem.link)
  // Phase 23D: the search query that surfaced this result is NOT proof of
  // what the result itself is - industry_guess stays null; the query is
  // still preserved, for traceability only, inside raw_data._sourceQuery.
  assert.equal(normalized.industry_guess, null)
  assert.equal(normalized.raw_data._sourceQuery, rawItem._sourceQuery)
  assert.equal(normalized.business_description, rawItem.snippet)
  assert.ok(normalized.mobile, 'a real mobile number in the snippet must be extracted')
  assert.equal(normalized.email, null, 'no email present in the sample - must not be fabricated')
  assert.deepEqual(normalized.raw_data, rawItem)
})

await check('serper adapter normalize() falls back to the domain label when the title has no usable separator', () => {
  const normalized = serperSearchAdapter.normalize({ title: '', link: 'https://sample-co.com/x', snippet: '' })
  assert.equal(normalized.canonical_name, 'sample co')
})

await check('serper adapter discover() combines results from multiple query templates sequentially, deduped by link', async () => {
  const calls = []
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async (url, options) => {
      calls.push({ url, at: Date.now() })
      const body = JSON.parse(options.body)
      if (body.q === DEFAULT_SERPER_QUERY_TEMPLATES[0]) {
        return serperResponse([
          { title: 'شرکت الف', link: 'https://a.example', snippet: 'تولیدکننده فیلم پلی اتیلن' },
          { title: 'شرکت ب', link: 'https://b.example', snippet: 'تولیدکننده فیلم کشاورزی' },
        ])
      }
      if (body.q === DEFAULT_SERPER_QUERY_TEMPLATES[1]) {
        // Same link as the first query's first result - must be deduped.
        return serperResponse([{ title: 'شرکت الف', link: 'https://a.example', snippet: 'تکراری' }])
      }
      return serperResponse([])
    })
    try {
      const source = { config: { queryTemplates: DEFAULT_SERPER_QUERY_TEMPLATES.slice(0, 2) } }
      const results = await serperSearchAdapter.discover(source)
      assert.equal(results.length, 2, 'the duplicate link across two queries must be deduped')
      assert.equal(calls.length, 2, 'one HTTP call per query template')
    } finally {
      restoreFetch()
    }
  })
})

await check('serper adapter discover() never runs queries in parallel', async () => {
  let inFlight = 0
  let maxInFlight = 0
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return serperResponse([])
    })
    try {
      const source = { config: { queryTemplates: DEFAULT_SERPER_QUERY_TEMPLATES.slice(0, 3) } }
      await serperSearchAdapter.discover(source)
      assert.equal(maxInFlight, 1, 'never more than one Serper request in flight at once')
    } finally {
      restoreFetch()
    }
  })
})

await check('serper adapter discover() tolerates one failing query template and still returns the others\' results', async () => {
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async (url, options) => {
      const body = JSON.parse(options.body)
      if (body.q === DEFAULT_SERPER_QUERY_TEMPLATES[0]) return jsonFetchResponse(null, { status: 500 })
      return serperResponse([{ title: 'شرکت پ', link: 'https://c.example', snippet: 'تولیدکننده فیلم کشاورزی' }])
    })
    try {
      const source = { config: { queryTemplates: DEFAULT_SERPER_QUERY_TEMPLATES.slice(0, 2) } }
      const results = await serperSearchAdapter.discover(source)
      assert.equal(results.length, 1, 'one failing query template must not abort the whole source')
    } finally {
      restoreFetch()
    }
  })
})

await check('serper adapter discover() throws a diagnostic error when every query template fails', async () => {
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async () => jsonFetchResponse(null, { status: 500 }))
    try {
      await assert.rejects(
        () => serperSearchAdapter.discover({ config: { queryTemplates: DEFAULT_SERPER_QUERY_TEMPLATES.slice(0, 2) } }),
        (err) => {
          assert.match(err.message, /500/)
          return true
        },
      )
    } finally {
      restoreFetch()
    }
  })
})

await check('serper adapter healthCheck() reports "healthy" on a clean success', async () => {
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async () => serperResponse([{ title: 'x', link: 'https://x.example', snippet: 'y' }]))
    try {
      const result = await serperSearchAdapter.healthCheck(SERPER_SOURCE)
      assert.equal(result.ok, true)
      assert.equal(result.status, 'healthy')
    } finally {
      restoreFetch()
    }
  })
})

await check('serper adapter healthCheck() reports "credential_required" (not "unavailable") on a 401/403', async () => {
  await withFakeDenoEnv({ SERPER_API_KEY: 'wrong-key' }, async () => {
    mockFetch(async () => jsonFetchResponse(null, { status: 403 }))
    try {
      const result = await serperSearchAdapter.healthCheck(SERPER_SOURCE)
      assert.equal(result.ok, false)
      assert.equal(result.status, 'credential_required')
    } finally {
      restoreFetch()
    }
  })
})

await check('serper adapter healthCheck() reports "unavailable" for a genuine network/timeout failure', async () => {
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async () => {
      throw new Error('network unreachable')
    })
    try {
      const result = await serperSearchAdapter.healthCheck(SERPER_SOURCE)
      assert.equal(result.ok, false)
      assert.equal(result.status, 'unavailable')
    } finally {
      restoreFetch()
    }
  })
})

await check('serper adapter validateConfig rejects a malformed queryTemplates as config_error, never silently defaulted', async () => {
  const result = await serperSearchAdapter.healthCheck({ config: { queryTemplates: 'not-an-array' } })
  assert.equal(result.status, 'config_error')
})

await check('ensureDefaultSources() registers Serper enabled by default and OSM disabled by default (fresh install)', async () => {
  const client = makeFakeClient()
  const [, serper, osm] = await ensureDefaultSources(client)
  assert.equal(serper.source_type, 'search_result')
  assert.equal(serper.enabled, true, 'Serper is the primary source - enabled out of the box')
  assert.ok(Array.isArray(serper.config.queryTemplates) && serper.config.queryTemplates.length > 0)
  assert.equal(osm.source_type, 'public_directory')
  assert.equal(osm.enabled, false, 'OSM starts disabled - kept only as an optional secondary/experimental source')
})

// ---------------------------------------------------------------------------
// Phase 23D - Smart Qualification 2.0 regression suite. Real production
// Serper discovery showed strong direct manufacturers (their own website,
// explicit manufacturing evidence) sitting in manual_review at scores
// 40-56, indistinguishable from articles/directories/social/video results
// that merely echoed similar keywords. These checks cover the exact
// categories the Phase 23D spec calls out: direct manufacturer, directory,
// article, Aparat, Instagram, marketplace, ambiguous/incomplete company,
// irrelevant business, duplicate manufacturer, and a direct manufacturer at
// only MEDIUM confidence (the core behavioral change - it must now qualify
// without needing the old score>=80 bar, while auto-promotion still does).
// ---------------------------------------------------------------------------

function qualifyFromSerperItem(rawItem, settingsOverride = {}) {
  const candidate = serperSearchAdapter.normalize(rawItem)
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: { ...DEFAULT_SETTINGS, ...settingsOverride } })
  return { candidate, evidence, scores, qualification }
}

// --- 1. Entity classification itself (pure, deterministic, no LLM) --------

await check('classifyEntityType: a real company domain with no listicle wording is direct_company', () => {
  assert.equal(
    classifyEntityType({ domain: 'tamashaplast.com', title: 'تماشاپلاست، تولیدکننده فیلم نایلونی', snippet: 'تولیدکننده فیلم پلی اتیلن' }),
    ENTITY_TYPES.DIRECT_COMPANY,
  )
})

await check('classifyEntityType: known video/social/marketplace domains are authoritative regardless of title wording', () => {
  assert.equal(classifyEntityType({ domain: 'aparat.com', title: 'کارخانه تولید فیلم پلاستیک' }), ENTITY_TYPES.VIDEO)
  assert.equal(classifyEntityType({ domain: 'instagram.com', title: 'تولیدکننده فیلم پلاستیک' }), ENTITY_TYPES.SOCIAL)
  assert.equal(classifyEntityType({ domain: 'divar.ir', title: 'کارخانه تولید فیلم پلاستیک' }), ENTITY_TYPES.MARKETPLACE)
})

await check('classifyEntityType: "بهترین تولیدکنندگان..." listicle wording is ARTICLE regardless of domain', () => {
  assert.equal(
    classifyEntityType({ domain: 'random-blog.example', title: 'بهترین تولیدکنندگان فیلم پلاستیک در ایران' }),
    ENTITY_TYPES.ARTICLE,
  )
  assert.equal(classifyEntityType({ domain: 'random-blog.example', title: 'لیست ۱۰ تولیدکننده برتر نایلون' }), ENTITY_TYPES.ARTICLE)
})

await check('classifyEntityType: "فهرست/دایرکتوری" wording is DIRECTORY_OR_LIST', () => {
  assert.equal(
    classifyEntityType({ domain: 'sanatgroup.example', title: 'فهرست تولیدکنندگان فیلم پلاستیک', snippet: 'دایرکتوری کامل کارخانه‌ها' }),
    ENTITY_TYPES.DIRECTORY_OR_LIST,
  )
})

await check('classifyEntityType: no domain and no red-flag text is unknown, never direct_company', () => {
  assert.equal(classifyEntityType({ domain: null, title: 'یک کسب‌وکار بدون وب‌سایت' }), ENTITY_TYPES.UNKNOWN)
})

// --- 2. Full pipeline: direct manufacturer (item 8's real examples) -------

await check('a strong direct manufacturer (tamashaplast.com-style) qualifies, but stays pending identity verification before auto-promoting', () => {
  const { qualification, scores, evidence } = qualifyFromSerperItem({
    title: 'تماشاپلاست، تولیدکننده فیلم نایلونی، صنعتی و کشاورزی',
    link: 'https://tamashaplast.com/',
    snippet:
      'تولیدکننده فیلم پلی اتیلن، فیلم کشاورزی و اکستروژن فیلم در ایران با خط تولید فعال، تلفن: 02144556677، موبایل: 09121234567، ایمیل: info@tamashaplast.com',
    _sourceQuery: 'تولید کننده فیلم پلی اتیلن',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(qualification.status, 'qualified')
  assert.equal(scores.confidence, 'high')
  // "FINAL AUTONOMY BLOCKER" round: a title/snippet self-declaration alone
  // (identity_source=self_declared) is only ever a HINT now, never enough
  // by itself to auto-promote - see the "identity verification" section
  // below for the full live-website-verification path that DOES unlock
  // this exact candidate once a real JSON-LD/og:site_name/homepage-title
  // match confirms it.
  assert.equal(matchedIdentity(evidence).source, 'self_declared')
  assert.equal(qualification.autoPromotable, false)
})

await check('a direct manufacturer (alborznylon.ir-style) with decent evidence and contact qualifies', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'شرکت البرز نایلون لاله',
    link: 'https://alborznylon.ir/',
    snippet: 'تولیدکننده نایلون و نایلکس صنعتی، فیلم پلاستیک بسته بندی، تلفن: 02633445566، موبایل: 09121112233',
    _sourceQuery: 'تولید کننده نایلون و نایلکس',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(qualification.status, 'qualified')
})

// --- 3. THE core behavioral change: medium confidence must still qualify --

await check('a direct manufacturer at only MEDIUM confidence now reaches "qualified" (would have needed score>=80 before)', () => {
  const { qualification, scores, evidence } = qualifyFromSerperItem({
    title: 'پوشان پلاستیک، تولیدکننده ظروف پلاستیکی صنعتی',
    link: 'https://pooshanplastic.com/',
    snippet: 'تولیدکننده ظروف پلاستیکی خانگی و صنعتی با خط تولید فعال، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده ظروف پلاستیکی',
  })
  assert.equal(scores.confidence, 'medium', 'test fixture must genuinely be medium confidence, not high')
  assert.ok(scores.overallScore < 80, 'test fixture must genuinely be below the old universal score>=80 bar')
  assert.equal(qualification.status, 'qualified')
  // 23D.2: a confirmed direct_company with real production evidence and
  // buyer_fit=high no longer needs confidence=high to auto-promote -
  // pooshanplastic.com is one of the EXPECTED HIGH BUYER FIT examples from
  // the 23D.2 spec, and should become auto_promotable even at only medium
  // confidence, unlike under 23D.1.
  assert.equal(matchedBuyerFit(evidence), 'high')
  // "FINAL AUTONOMY BLOCKER" round: unverified self-declared identity alone
  // no longer unlocks auto-promotion - see the "identity verification"
  // section below.
  assert.equal(qualification.autoPromotable, false)
})

// --- 4. Never auto-promote / never even "qualified": article, directory, --
// --- marketplace, social, video ------------------------------------------

await check('a "بهترین تولیدکنندگان..." article never qualifies or auto-promotes, even with matching keywords', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'بهترین تولیدکنندگان فیلم پلاستیک در ایران',
    link: 'https://some-blog.example/best-manufacturers',
    snippet: 'در این مقاله به معرفی برترین تولیدکنندگان فیلم پلی اتیلن و نایلون در ایران می‌پردازیم.',
    _sourceQuery: 'تولید کننده فیلم پلی اتیلن',
  })
  assert.equal(matchedEntityType(evidence), 'article')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('a directory/catalog page never qualifies or auto-promotes', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'فهرست تولیدکنندگان فیلم پلاستیک و نایلون در ایران',
    link: 'https://sanatgroup.example/directory',
    snippet: 'دایرکتوری کامل کارخانه‌های تولید فیلم و نایلون در سراسر کشور.',
    _sourceQuery: 'تولید کننده نایلون و نایلکس',
  })
  assert.equal(matchedEntityType(evidence), 'directory_or_list')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('an Aparat video result never qualifies or auto-promotes, even with a manufacturing-sounding title', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'بازدید از خط تولید کارخانه فیلم پلاستیک',
    link: 'https://www.aparat.com/v/xyz123',
    snippet: 'ویدیوی بازدید از کارخانه تولید فیلم پلی اتیلن',
    _sourceQuery: 'تولید کننده فیلم پلی اتیلن',
  })
  assert.equal(matchedEntityType(evidence), 'video')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('an Instagram post never qualifies or auto-promotes', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'تولیدکننده فیلم پلاستیک - صفحه اینستاگرام',
    link: 'https://www.instagram.com/somefactory/',
    snippet: 'تولیدکننده فیلم پلی اتیلن، برای سفارش دایرکت بدهید.',
    _sourceQuery: 'تولید کننده فیلم پلی اتیلن',
  })
  assert.equal(matchedEntityType(evidence), 'social')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('a marketplace ad result never qualifies or auto-promotes', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'فروش فیلم پلی اتیلن کشاورزی - آگهی',
    link: 'https://divar.ir/v/xyz',
    snippet: 'تولیدکننده فیلم پلی اتیلن کشاورزی، تماس بگیرید.',
    _sourceQuery: 'تولید کننده فیلم کشاورزی',
  })
  assert.equal(matchedEntityType(evidence), 'marketplace')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

// ---------------------------------------------------------------------------
// Phase 23D.1 - fixes for the SPECIFIC false positives/negatives the
// production dry-run of 2.0 exposed. Each of these was a REAL misclassified
// or over-conservative result from that dry-run.
// ---------------------------------------------------------------------------

await check('istgah.com (a general classifieds marketplace) is never direct_company, even with a manufacturing-sounding title', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'تولیدکننده لوله پلی اتیلن - آگهی در استگاه',
    link: 'https://istgah.com/ads/loole-polyethylene',
    snippet: 'فروش لوله پلی اتیلن صنعتی، تماس بگیرید.',
    _sourceQuery: 'تولید کننده لوله پلی اتیلن',
  })
  assert.equal(matchedEntityType(evidence), 'marketplace')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('bazarekeshavarzi.com (an agricultural marketplace) is never direct_company', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'تولیدکننده تیپ آبیاری قطره‌ای',
    link: 'https://bazarekeshavarzi.com/products/drip-tape',
    snippet: 'تولیدکننده و فروشنده تیپ آبیاری قطره‌ای برای مزارع کشاورزی.',
    _sourceQuery: 'تولید کننده تیپ آبیاری',
  })
  assert.equal(matchedEntityType(evidence), 'marketplace')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('a "my.<company>.ir" portal page with "قیمت و خرید" phrasing is a marketplace listing, not the company itself', () => {
  // The real 2.0 dry-run false positive (my.abyartajhiz.ir) - a portal-style
  // subdomain whose page reads like a price-listing/marketplace page rather
  // than the company's own identity page.
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'قیمت و خرید انواع تجهیزات آبیاری قطره‌ای',
    link: 'https://my.abyartajhiz.ir/products/drip-irrigation',
    snippet: 'بانک اطلاعات قیمت تجهیزات آبیاری قطره‌ای و بارانی از فروشندگان مختلف.',
    _sourceQuery: 'تولید کننده تیپ آبیاری',
  })
  assert.notEqual(matchedEntityType(evidence), 'direct_company')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('a URL PATH alone (e.g. /blog/...) is enough to classify a result as non-company, even with an unflagged domain and a plain title', () => {
  const entityType = classifyEntityType({
    domain: 'somecompany.example',
    title: 'شرکت تولیدی پلاستیک',
    snippet: 'یک نوشته درباره صنعت پلاستیک',
    url: 'https://somecompany.example/blog/post-1',
  })
  assert.equal(entityType, ENTITY_TYPES.ARTICLE)
})

await check('a real PE pipe manufacturer (pespipe.com-style) with one matched industry now qualifies at the new, lower bar', () => {
  const { qualification, scores, evidence } = qualifyFromSerperItem({
    title: 'شرکت پس پایپ، تولیدکننده لوله پلی اتیلن',
    link: 'https://pespipe.com/',
    snippet: 'تولیدکننده لوله پلی اتیلن صنعتی و کشاورزی با استانداردهای بین‌المللی، تلفن: 02133445566، موبایل: 09121112233',
    _sourceQuery: 'تولید کننده لوله پلی اتیلن',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high', 'explicit PE pipe production evidence must yield buyer_fit=high per the 23D.2 spec')
  assert.ok(scores.overallScore >= 45 && scores.overallScore < 80, 'test fixture must land in the new 45-79 qualify band, not the old 80+ one')
  assert.equal(qualification.status, 'qualified')
})

await check('a thin-evidence direct manufacturer scoring around 47 (the real alborznylon.ir/pooshanplastic.com production score) now qualifies', () => {
  // Deliberately minimal evidence (ONE matched industry keyword, mobile
  // only, no email) - mirrors what the real production dry-run reported
  // for alborznylon.ir/pooshanplastic.com ("still manual_review at 47")
  // before this fix.
  const { qualification, scores, evidence } = qualifyFromSerperItem({
    title: 'البرز نایلون لاله',
    link: 'https://alborznylon.ir/',
    snippet: 'تولیدکننده نایلون صنعتی، موبایل: 09121112233',
    _sourceQuery: 'تولید کننده نایلون و نایلکس',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.ok(scores.overallScore >= 45, `expected score >= 45, got ${scores.overallScore}`)
  assert.equal(qualification.status, 'qualified')
  // 23D.3: a confirmed company-owned website counts as a usable contact
  // channel for this gate. "FINAL AUTONOMY BLOCKER" round: contact channel
  // alone is no longer sufficient either - unverified self-declared
  // identity still blocks auto-promotion until a live website check
  // confirms it (see the "identity verification" section below).
  assert.equal(qualification.autoPromotable, false)
})

// ---------------------------------------------------------------------------
// Phase 23D.2 - Buyer Fit Qualification. entity_type=direct_company only
// answers "is this a real company" - buyer_fit is the SEPARATE question of
// whether that company would actually CONSUME masterbatch/pigments/polymer
// additives. Covers every specific example the 23D.2 spec calls out.
// ---------------------------------------------------------------------------

await check('pouryaplasticrey.com-style injection molder: direct_company + buyer_fit=high + auto_promotable', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'پوریا پلاستیک ری، تولیدکننده قطعات پلاستیکی تزریقی',
    link: 'https://pouryaplasticrey.com/',
    snippet: 'تولیدکننده قطعات پلاستیکی با تزریق پلاستیک صنعتی، تلفن: 02155667788، موبایل: 09121237788',
    _sourceQuery: 'کارخانه تزریق پلاستیک',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.equal(qualification.status, 'qualified')
  // "FINAL AUTONOMY BLOCKER" round: this is one of the EXACT production
  // false positives the round fixed (a real company self-declaration in
  // the snippet is still just a hint, not verified identity) - see the
  // "identity verification" section below for the live-website-check path
  // that legitimately unlocks this candidate.
  assert.equal(qualification.autoPromotable, false)
})

await check('saniplastmehr.com-style disposable-plastics manufacturer: direct_company + buyer_fit=high', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'صنایع پلاستیک مهر، تولیدکننده ظروف یکبار مصرف پلاستیکی',
    link: 'https://saniplastmehr.com/',
    snippet: 'تولیدکننده ظروف یکبار مصرف پلاستیکی با خط تولید فعال، تلفن: 02133112233، موبایل: 09121112244',
    _sourceQuery: 'تولید کننده ظروف یکبار مصرف',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.equal(qualification.status, 'qualified')
})

await check('mandegarpet.ir-style PET/preform manufacturer: direct_company + buyer_fit=high', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'ماندگار پت، تولیدکننده پریفرم و بطری PET',
    link: 'https://mandegarpet.ir/',
    snippet: 'تولیدکننده پریفرم PET و بطری پلاستیکی، تلفن: 02177889900، موبایل: 09121112255',
    _sourceQuery: 'تولید کننده PET و پریفرم',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.equal(qualification.status, 'qualified')
})

await check('a plastics trade association ("انجمن صنایع همگن پلاستیک") is buyer_fit=not_buyer, never qualified', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'انجمن صنایع همگن پلاستیک ایران',
    link: 'https://plasticassociation.example/',
    snippet: 'انجمن صنفی تولیدکنندگان صنایع پلاستیک و پلیمر کشور، نماینده تشکل‌های تولیدی این صنعت.',
    _sourceQuery: 'تولید کننده فیلم پلاستیک',
  })
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('a machinery/equipment association ("انجمن صنایع همگن ماشین سازان و تجهیزات پلیمری") is buyer_fit=not_buyer', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'انجمن صنایع همگن ماشین سازان و تجهیزات پلیمری',
    link: 'https://machineassociation.example/',
    snippet: 'انجمن صنفی سازندگان ماشین آلات و تجهیزات صنعت پلیمر کشور.',
    _sourceQuery: 'تولید کننده لوله پلی اتیلن',
  })
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('omidomranco.com-style greenhouse-film PRODUCTION LINE vendor is buyer_fit=not_buyer, not a film manufacturer', () => {
  // A machinery/equipment seller, not a processor - they sell the LINE that
  // makes greenhouse film, they don't run one themselves to consume resin.
  // 23D-FINAL section J: the machinery-seller signal now requires explicit
  // SELLING/MAKING-FOR-SALE framing ("فروش خط تولید", "تولیدکننده ماشین
  // آلات") - bare "ماشین آلات" co-occurring with a real production mention
  // is no longer enough on its own (a real processor may legitimately
  // mention its own equipment).
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'امید عمران، تولیدکننده ماشین آلات و خط تولید فیلم گلخانه‌ای',
    link: 'https://omidomranco.com/',
    snippet: 'طراحی و ساخت خط تولید فیلم کشاورزی و گلخانه‌ای، فروش خط تولید و تجهیزات کامل خط تولید نایلون.',
    _sourceQuery: 'تولید کننده فیلم کشاورزی',
  })
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('a masterbatch/pigment PRODUCER itself is a supply-side competitor - buyer_fit=low, never high', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'شرکت رنگدانه پارس، تولیدکننده مستربچ رنگی',
    link: 'https://parspigment.example/',
    snippet: 'تولیدکننده مستربچ رنگی و سفید برای صنایع پلاستیک، تلفن: 02144556677',
    _sourceQuery: 'تولید کننده کامپاند پلیمری',
  })
  assert.equal(matchedBuyerFit(evidence), 'low')
})

// ---------------------------------------------------------------------------
// Phase 23D.3 - the specific fixes: real auto_promotable=0 root cause
// (hasUsableContact requiring phone/email that most Serper snippets never
// have), OSM source-trust distrust, and hard medical/cosmetic false
// positives ("جراح پلاستیک" must never gain polymer buyer-fit).
// ---------------------------------------------------------------------------

await check('an OSM-only candidate ("دژ آب پلیمر"-style) is NOT auto-promotable even as a confirmed direct_company/buyer_fit=high', () => {
  const osmNode = {
    type: 'node',
    id: 987654321,
    tags: {
      name: 'دژ آب پلیمر',
      description: 'تولیدکننده لوله پلی اتیلن و اتصالات آب',
      website: 'http://dezabpolymer.example',
      phone: '+98 21 12345678',
    },
  }
  const candidate = osmOverpassAdapter.normalize(osmNode)
  assert.ok(candidate.source_url.includes('openstreetmap.org'), 'test fixture must genuinely be OSM-sourced')
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high')
  // Community-mapped OSM data is not treated as first-party identity
  // evidence strong enough for the relaxed auto-promote gate - it must
  // clear the ORIGINAL, stricter score/confidence/contact bar instead,
  // which this modest fixture does not.
  assert.equal(qualification.autoPromotable, false)
})

await check('a plastic surgeon ("جراح پلاستیک") never gains polymer buyer-fit from the word "پلاستیک"', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'دکتر محمد مهدی طرزی، جراح پلاستیک و زیبایی',
    link: 'https://drtarzi.example/',
    snippet: 'متخصص جراحی پلاستیک، جراحی زیبایی بینی و کلینیک زیبایی در تهران.',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
  assert.notEqual(qualification.status, 'qualified')
  assert.equal(qualification.autoPromotable, false)
})

// ---------------------------------------------------------------------------
// Phase 23D-FINAL - FULL BRAIN AUDIT regression suite. Covers section B
// (boundary-aware keyword matching), section A (real production false
// negatives: کادوس پلاستیک آریا, آرا پلیمر نیکان, فرزام بسپار), section C
// (structured OSM evidence), section D (absence of evidence != rejection),
// section G (company identity resolution), and section M (re-discovery
// rescue).
// ---------------------------------------------------------------------------

// --- Section B: the keyword-matching engine itself -------------------------

await check('findMatchingKeywordsStrict: "پزشکی" (medical) never matches "پزشک" (doctor) as a substring', () => {
  assert.deepEqual(findMatchingKeywordsStrict('محصولات پلاستیکی پزشکی', ['پزشک']), [])
  // Sanity check the OLD, broken substring behavior really would have
  // matched, so this test is proving something real, not a tautology.
  assert.ok('محصولات پلاستیکی پزشکی'.includes('پزشک'), 'sanity: naive substring matching DOES wrongly contain this')
})

await check('findMatchingKeywordsStrict: "جراحی" (surgery, noun) never matches "جراح" (surgeon) as a substring', () => {
  assert.deepEqual(findMatchingKeywordsStrict('این محصولات برای صنعت جراحی استفاده می‌شوند', ['جراح']), [])
})

await check('findMatchingKeywordsStrict still correctly matches exact multi-word phrases (جراح پلاستیک)', () => {
  assert.deepEqual(findMatchingKeywordsStrict('دکتر طرزی، جراح پلاستیک', ['جراح پلاستیک']), ['جراح پلاستیک'])
})

await check(
  'a plastics manufacturer explicitly making MEDICAL products ("قطعات پلاستیکی پزشکی") is never misread as a medical clinic (فرزام بسپار false positive)',
  () => {
    const NEGATIVE_MEDICAL_KEYWORDS = NEGATIVE_SIGNALS.find((s) => s.key === 'medical_cosmetic').keywords
    const text = 'تولید کننده انواع قطعات پلاستیکی خودرویی، خانگی، لوله و اتصالات پلاستیکی، محصولات پلاستیکی پزشکی'
    assert.deepEqual(findMatchingKeywordsStrict(text, NEGATIVE_MEDICAL_KEYWORDS), [], 'must not trip the medical/cosmetic negative signal')
  },
)

await check('farzambaspar.ir-style plastic-parts manufacturer with "پزشکی" wording qualifies with buyer_fit=high, never not_buyer/medical', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'شرکت فرزام بسپار، تولیدکننده قطعات پلاستیکی',
    link: 'https://farzambaspar.ir/',
    snippet:
      'تولید کننده انواع قطعات پلاستیکی خودرویی، خانگی، لوله و اتصالات پلاستیکی، محصولات پلاستیکی پزشکی، تلفن: 02144556677',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.equal(qualification.status, 'qualified')
})

await check('a manufacturer legitimately mentioning its own production equipment ("با ماشین تزریق مدرن") is not misread as a machinery seller', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'شرکت نمونه، تولیدکننده قطعات پلاستیکی تزریقی',
    link: 'https://example-molder.example/',
    snippet: 'تولید قطعات پلاستیکی با ماشین تزریق مدرن و خط تولید فعال، تلفن: 02144556677',
    _sourceQuery: 'کارخانه تزریق پلاستیک',
  })
  assert.equal(evidence.some((e) => e.evidenceType === 'non_buyer_organization' && e.meta?.nonBuyerKey === 'machinery_supplier'), false)
  assert.equal(matchedBuyerFit(evidence), 'high')
})

await check('a manufacturer selling its own products ("فروش محصولات ما") stays direct_company/buyer_fit=high, not marketplace', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'صنایع پلیمر نمونه، تولیدکننده لوله پلی اتیلن',
    link: 'https://example-pipe.example/',
    snippet: 'تولیدکننده لوله پلی اتیلن صنعتی، فروش مستقیم محصولات کارخانه، تلفن: 02144556677',
    _sourceQuery: 'تولید کننده لوله پلی اتیلن',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high')
})

// --- Section A/C: real production false negatives + structured OSM evidence

await check('کادوس پلاستیک آریا (kadousplastic.com, OSM man_made=works + بادی/تزریقی wording) is no longer rejected', () => {
  const osmNode = {
    type: 'node',
    id: 111222333,
    tags: {
      name: 'کادوس پلاستیک آریا',
      man_made: 'works',
      product: 'plastic;plastic_products',
      description: 'تولید کننده انواع قطعات پلاستیکی به روش بادی و تزریقی',
      website: 'http://kadousplastic.com',
      email: 'info@kadousplastic.com',
      phone: '+98 21 55667788',
      'addr:city': 'Tehran',
    },
  }
  const candidate = osmOverpassAdapter.normalize(osmNode)
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.ok(
    evidence.some((e) => e.evidenceType === 'structured_industrial_signal'),
    'man_made=works + product=plastic_products must be recognized as structured evidence',
  )
  assert.notEqual(qualification.status, 'rejected')
  assert.equal(matchedBuyerFit(evidence), 'high')
})

await check('آرا پلیمر نیکان (arapolymerco.com, OSM man_made=works + recycling:plastic=yes) is no longer rejected as a mixed-role processor', () => {
  const osmNode = {
    type: 'node',
    id: 444555666,
    tags: {
      name: 'شرکت آرا پلیمر نیکان',
      man_made: 'works',
      product: 'plastic',
      'recycling:plastic': 'yes',
      website: 'http://arapolymerco.com',
      email: 'info@arapolymerco.com',
      phone: '+98 21 44556677',
    },
  }
  const candidate = osmOverpassAdapter.normalize(osmNode)
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.ok(evidence.some((e) => e.evidenceType === 'structured_industrial_signal'))
  assert.notEqual(qualification.status, 'rejected')
})

// --- Section D: absence of evidence != rejection ---------------------------

await check('a candidate with enough text but genuinely no matched evidence and no negative signal goes to manual_review, never rejected (section D)', () => {
  const candidate = {
    canonical_name: 'کسب‌وکار نامشخص',
    business_description: 'این یک توضیح نسبتاً طولانی است که هیچ کلیدواژه صنعتی شناخته‌شده‌ای در آن وجود ندارد و هیچ نشانه منفی هم ندارد.',
  }
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  const qualification = qualifyCandidate({ candidate, evidence, scores, settings: DEFAULT_SETTINGS })
  assert.equal(qualification.status, 'manual_review', 'uncertainty must trigger investigation, never a silent rejection')
})

// --- Section G: company identity resolution ---------------------------------

await check('serper normalize() resolves the real company name from "X، تولیدکننده Y" self-identification, not the raw title text', () => {
  const normalized = serperSearchAdapter.normalize({
    title: 'پوریا پلاستیک ری، تولیدکننده قطعات پلاستیکی تزریقی',
    link: 'https://pouryaplasticrey.com/',
    snippet: 'تولیدکننده قطعات پلاستیکی با تزریق پلاستیک صنعتی',
  })
  assert.equal(normalized.canonical_name, 'پوریا پلاستیک ری')
})

await check('serper normalize() falls back to the domain (never a bare product name) when the title has no company self-identification anywhere', () => {
  const normalized = serperSearchAdapter.normalize({
    title: 'فیلم پلی اتیلن',
    link: 'https://somecompany-example.com/products/film',
    snippet: 'مشخصات فنی و کاربردهای فیلم پلی اتیلن کشاورزی.',
  })
  assert.notEqual(normalized.canonical_name, 'فیلم پلی اتیلن', 'a bare product name must never become the company_name')
  assert.equal(normalized.canonical_name, 'somecompany example')
})

// --- Section M: re-discovery must re-evaluate, never leave a stale decision

await check('re-discovering the same source item rescores it under the CURRENT logic - a stale manual_review decision never lives forever', async () => {
  const client = makeFakeClient()
  const weakRow = {
    company_name: 'شرکت ناشناخته پلیمر',
    business_description: 'یک توضیح کوتاه بدون جزئیات فنی',
    source_external_id: 'ext-rescue-1',
  }
  const firstRun = await runUploadedDatasetDiscovery(client, { rows: [weakRow], createdBy: 'admin-1' })
  assert.equal(firstRun.status, 'completed')
  const firstCandidate = client.tables.prospect_candidates.find((c) => c.source_external_id === 'ext-rescue-1')
  assert.equal(firstCandidate.status, 'manual_review')

  // Same source item, rediscovered once richer information is available -
  // the OLD bug would have only touched last_seen_at/discovery_run_id here
  // and left the row stuck at manual_review forever, no matter how much
  // the classifier itself had since improved.
  const strongRow = {
    company_name: 'صنایع پلیمر امید',
    business_description: 'تولیدکننده لوله پلی اتیلن صنعتی با خط تولید فعال',
    mobile: '09121234567',
    website: 'https://polymer-omid.example/',
    source_external_id: 'ext-rescue-1',
  }
  const secondRun = await runUploadedDatasetDiscovery(client, { rows: [strongRow], createdBy: 'admin-1' })
  assert.equal(secondRun.status, 'completed')
  assert.equal(client.tables.prospect_candidates.length, 1, 'still exactly one row - a refresh, never a duplicate')
  const rescued = client.tables.prospect_candidates[0]
  assert.equal(rescued.canonical_name, 'صنایع پلیمر امید', 'normalized fields must be refreshed too, not just the status')
  assert.notEqual(rescued.status, 'manual_review', 'must have moved on from the stale decision')
})

await check('re-discovering an already-PROMOTED candidate never re-scores it or creates a second lead', async () => {
  const client = makeFakeClient()
  const row = {
    company_name: 'صنایع پلیمر امید',
    business_description: 'تولیدکننده لوله پلی اتیلن صنعتی با خط تولید فعال',
    mobile: '09121234567',
    website: 'https://polymer-omid.example/',
    source_external_id: 'ext-promoted-1',
  }
  await runUploadedDatasetDiscovery(client, { rows: [row], createdBy: 'admin-1' })
  const candidateId = client.tables.prospect_candidates[0].id
  await promoteCandidate(client, candidateId, { createdBy: 'admin-1' })
  assert.equal(client.tables.prospect_candidates[0].status, 'promoted')

  await runUploadedDatasetDiscovery(client, { rows: [row], createdBy: 'admin-1' })
  assert.equal(client.tables.prospect_candidates.length, 1)
  assert.equal(client.tables.prospect_candidates[0].status, 'promoted', 'a promoted row must never be re-scored back to another status')
  assert.equal(client.tables.sales_leads.length, 1, 'rediscovery must never create a second lead')
})

// ---------------------------------------------------------------------------
// Phase 23D-FINAL.1 - "Fix the audit itself" regression suite.
// ---------------------------------------------------------------------------

// --- Section 8: confidence vocabulary integrity ----------------------------

await check('computeConfidence() NEVER returns anything outside {high, medium, low} - never a status value', () => {
  const VALID_CONFIDENCE_VALUES = new Set(['high', 'medium', 'low'])
  const cases = [
    { overallScore: 0, evidence: [] },
    { overallScore: 90, evidence: [{ evidenceType: 'negative_signal', weight: -25 }] },
    { overallScore: 90, evidence: [{ evidenceType: 'industry_keyword', meta: { industryKey: 'a' } }, { evidenceType: 'industry_keyword', meta: { industryKey: 'b' } }] },
    { overallScore: 40, evidence: [{ evidenceType: 'generic_manufacturing_signal' }] },
  ]
  for (const testCase of cases) {
    const confidence = computeConfidence(testCase)
    assert.ok(VALID_CONFIDENCE_VALUES.has(confidence), `computeConfidence() returned an invalid value: "${confidence}"`)
  }
})

await check('a candidate with zero evidence gets confidence="low" (not the old, invalid "manual_review" value)', () => {
  const candidate = { canonical_name: 'شرکت ناشناخته' }
  const evidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, evidence)
  assert.equal(scores.confidence, 'low')
})

// --- Section 4: the three named auto-promotable false positives, with the
// --- EXACT titles/URLs given -----------------------------------------------

await check('omidomranco.com-style page with ONLY the real title "خط تولید نایلون گلخانه ای" is a machinery vendor, never a polymer buyer', () => {
  // "FINAL REGRESSION FIX" round, item 3: the bare title alone used to
  // land on buyer_fit=medium/business_role=mixed - "خط تولید نایلون
  // گلخانه‌ای" ("the greenhouse-nylon production LINE") was matching
  // TARGET_INDUSTRIES' plain product keywords ("نایلون"/"نایلون گلخانه")
  // as if the page claimed to PRODUCE nylon, when it is actually naming a
  // MACHINE for sale. See isMachineryNamedProduct() in evidenceEngine.js.
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'خط تولید نایلون گلخانه ای',
    link: 'https://omidomranco.com/greenhouse-film-production-line/',
    snippet: '',
    _sourceQuery: 'تولید کننده فیلم کشاورزی',
  })
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
  assert.equal(matchedBusinessRole(evidence), 'machinery_supplier')
  assert.equal(qualification.autoPromotable, false)
})

await check('a manufacturer that ALSO runs its own retail/dealership channel ("نمایندگی فروش و تولید...") keeps buyer_fit=high, not not_buyer', () => {
  // "FINAL REGRESSION FIX" round, item 2 (generalized part-lux.ir root
  // cause): a real producer describing itself with BOTH manufacturing
  // language AND its own retail/dealership channel must not be dragged
  // down to not_buyer purely by the retail_only negative signal.
  const { evidence } = qualifyFromSerperItem({
    title: 'پارت لوکس، نمایندگی فروش و تولید کننده قطعات پلاستیکی خودرو',
    link: 'https://part-lux2-example.com/',
    snippet: 'کارخانه تولید و نمایندگی فروش قطعات پلاستیکی خودرو، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedBuyerFit(evidence), 'high', 'a genuine producer must not lose buyer_fit=high merely for ALSO mentioning its own retail/dealership channel')
})

await check('a genuinely UNRELATED retail-only business stays buyer_fit=not_buyer even if an unrelated word happens to contain "تولید"', () => {
  // The exemption above is narrow: it requires a REAL
  // MANUFACTURING_INDICATOR_TERMS match ("کارخانه"/"تولیدکننده"/...), never
  // just any co-occurring "تولید"-containing phrase ("تولید شده توسط تیم
  // بازاریابی" - "produced by our marketing team" - is not a
  // manufacturing self-declaration).
  const { evidence } = qualifyFromSerperItem({
    title: 'فروشگاه لوازم پلاستیکی رضا',
    link: 'https://rezaplastic-shop2.example/',
    snippet: 'فروشگاه خرده فروشی لوازم پلاستیکی خانگی، محتوای تولید شده توسط تیم بازاریابی ما، تلفن: 02144556677',
    _sourceQuery: 'تولید کننده ظروف پلاستیکی',
  })
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
})

await check('"خط تولید X" is left alone (not treated as machinery) when the SAME text also independently self-identifies as a producer elsewhere', () => {
  // The guard: a real processor genuinely describing their own production
  // capacity ("کارخانه تولیدی ما دارای خط تولید فیلم پلی اتیلن است") must
  // not lose that industry evidence just because "خط تولید" appears -
  // MANUFACTURING_INDICATOR_TERMS ("کارخانه") already self-identifies them
  // as a real producer, which wins over the ambiguous "خط تولید X" phrase.
  const { evidence } = qualifyFromSerperItem({
    title: 'کارخانه تولیدی نمونه',
    link: 'https://realmanufacturer2-example.com/',
    snippet: 'کارخانه تولیدی ما دارای خط تولید فیلم پلی اتیلن با ظرفیت بالا است، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده فیلم پلی اتیلن',
  })
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.notEqual(matchedBusinessRole(evidence), 'machinery_supplier')
})

await check('my.abyartajhiz.ir-style page with the real title "شرکت های تولید کننده نوار تیپ" is a directory, never direct_company/qualified/auto_promotable', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'شرکت های تولید کننده نوار تیپ',
    link: 'https://my.abyartajhiz.ir/keys/drip-tape-manufacturers',
    snippet: 'فهرستی از شرکت های تولید کننده نوار تیپ آبیاری قطره ای در ایران.',
    _sourceQuery: 'تولید کننده تیپ آبیاری',
  })
  assert.equal(matchedEntityType(evidence), 'directory_or_list')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('hadiplastic.ir/view/articleid/95 with the real title "معرفی معروف ترین کارگاه های تزریق پلاستیک در ایران" is an article, never a company', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'معرفی معروف ترین کارگاه های تزریق پلاستیک در ایران',
    link: 'https://hadiplastic.ir/view/articleid/95',
    snippet: 'در این مقاله به معرفی معروف‌ترین کارگاه‌های تزریق پلاستیک در ایران می‌پردازیم.',
    _sourceQuery: 'کارخانه تزریق پلاستیک',
  })
  assert.equal(matchedEntityType(evidence), 'article', 'both the title wording AND the /articleid/ URL path must be recognized')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

await check('classifyEntityType: a CMS route segment like "/view/articleid/95" is recognized via URL path alone', () => {
  assert.equal(classifyEntityType({ domain: 'example.com', title: 'یک عنوان عادی', url: 'https://example.com/view/articleid/95' }), ENTITY_TYPES.ARTICLE)
})

// --- Section 6: company identity resolution gates auto-promotion -----------

await check('a bare product-title result that falls back to a domain-only identity is never auto-promotable, even with strong buyer_fit', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'نایلون شرینک',
    link: 'https://realmanufacturer-example.com/',
    snippet: 'تولیدکننده نایلون شرینک صنعتی، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده نایلون و نایلکس',
  })
  // Strong evidence-wise (buyer_fit=high is plausible here), but the NAME
  // itself never resolved beyond the domain fallback - resolved_company_name
  // quality must independently block auto-promotion.
  assert.equal(qualification.autoPromotable, false, 'unresolved/domain-fallback identity must block auto-promotion regardless of buyer_fit')
})

await check('a title/snippet self-declared identity ("X، تولیدکننده Y") alone is a hint, NOT enough to auto-promote without live website verification', () => {
  // "FINAL AUTONOMY BLOCKER" round, section 1: production auditing showed
  // self_declared (an unverified search-snippet regex match) was too
  // permissive - it could still be a product/page title that happened to
  // loosely match. Auto-promotion now requires identity_status=verified or
  // a STRONG probable source (jsonld/og/homepage-title/about/contact - see
  // identityResolution.js's isPromotableIdentity()), never self_declared by
  // itself.
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'شرکت واقعی نمونه، تولیدکننده نایلون شرینک',
    link: 'https://realmanufacturer-example.com/',
    snippet: 'تولیدکننده نایلون شرینک صنعتی، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده نایلون و نایلکس',
  })
  assert.equal(matchedIdentity(evidence).source, 'self_declared')
  assert.equal(matchedIdentity(evidence).status, 'probable')
  assert.equal(qualification.autoPromotable, false)
})

// ---------------------------------------------------------------------------
// "FINAL AUTONOMY BLOCKER" round - IDENTITY VERIFICATION. resolveVerifiedIdentity()
// is pure/synchronous decision logic over already-extracted page signals
// (never fetches anything itself) - tested here with SYNTHETIC fixtures to
// validate the GENERAL priority mechanism, never a hardcoded per-domain
// special case. fetchIdentitySignals()/qualifyWithIdentityVerification()
// below then test the actual fetch+extraction+requalification path with a
// mocked globalThis.fetch, including against the real named production
// examples (pouryaplasticrey.com-style).
// ---------------------------------------------------------------------------

await check('resolveVerifiedIdentity(): JSON-LD Organization.name outranks every other signal', () => {
  const identity = resolveVerifiedIdentity({
    domain: 'example.com',
    signals: {
      jsonLdOrganizationName: 'شرکت نمونه پلیمر',
      ogSiteName: 'نام دیگر',
      titleText: 'صفحه‌ای دیگر | خانه',
      aboutText: null,
      contactText: null,
    },
    baseline: { resolvedName: 'نادیده گرفته شود', source: 'self_declared', status: 'probable' },
  })
  assert.deepEqual(identity, { resolvedName: 'شرکت نمونه پلیمر', source: IDENTITY_SOURCES.JSONLD_ORGANIZATION, status: IDENTITY_STATUS.VERIFIED })
})

await check('resolveVerifiedIdentity(): og:site_name is used when no JSON-LD organization is present', () => {
  const identity = resolveVerifiedIdentity({
    domain: 'example.com',
    signals: { jsonLdOrganizationName: null, ogSiteName: 'شرکت نمونه پلیمر', titleText: 'صفحه‌ای دیگر', aboutText: null, contactText: null },
    baseline: null,
  })
  assert.equal(identity.source, IDENTITY_SOURCES.OG_SITE_NAME)
  assert.equal(identity.status, IDENTITY_STATUS.VERIFIED)
  assert.equal(identity.resolvedName, 'شرکت نمونه پلیمر')
})

await check('resolveVerifiedIdentity(): homepage <title> brand segment prefers the segment matching the domain when several exist', () => {
  const identity = resolveVerifiedIdentity({
    domain: 'samplepolymer.com',
    signals: { jsonLdOrganizationName: null, ogSiteName: null, titleText: 'صفحه اصلی | SamplePolymer Co.', aboutText: null, contactText: null },
    baseline: null,
  })
  assert.equal(identity.source, IDENTITY_SOURCES.HOMEPAGE_BRAND)
  assert.equal(identity.status, IDENTITY_STATUS.PROBABLE)
  assert.equal(identity.resolvedName, 'SamplePolymer Co.')
})

await check('resolveVerifiedIdentity(): homepage <title> falls back to the FIRST segment when no segment matches the domain', () => {
  const identity = resolveVerifiedIdentity({
    domain: 'unrelated-domain.example',
    signals: { jsonLdOrganizationName: null, ogSiteName: null, titleText: 'شرکت نمونه پلیمر | صفحه اصلی', aboutText: null, contactText: null },
    baseline: null,
  })
  assert.equal(identity.source, IDENTITY_SOURCES.HOMEPAGE_BRAND)
  assert.equal(identity.resolvedName, 'شرکت نمونه پلیمر')
})

await check('resolveVerifiedIdentity(): an About-page self-declaration is used when nothing else on the page resolves', () => {
  const identity = resolveVerifiedIdentity({
    domain: 'example.com',
    signals: {
      jsonLdOrganizationName: null,
      ogSiteName: null,
      titleText: null,
      aboutText: 'شرکت نمونه پلیمر، تولیدکننده قطعات پلاستیکی از سال ۱۳۸۵',
      contactText: null,
    },
    baseline: null,
  })
  assert.equal(identity.source, IDENTITY_SOURCES.ABOUT_PAGE)
  assert.equal(identity.status, IDENTITY_STATUS.PROBABLE)
  assert.equal(identity.resolvedName, 'شرکت نمونه پلیمر')
})

await check('resolveVerifiedIdentity(): a Contact-page self-declaration is the last live-page resort', () => {
  const identity = resolveVerifiedIdentity({
    domain: 'example.com',
    signals: {
      jsonLdOrganizationName: null,
      ogSiteName: null,
      titleText: null,
      aboutText: null,
      contactText: 'برای تماس با شرکت نمونه پلیمر، با شماره زیر تماس بگیرید',
    },
    baseline: null,
  })
  assert.equal(identity.source, IDENTITY_SOURCES.CONTACT_PAGE)
  assert.equal(identity.resolvedName, 'شرکت نمونه پلیمر')
})

await check('resolveVerifiedIdentity(): falls back to the baseline identity when the live page confirms nothing new (never worse than before the fetch)', () => {
  const baseline = { resolvedName: 'نام پایه', source: 'self_declared', status: 'probable' }
  const identity = resolveVerifiedIdentity({
    domain: 'example.com',
    signals: { jsonLdOrganizationName: null, ogSiteName: null, titleText: null, aboutText: null, contactText: null },
    baseline,
  })
  assert.deepEqual(identity, baseline)
})

await check('resolveVerifiedIdentity(): unresolved when nothing is found anywhere and there is no baseline', () => {
  const identity = resolveVerifiedIdentity({ domain: 'example.com', signals: {}, baseline: null })
  assert.equal(identity.resolvedName, null)
  assert.equal(identity.status, IDENTITY_STATUS.UNRESOLVED)
})

await check('isPromotableIdentity(): verified always passes; probable passes ONLY from a strong page-derived source; self_declared/domain_fallback/unresolved never pass', () => {
  assert.equal(isPromotableIdentity({ resolvedName: 'شرکت نمونه', source: IDENTITY_SOURCES.STRUCTURED_SOURCE, status: IDENTITY_STATUS.VERIFIED }), true)
  assert.equal(isPromotableIdentity({ resolvedName: 'شرکت نمونه', source: IDENTITY_SOURCES.JSONLD_ORGANIZATION, status: IDENTITY_STATUS.VERIFIED }), true)
  assert.equal(isPromotableIdentity({ resolvedName: 'شرکت نمونه', source: IDENTITY_SOURCES.HOMEPAGE_BRAND, status: IDENTITY_STATUS.PROBABLE }), true)
  assert.equal(isPromotableIdentity({ resolvedName: 'شرکت نمونه', source: IDENTITY_SOURCES.ABOUT_PAGE, status: IDENTITY_STATUS.PROBABLE }), true)
  assert.equal(isPromotableIdentity({ resolvedName: 'شرکت نمونه', source: IDENTITY_SOURCES.CONTACT_PAGE, status: IDENTITY_STATUS.PROBABLE }), true)
  assert.equal(isPromotableIdentity({ resolvedName: 'شرکت نمونه', source: IDENTITY_SOURCES.SELF_DECLARED, status: IDENTITY_STATUS.PROBABLE }), false)
  assert.equal(isPromotableIdentity({ resolvedName: 'شرکت نمونه', source: IDENTITY_SOURCES.DOMAIN_FALLBACK, status: IDENTITY_STATUS.UNRESOLVED }), false)
  assert.equal(isPromotableIdentity({ resolvedName: null, source: IDENTITY_SOURCES.STRUCTURED_SOURCE, status: IDENTITY_STATUS.VERIFIED }), false)
})

await check('isPromotableIdentity(): a generic page/product-title name is rejected even from an otherwise-strong verified source (the "no exceptions" invariant)', () => {
  assert.equal(isPromotableIdentity({ resolvedName: 'سایت تولید قطعات پلاستیک', source: IDENTITY_SOURCES.JSONLD_ORGANIZATION, status: IDENTITY_STATUS.VERIFIED }), false)
  assert.equal(isPromotableIdentity({ resolvedName: 'خط تولید نایلون گلخانه ای', source: IDENTITY_SOURCES.HOMEPAGE_BRAND, status: IDENTITY_STATUS.PROBABLE }), false)
  assert.equal(isPromotableIdentity({ resolvedName: 'گروه صنعتی انتخاب', source: IDENTITY_SOURCES.HOMEPAGE_BRAND, status: IDENTITY_STATUS.PROBABLE }), true)
})

await check('fetchIdentitySignals(): extracts JSON-LD Organization.name, og:site_name and <title>, and follows About/Contact links on the homepage', async () => {
  const homepageHtml = `<html><head>
    <title>صفحه اصلی | نمونه پلیمر</title>
    <meta property="og:site_name" content="نمونه پلیمر آنلاین">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"شرکت نمونه پلیمر رسمی"}</script>
  </head><body>
    <a href="/about-us">درباره ما</a>
    <a href="/contact">تماس با ما</a>
  </body></html>`
  const aboutHtml = '<html><body><p>شرکت نمونه پلیمر رسمی، تولیدکننده قطعات پلاستیکی صنعتی</p></body></html>'
  const contactHtml = '<html><body><p>شرکت نمونه پلیمر رسمی، برای تماس با ما پیام دهید</p></body></html>'
  mockFetch(async (url) => {
    if (url === 'https://samplepolymer.example/') return { ok: true, headers: { get: () => 'text/html' }, text: async () => homepageHtml }
    if (url === 'https://samplepolymer.example/about-us') return { ok: true, headers: { get: () => 'text/html' }, text: async () => aboutHtml }
    if (url === 'https://samplepolymer.example/contact') return { ok: true, headers: { get: () => 'text/html' }, text: async () => contactHtml }
    return { ok: false, headers: { get: () => '' } }
  })
  try {
    const signals = await fetchIdentitySignals({ homepageUrl: 'https://samplepolymer.example/' })
    assert.equal(signals.ok, true)
    assert.equal(signals.jsonLdOrganizationName, 'شرکت نمونه پلیمر رسمی')
    assert.equal(signals.ogSiteName, 'نمونه پلیمر آنلاین')
    assert.equal(signals.titleText, 'صفحه اصلی | نمونه پلیمر')
    assert.ok(signals.aboutText.includes('تولیدکننده قطعات پلاستیکی صنعتی'))
    assert.ok(signals.contactText.includes('شرکت نمونه پلیمر رسمی'))
  } finally {
    restoreFetch()
  }
})

await check('fetchIdentitySignals(): a fetch failure never throws - it returns ok:false, treated as "learned nothing new"', async () => {
  mockFetch(async () => {
    throw new Error('network unreachable')
  })
  try {
    const signals = await fetchIdentitySignals({ homepageUrl: 'https://unreachable.example/' })
    assert.equal(signals.ok, false)
    assert.equal(signals.jsonLdOrganizationName, null)
  } finally {
    restoreFetch()
  }
})

function realManufacturerQualifiedCandidate() {
  return serperSearchAdapter.normalize({
    title: 'پوریا پلاستیک ری، تولیدکننده قطعات پلاستیکی تزریقی',
    link: 'https://pouryaplasticrey.com/',
    snippet: 'تولیدکننده قطعات پلاستیکی با تزریق پلاستیک صنعتی، تلفن: 02155667788، موبایل: 09121237788',
    _sourceQuery: 'کارخانه تزریق پلاستیک',
  })
}

await check('qualifyWithIdentityVerification(): a self-declared-only candidate becomes safely auto-promotable once a live JSON-LD Organization.name confirms it (pouryaplasticrey.com-style)', async () => {
  const candidate = realManufacturerQualifiedCandidate()
  const baseEvidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, baseEvidence)
  assert.equal(matchedIdentity(baseEvidence).source, 'self_declared')

  mockFetch(async () => ({
    ok: true,
    headers: { get: () => 'text/html' },
    text: async () =>
      '<html><head><script type="application/ld+json">{"@type":"Organization","name":"شرکت پوریا پلاستیک ری"}</script></head><body></body></html>',
  }))
  try {
    const identityBudget = { remaining: 5 }
    const { evidence, qualification } = await qualifyWithIdentityVerification({
      candidate,
      evidence: baseEvidence,
      scores,
      settings: DEFAULT_SETTINGS,
      identityBudget,
    })
    const identity = matchedIdentity(evidence)
    assert.equal(identity.source, 'jsonld_organization')
    assert.equal(identity.status, 'verified')
    assert.equal(identity.resolvedName, 'شرکت پوریا پلاستیک ری')
    assert.equal(qualification.status, 'qualified')
    assert.equal(qualification.autoPromotable, true)
    assert.equal(identityBudget.remaining, 4, 'exactly one fetch attempt must be spent')
  } finally {
    restoreFetch()
  }
})

await check('qualifyWithIdentityVerification(): a live-website fetch FAILURE never makes things worse - stays exactly as blocked as before the attempt', async () => {
  const candidate = realManufacturerQualifiedCandidate()
  const baseEvidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, baseEvidence)
  mockFetch(async () => {
    throw new Error('network unreachable')
  })
  try {
    const identityBudget = { remaining: 5 }
    const { qualification } = await qualifyWithIdentityVerification({
      candidate,
      evidence: baseEvidence,
      scores,
      settings: DEFAULT_SETTINGS,
      identityBudget,
    })
    assert.equal(qualification.status, 'qualified')
    assert.equal(qualification.autoPromotable, false)
    assert.equal(identityBudget.remaining, 4, 'the attempt still consumes budget even when it fails')
  } finally {
    restoreFetch()
  }
})

await check('qualifyWithIdentityVerification(): verification is skipped entirely once the per-run fetch budget is exhausted', async () => {
  const candidate = realManufacturerQualifiedCandidate()
  const baseEvidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, baseEvidence)
  let fetchCalled = false
  mockFetch(async () => {
    fetchCalled = true
    return { ok: true, headers: { get: () => 'text/html' }, text: async () => '<html></html>' }
  })
  try {
    const identityBudget = { remaining: 0 }
    const { qualification } = await qualifyWithIdentityVerification({
      candidate,
      evidence: baseEvidence,
      scores,
      settings: DEFAULT_SETTINGS,
      identityBudget,
    })
    assert.equal(fetchCalled, false)
    assert.equal(qualification.autoPromotable, false)
  } finally {
    restoreFetch()
  }
})

await check('runComprehensiveAudit() performs live identity verification and safely auto-promotes a Serper-shaped candidate once JSON-LD confirms its real company name', async () => {
  const client = makeFakeClient()
  client.from('prospect_candidates').insert({
    canonical_name: 'پوریا پلاستیک ری',
    raw_name: 'پوریا پلاستیک ری، تولیدکننده قطعات پلاستیکی تزریقی',
    business_description: 'تولیدکننده قطعات پلاستیکی با تزریق پلاستیک صنعتی، تلفن: 02155667788، موبایل: 09121237788',
    website: 'https://pouryaplasticrey.example/',
    domain: 'pouryaplasticrey.example',
    mobile: '09121237788',
    phone: '02155667788',
    source_url: 'https://pouryaplasticrey.example/',
    raw_data: { link: 'https://pouryaplasticrey.example/', title: 'پوریا پلاستیک ری، تولیدکننده قطعات پلاستیکی تزریقی' },
    status: 'manual_review',
  })
  mockFetch(async () => ({
    ok: true,
    headers: { get: () => 'text/html' },
    text: async () =>
      '<html><head><script type="application/ld+json">{"@type":"Organization","name":"شرکت پوریا پلاستیک ری"}</script></head><body></body></html>',
  }))
  try {
    const audit = await runComprehensiveAudit(client)
    const prediction = audit.predictions.find((p) => p.name === 'پوریا پلاستیک ری')
    assert.ok(prediction, 'the candidate must appear in the audit')
    assert.equal(prediction.predicted_status, 'qualified')
    assert.equal(prediction.predicted_auto_promotable, true)
    assert.equal(prediction.identity_source, 'jsonld_organization')
    assert.equal(prediction.resolved_company_name, 'شرکت پوریا پلاستیک ری')
    assert.ok(audit.identityVerificationAttempted >= 1)
    assert.ok(audit.identityVerifiedCount >= 1)
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// "FINAL REGRESSION FIX" round, item 1 - Entekhab Group: the real production
// resolved_company_name was "سایت تولید قطعات پلاستیک &#8211; گروه صنعتی
// انتخاب" (an undecoded HTML entity + a generic page-description segment
// picked over the real brand segment). Both root causes fixed generically -
// decodeHtmlEntities() (websiteEnrichment.js) and isPlausibleOrganizationName
// -aware segment filtering (identityResolution.js) - never a hardcoded
// per-domain name.
// ---------------------------------------------------------------------------

await check('decodeHtmlEntities(): decodes numeric decimal, numeric hex, and common named HTML entities', () => {
  assert.equal(decodeHtmlEntities('سایت تولید قطعات پلاستیک &#8211; گروه صنعتی انتخاب'), 'سایت تولید قطعات پلاستیک – گروه صنعتی انتخاب')
  assert.equal(decodeHtmlEntities('A &amp; B'), 'A & B')
  assert.equal(decodeHtmlEntities('caf&#x65;'), 'cafe')
  assert.equal(decodeHtmlEntities(null), null)
})

await check('isPlausibleOrganizationName(): rejects generic page/product-title phrases, accepts a real organization name', () => {
  assert.equal(isPlausibleOrganizationName('سایت تولید قطعات پلاستیک'), false)
  assert.equal(isPlausibleOrganizationName('تولید پریفرم پت و تولید پریفرم قم'), false)
  assert.equal(isPlausibleOrganizationName('خط تولید نایلون گلخانه ای'), false)
  assert.equal(isPlausibleOrganizationName('محصول ویژه ما'), false)
  assert.equal(isPlausibleOrganizationName('کارخانه تولید قطعات پلاستیک'), false)
  assert.equal(isPlausibleOrganizationName('گروه صنعتی انتخاب'), true)
  assert.equal(isPlausibleOrganizationName('شرکت پوریا پلاستیک ری'), true)
  assert.equal(isPlausibleOrganizationName(''), false)
})

await check('resolveVerifiedIdentity(): a "generic description – real brand" <title> correctly isolates the brand segment, not the generic one (Entekhab Group-style)', () => {
  const identity = resolveVerifiedIdentity({
    domain: 'entekhabgroup.example',
    signals: {
      jsonLdOrganizationName: null,
      ogSiteName: null,
      titleText: 'سایت تولید قطعات پلاستیک – گروه صنعتی انتخاب',
      aboutText: null,
      contactText: null,
    },
    baseline: null,
  })
  assert.equal(identity.source, IDENTITY_SOURCES.HOMEPAGE_BRAND)
  assert.equal(identity.resolvedName, 'گروه صنعتی انتخاب')
  assert.equal(isPlausibleOrganizationName(identity.resolvedName), true)
})

await check('runComprehensiveAudit() end-to-end: Entekhab Group-style candidate resolves the real brand (not the page title) and reports it cleanly, entity decoded', async () => {
  const client = makeFakeClient()
  client.from('prospect_candidates').insert({
    canonical_name: 'سایت تولید قطعات پلاستیک',
    raw_name: 'سایت تولید قطعات پلاستیک',
    business_description: 'تولیدکننده قطعات پلاستیکی صنعتی، تلفن: 02144556677، موبایل: 09121234567',
    website: 'https://entekhabgroup.example/',
    domain: 'entekhabgroup.example',
    mobile: '09121234567',
    phone: '02144556677',
    source_url: 'https://entekhabgroup.example/',
    raw_data: { link: 'https://entekhabgroup.example/', title: 'سایت تولید قطعات پلاستیک' },
    status: 'manual_review',
  })
  mockFetch(async () => ({
    ok: true,
    headers: { get: () => 'text/html' },
    // The RAW, HTML-entity-encoded, "generic description – brand" <title>
    // exactly as a real page would send it - never pre-cleaned in the test.
    text: async () => '<html><head><title>سایت تولید قطعات پلاستیک &#8211; گروه صنعتی انتخاب</title></head><body></body></html>',
  }))
  try {
    const audit = await runComprehensiveAudit(client)
    const prediction = audit.predictions.find((p) => p.original_result_title === 'سایت تولید قطعات پلاستیک')
    assert.ok(prediction, 'the candidate must appear in the audit')
    assert.equal(prediction.resolved_company_name, 'گروه صنعتی انتخاب')
    assert.equal(prediction.identity_source, 'homepage_brand')
    assert.ok(!prediction.resolved_company_name.includes('&#'), 'no auto-promotable name may contain a raw HTML entity')
    assert.equal(isPlausibleOrganizationName(prediction.resolved_company_name), true, 'no auto-promotable name may be a generic page/product title')
    if (prediction.predicted_auto_promotable) {
      assert.equal(prediction.resolved_company_name, 'گروه صنعتی انتخاب')
    }
    assert.equal(audit.logicalConflictCount, 0)
  } finally {
    restoreFetch()
  }
})

await check('runComprehensiveAudit() invariant: autoPromotable=true is impossible with an implausible/generic resolved_company_name, even if identity resolution somehow produced one', async () => {
  // A direct, adversarial check of the invariant ITSELF (not relying on
  // resolveVerifiedIdentity's own proactive filtering to have caught it) -
  // simulates a candidate whose ONLY identity signal is a generic
  // homepage <title> with NO real brand segment anywhere, so
  // resolveVerifiedIdentity legitimately has nothing plausible to fall
  // back to.
  const client = makeFakeClient()
  client.from('prospect_candidates').insert({
    canonical_name: 'سایت تولید محصولات پلاستیکی',
    raw_name: 'سایت تولید محصولات پلاستیکی',
    business_description: 'تولیدکننده محصولات پلاستیکی صنعتی، تلفن: 02144556677، موبایل: 09121234567',
    website: 'https://genericfactory.example/',
    domain: 'genericfactory.example',
    mobile: '09121234567',
    phone: '02144556677',
    source_url: 'https://genericfactory.example/',
    raw_data: { link: 'https://genericfactory.example/', title: 'سایت تولید محصولات پلاستیکی' },
    status: 'manual_review',
  })
  mockFetch(async () => ({
    ok: true,
    headers: { get: () => 'text/html' },
    text: async () => '<html><head><title>سایت تولید محصولات پلاستیکی</title></head><body></body></html>',
  }))
  try {
    const audit = await runComprehensiveAudit(client)
    const prediction = audit.predictions.find((p) => p.original_result_title === 'سایت تولید محصولات پلاستیکی')
    assert.ok(prediction)
    assert.equal(prediction.predicted_auto_promotable, false, 'a generic-title-only candidate must never auto-promote')
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// "FINAL AUTONOMY BLOCKER" round, section 5 - the three remaining role/
// semantic fixes, with the EXACT wording given.
// ---------------------------------------------------------------------------

await check('5A: "ماشین سازی مرتضی امامی سازنده انواع ماشین آلات پلاستیک" is a machinery MANUFACTURER, never a polymer processor/buyer', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'ماشین سازی مرتضی امامی سازنده انواع ماشین آلات پلاستیک',
    link: 'https://emamimachine.example/',
    snippet: 'ماشین سازی مرتضی امامی، سازنده انواع ماشین آلات و خطوط تولید صنعت پلاستیک در ایران.',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedBusinessRole(evidence), 'machinery_supplier')
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
  assert.equal(qualification.autoPromotable, false)
})

await check('5B: "کلینیک تاسیسات ساختمانی میرزایی" (a metaphorical/commercial use of "کلینیک") is never classified medical', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'کلینیک تاسیسات ساختمانی میرزایی',
    link: 'https://mirzaeiclinic.example/',
    snippet: 'کلینیک تاسیسات ساختمانی میرزایی، تعمیر و سرویس تاسیسات گرمایشی و سرمایشی ساختمان.',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  // Before the fix, bare "کلینیک" alone matched the medical_cosmetic
  // negative signal / non-buyer-org signal, forcing business_role=medical
  // and buyer_fit=not_buyer on a plain building-facilities service business
  // that has nothing to do with medicine. No industry evidence exists here
  // either way, so the correct, honest verdict is simply "unknown."
  assert.equal(matchedBusinessRole(evidence), 'unknown')
  assert.equal(matchedBuyerFit(evidence), 'unknown')
})

await check('5C: part-lux.ir-style "کارخانه تولید قطعات پلاستیکی خودرو" (automotive plastic-parts factory) is a real polymer processor, buyer_fit=high, never not_buyer', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'کارخانه تولید قطعات پلاستیکی خودرو - پارت لوکس',
    link: 'https://part-lux.example/',
    snippet: 'کارخانه تولید قطعات پلاستیکی خودرو با خط تولید فعال، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high', 'real structured automotive plastic-parts manufacturing evidence must yield buyer_fit=high, never not_buyer')
  assert.equal(matchedBusinessRole(evidence), 'polymer_processor')
  assert.equal(qualification.status, 'qualified')
})

await check('5C-b: "معرفی کارخانه تولید قطعات پلاستیکی خودرو - پارت لوکس" (a company introducing ITSELF, singular) is not misread as a listicle article', () => {
  // "FINAL REGRESSION FIX" round, item 2 (part-lux.ir false-negative
  // hypothesis): the REAL production title almost certainly included
  // "معرفی" ("introducing...") - which, before this fix, co-occurring with
  // the singular ENTITY_WORD "کارخانه" would have wrongly classified this
  // as an ARTICLE (isNonCompanyEntityType=true), which forces BOTH
  // buyer_fit=not_buyer AND business_role=unknown together regardless of
  // the real manufacturing evidence - exactly the reported symptom.
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'معرفی کارخانه تولید قطعات پلاستیکی خودرو - پارت لوکس',
    link: 'https://part-lux-b.example/',
    snippet: 'معرفی کارخانه تولید قطعات پلاستیکی خودرو پارت لوکس با خط تولید فعال، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.equal(matchedBusinessRole(evidence), 'polymer_processor')
  assert.equal(qualification.status, 'qualified')
})

// ---------------------------------------------------------------------------
// "FINAL PRODUCTION GATE" round - the REAL remaining production failure:
// candidate 04615a8f-dbab-4ba4-b8e9-984e6965b945, part-lux.ir. Root cause
// (confirmed against the exact real title/URL, not a guess): the bare
// "مشاوره" (consultation) keyword in industryTaxonomy.js's 'agency'
// NEGATIVE_SIGNALS entry (weight -30, a STRONG negative) matched "مشاوره
// رایگان" ("free consultation") - an extremely common Iranian manufacturer
// marketing CTA, not evidence of being a standalone consulting agency. This
// forced buyer_fit=not_buyer AND business_role=unknown together (both
// deriveBuyerFit/deriveBusinessRole short-circuit on hasStrongNegative)
// regardless of the explicit "قطعات پلاستیکی" manufacturing evidence
// already present. Fixed generically: "مشاوره" split into its own
// exemptWhenProduction NEGATIVE_SIGNALS entry (see industryTaxonomy.js/
// evidenceEngine.js) - exempted ONLY when the text ALSO independently
// self-identifies as a producer, same mechanism already proven for
// retail_only in the previous round.
// ---------------------------------------------------------------------------

await check('the REAL part-lux.ir production candidate (exact title + URL) now correctly resolves buyer_fit=high/business_role=polymer_processor, never not_buyer/unknown', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'کارخانه تولید قطعات پلاستیکی خودرو (مشاوره رایگان + قیمت)',
    link: 'https://www.part-lux.ir/کارخانه-تولید-قطعات-پلاستیکی-خودرو/',
    snippet: '',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(matchedBuyerFit(evidence), 'high', 'a real manufacturer must not become not_buyer merely for offering "مشاوره رایگان" (free consultation)')
  assert.equal(matchedBusinessRole(evidence), 'polymer_processor')
})

await check('manufacturer + price ("کارخانه تولید ... قیمت") keeps buyer_fit=high', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'کارخانه تولید قطعات پلاستیکی صنعتی - استعلام قیمت',
    link: 'https://factory-price-example.com/',
    snippet: 'کارخانه تولید قطعات پلاستیکی صنعتی با بالاترین کیفیت، قیمت مناسب، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.notEqual(matchedBusinessRole(evidence), 'unknown')
})

await check('manufacturer + sales ("کارخانه تولید ... فروش محصولات خود") keeps buyer_fit=high', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'کارخانه تولید لوله پلی اتیلن - فروش مستقیم از کارخانه',
    link: 'https://factory-sales-example.com/',
    snippet: 'کارخانه تولید لوله پلی اتیلن، فروش مستقیم از کارخانه بدون واسطه، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده لوله پلی اتیلن',
  })
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.notEqual(matchedBusinessRole(evidence), 'unknown')
})

await check('manufacturer + consultation ("کارخانه تولید ... مشاوره رایگان") keeps buyer_fit=high, business_role=polymer_processor', () => {
  const { evidence } = qualifyFromSerperItem({
    title: 'کارخانه تولید ظروف یکبار مصرف پلاستیکی (مشاوره رایگان)',
    link: 'https://factory-consult-example.com/',
    snippet: 'کارخانه تولید ظروف یکبار مصرف پلاستیکی، مشاوره رایگان برای انتخاب محصول مناسب، تلفن: 02144556677، موبایل: 09121234567',
    _sourceQuery: 'تولید کننده ظروف یکبار مصرف',
  })
  assert.equal(matchedBuyerFit(evidence), 'high')
  assert.equal(matchedBusinessRole(evidence), 'polymer_processor')
})

await check('a genuine standalone consulting firm ("مشاوره" with NO manufacturing self-identification) is still correctly flagged as not_buyer', () => {
  // The exemption is narrow: it requires an independent
  // MANUFACTURING_INDICATOR_TERMS match. A real consulting/advisory
  // business that never claims to manufacture anything must stay exactly
  // as excluded as before.
  const { evidence } = qualifyFromSerperItem({
    title: 'موسسه مشاوره مدیریت و کسب و کار پارس',
    link: 'https://parsconsulting-example.com/',
    snippet: 'ارائه خدمات مشاوره مدیریت، مشاوره سرمایه‌گذاری و مشاوره کسب‌وکار برای شرکت‌های صنعتی، تلفن: 02144556677',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
})

await check('classifyEntityType: "معرفی" + a PLURAL entity word ("تولیدکنندگان"/"کارگاه های"/...) IS still a listicle article, never a single company', () => {
  assert.equal(
    classifyEntityType({ domain: 'random-blog2.example', title: 'معرفی تولیدکنندگان لوله پلی اتیلن در ایران' }),
    ENTITY_TYPES.ARTICLE,
    'a PLURAL entity word alongside "معرفی" must still resolve to ARTICLE - only the SINGULAR case was the false positive',
  )
})

await check('hadiplastic.ir\'s real "معرفی معروف ترین کارگاه های..." wording is still ARTICLE (regression check for the "معرفی" fix above)', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'معرفی معروف ترین کارگاه های تزریق پلاستیک در ایران',
    link: 'https://hadiplastic2.ir/view/articleid/96',
    snippet: 'در این مقاله به معرفی معروف‌ترین کارگاه‌های تزریق پلاستیک در ایران می‌پردازیم.',
    _sourceQuery: 'کارخانه تزریق پلاستیک',
  })
  assert.equal(matchedEntityType(evidence), 'article')
  assert.equal(qualification.autoPromotable, false)
})

// --- Section 9: business_role/buyer_fit contradiction invariant ------------

await check('business_role=polymer_processor can never co-occur with buyer_fit=not_buyer (invariant)', () => {
  // A candidate with real production/industry evidence AND a strong
  // negative signal that is NOT retail-specific (e.g. "آژانس تبلیغاتی") -
  // exactly the scenario that used to let deriveBusinessRole and
  // deriveBuyerFit disagree with each other.
  const candidate = {
    canonical_name: 'شرکت ترکیبی نمونه',
    raw_name: 'شرکت ترکیبی نمونه، تولیدکننده لوله پلی اتیلن',
    business_description: 'تولیدکننده لوله پلی اتیلن صنعتی، همچنین دارای واحد آژانس تبلیغاتی داخلی',
    website: 'https://mixed-example.com/',
    domain: 'mixed-example.com',
  }
  const evidence = extractEvidence(candidate)
  const businessRole = matchedBusinessRole(evidence)
  const buyerFit = matchedBuyerFit(evidence)
  assert.ok(
    !(businessRole === 'polymer_processor' && buyerFit === 'not_buyer'),
    `invariant violated: business_role=${businessRole}, buyer_fit=${buyerFit}`,
  )
})

// --- Section 13/15: the comprehensive audit itself, and its acceptance gates

function makeAuditCorpusClient() {
  const client = makeFakeClient()
  const rows = [
    // rejected, should be RESCUED (real structured OSM evidence)
    {
      canonical_name: 'کادوس پلاستیک آریا',
      raw_name: 'کادوس پلاستیک آریا',
      business_description: 'تولید کننده انواع قطعات پلاستیکی به روش بادی و تزریقی',
      website: 'http://kadousplastic.com',
      domain: 'kadousplastic.com',
      email: 'info@kadousplastic.com',
      phone: '02155667788',
      source_url: 'https://www.openstreetmap.org/node/1',
      raw_data: { type: 'node', id: 1, tags: { name: 'کادوس پلاستیک آریا', man_made: 'works', product: 'plastic;plastic_products' } },
      status: 'rejected',
      rejection_reason: 'شواهدی از تولید یا فرآوری مواد پلیمری یافت نشد.',
    },
    // manual_review, stays manual_review (a directory page)
    {
      canonical_name: 'sanatgroup.example',
      raw_name: 'فهرست تولیدکنندگان فیلم پلاستیک',
      business_description: 'دایرکتوری کامل کارخانه‌های تولید فیلم و نایلون در سراسر کشور.',
      website: 'https://sanatgroup.example/directory',
      domain: 'sanatgroup.example',
      source_url: 'https://sanatgroup.example/directory',
      status: 'manual_review',
    },
    // qualified, stays qualified (a real, already-good manufacturer)
    {
      canonical_name: 'تماشاپلاست',
      raw_name: 'تماشاپلاست، تولیدکننده فیلم نایلونی',
      business_description: 'تولیدکننده فیلم پلی اتیلن کشاورزی، تلفن: 02144556677، موبایل: 09121234567',
      website: 'https://tamashaplast.com/',
      domain: 'tamashaplast.com',
      mobile: '09121234567',
      phone: '02144556677',
      source_url: 'https://tamashaplast.com/',
      status: 'qualified',
      overall_score: 60,
    },
  ]
  for (const row of rows) client.from('prospect_candidates').insert(row)
  // duplicate + promoted rows - must be COUNTED but never AUDITED.
  client.from('prospect_candidates').insert({ canonical_name: 'یک مورد تکراری', status: 'duplicate' })
  client.from('prospect_candidates').insert({ canonical_name: 'یک لید تبدیل‌شده', status: 'promoted' })
  return client
}

await check('runComprehensiveAudit() covers manual_review + rejected + qualified, excludes duplicate/promoted but still counts them', async () => {
  const client = makeAuditCorpusClient()
  const beforeSnapshot = JSON.parse(JSON.stringify(client.tables.prospect_candidates))
  const audit = await runComprehensiveAudit(client)

  assert.equal(audit.databaseStatusCounts.rejected, 1)
  assert.equal(audit.databaseStatusCounts.manual_review, 1)
  assert.equal(audit.databaseStatusCounts.qualified, 1)
  assert.equal(audit.databaseStatusCounts.duplicate, 1)
  assert.equal(audit.databaseStatusCounts.promoted, 1)

  assert.deepEqual(audit.inputStatusCounts, { manual_review: 1, rejected: 1, qualified: 1 })
  assert.equal(audit.auditedCount, 3, 'must equal manual_review + rejected + qualified, never just manual_review')
  assert.equal(audit.excludedCount, 2, 'duplicate + promoted, counted but never audited')
  assert.equal(audit.excludedStatusCounts.duplicate, 1)
  assert.equal(audit.excludedStatusCounts.promoted, 1)

  // The rescue: کادوس پلاستیک آریا (rejected) must come back non-rejected.
  const kadous = audit.predictions.find((p) => p.name === 'کادوس پلاستیک آریا')
  assert.notEqual(kadous.predicted_status, 'rejected')
  assert.equal(audit.rescuedFalseNegatives, 1)

  // Zero logical conflicts on this corpus.
  assert.equal(audit.logicalConflictCount, 0)

  // Read-only - absolutely nothing written.
  assert.deepEqual(client.tables.prospect_candidates, beforeSnapshot)
})

await check('runComprehensiveAudit() acceptance gate: zero article/directory/marketplace/social/video/machinery-supplier auto-promotable, zero unresolved-identity auto-promotable', async () => {
  const client = makeAuditCorpusClient()
  const audit = await runComprehensiveAudit(client)
  for (const p of audit.predictions) {
    if (['article', 'directory_or_list', 'marketplace', 'social', 'video'].includes(p.entity_type)) {
      assert.equal(p.predicted_auto_promotable, false, `${p.name}: a ${p.entity_type} page must never be auto-promotable`)
    }
    if (p.business_role === 'machinery_supplier') {
      assert.equal(p.predicted_auto_promotable, false, `${p.name}: a machinery supplier must never be auto-promotable`)
    }
    if (p.predicted_auto_promotable) {
      assert.ok(p.resolved_company_name, `${p.name}: an auto-promotable candidate must have a resolved_company_name`)
      // "FINAL REGRESSION FIX" round, item 4 - explicit assertions, over
      // the WHOLE audited corpus, not just one named example.
      assert.ok(!p.resolved_company_name.includes('&#'), `${p.name}: no auto-promotable company name may contain a raw HTML entity`)
      assert.ok(!/&[a-zA-Z]+;/.test(p.resolved_company_name), `${p.name}: no auto-promotable company name may contain a raw HTML entity`)
      assert.equal(
        isPlausibleOrganizationName(p.resolved_company_name),
        true,
        `${p.name}: no auto-promotable company name may be a generic page/product title ("${p.resolved_company_name}")`,
      )
    }
  }
  assert.equal(audit.logicalConflictCount, 0)
})

// ---------------------------------------------------------------------------
// "Controlled Promotion Acceptance" round - promoteEligibleCandidates(): the
// ONE real-write bulk promotion step. Never re-derives its own eligibility
// definition (reuses runComprehensiveAudit()'s predicted_auto_promotable),
// re-verifies each candidate fresh immediately before writing, is idempotent
// (a second run promotes 0 additional candidates / creates 0 additional
// leads), and reuses the EXISTING dedupe fields (matched_lead_id/
// matched_company_id/duplicate_of_candidate_id) rather than a new dedup
// pass.
// ---------------------------------------------------------------------------

function eligibleQualifiedCandidateRow(overrides = {}) {
  return {
    canonical_name: 'صنایع پلاستیک امید پروموشن',
    raw_name: 'صنایع پلاستیک امید پروموشن',
    business_description: 'تولیدکننده فیلم پلی اتیلن کشاورزی و بسته‌بندی پلاستیک با خط تولید فعال',
    website: 'https://omid-plastic-promo.example',
    domain: 'omid-plastic-promo.example',
    mobile: '09123456789',
    phone: '02633334444',
    email: 'info@omid-plastic-promo.example',
    source_url: 'https://omid-plastic-promo.example',
    status: 'qualified',
    overall_score: 60,
    confidence: 'medium',
    ...overrides,
  }
}

await check('promoteEligibleCandidates(): promotes every currently-eligible candidate into a real sales_leads row, with full source traceability', async () => {
  const client = makeFakeClient()
  const first = client.from('prospect_candidates').insert(eligibleQualifiedCandidateRow())
  const second = client.from('prospect_candidates').insert(
    eligibleQualifiedCandidateRow({
      canonical_name: 'صنایع پلاستیک پروموشن دو',
      raw_name: 'صنایع پلاستیک پروموشن دو',
      website: 'https://plastic-promo-two.example',
      domain: 'plastic-promo-two.example',
      source_url: 'https://plastic-promo-two.example',
      mobile: '09121112222',
      phone: '02655556666',
      email: 'info@plastic-promo-two.example',
    }),
  )
  const [{ data: firstRow }, { data: secondRow }] = await Promise.all([first.select().single(), second.select().single()])

  const result = await promoteEligibleCandidates(client, { createdBy: 'admin-1' })

  assert.equal(result.eligibleBefore, 2)
  assert.equal(result.promoted, 2)
  assert.equal(result.alreadyPromoted, 0)
  assert.equal(result.skippedExistingMatch, 0)
  assert.equal(result.failed, 0)
  assert.equal(client.tables.sales_leads.length, 2, 'exactly one real sales_leads row per promoted candidate')

  const updatedFirst = client.tables.prospect_candidates.find((r) => r.id === firstRow.id)
  const updatedSecond = client.tables.prospect_candidates.find((r) => r.id === secondRow.id)
  assert.equal(updatedFirst.status, 'promoted')
  assert.equal(updatedSecond.status, 'promoted')
  assert.ok(updatedFirst.promoted_lead_id, 'the candidate row must record which lead it became')
  assert.ok(updatedSecond.promoted_lead_id, 'the candidate row must record which lead it became')

  // Requirement 5 - source traceability, both in the created lead row AND
  // in this function's own result entries.
  const leadForFirst = client.tables.sales_leads.find((l) => l.id === updatedFirst.promoted_lead_id)
  assert.equal(leadForFirst.company_name, 'صنایع پلاستیک امید پروموشن')
  assert.equal(leadForFirst.external_ref, 'https://omid-plastic-promo.example')

  const resultForFirst = result.results.find((r) => r.candidateId === firstRow.id)
  assert.equal(resultForFirst.outcome, 'promoted')
  assert.equal(resultForFirst.sourceUrl, 'https://omid-plastic-promo.example')
  assert.ok(resultForFirst.resolvedCompanyName)
  assert.equal(resultForFirst.buyerFit, 'high')
  assert.ok(typeof resultForFirst.score === 'number')
  assert.ok(resultForFirst.reason)
  assert.equal(resultForFirst.leadId, updatedFirst.promoted_lead_id)
})

await check('promoteEligibleCandidates(): is idempotent - a second run promotes 0 additional candidates and creates 0 additional leads', async () => {
  const client = makeFakeClient()
  client.from('prospect_candidates').insert(eligibleQualifiedCandidateRow())

  const firstRun = await promoteEligibleCandidates(client, { createdBy: 'admin-1' })
  assert.equal(firstRun.promoted, 1)
  const leadCountAfterFirst = client.tables.sales_leads.length

  // Once promoted, status='promoted' is OUTSIDE runComprehensiveAudit()'s
  // AUDITABLE_STATUSES (manual_review/rejected/qualified) by design (see
  // that function's own header - a promoted/duplicate row is never
  // re-audited, protecting real, already-acted-on state) - so the
  // candidate correctly drops out of eligibleBefore entirely on a repeat
  // run, rather than showing up as "already promoted." Idempotency is
  // proven by eligibleBefore/promoted both going to 0 and the lead count
  // staying exactly the same, not by an alreadyPromoted counter that can
  // structurally never fire through this same path.
  const secondRun = await promoteEligibleCandidates(client, { createdBy: 'admin-1' })
  assert.equal(secondRun.eligibleBefore, 0, 'the already-promoted candidate must no longer appear as eligible at all')
  assert.equal(secondRun.promoted, 0, 'a second run must promote 0 additional candidates')
  assert.equal(client.tables.sales_leads.length, leadCountAfterFirst, 'a second run must create 0 additional leads')
})

await check('promoteEligibleCandidates(): a candidate that already maps to an existing lead/company (matched_lead_id already set) is skipped, never promoted over it', async () => {
  const client = makeFakeClient()
  const { data: existingLead } = await client.from('sales_leads').insert({ company_name: 'یک لید از قبل موجود' }).select().single()
  client.from('prospect_candidates').insert(
    eligibleQualifiedCandidateRow({
      matched_lead_id: existingLead.id,
      match_explanation: 'شماره موبایل یکسان (تشخیص‌داده‌شده در زمان کشف)',
    }),
  )

  const result = await promoteEligibleCandidates(client, { createdBy: 'admin-1' })
  assert.equal(result.promoted, 0)
  assert.equal(result.skippedExistingMatch, 1)
  assert.equal(client.tables.sales_leads.length, 1, 'no NEW sales_leads row - only the pre-existing one')
  assert.equal(result.results[0].outcome, 'skipped_existing_match')
})

await check('promoteEligibleCandidates(): never touches a candidate that is not currently eligible (manual_review with weak evidence)', async () => {
  const client = makeFakeClient()
  client.from('prospect_candidates').insert({
    canonical_name: 'یک نامزد ضعیف',
    raw_name: 'یک نامزد ضعیف',
    business_description: 'اطلاعات کافی برای تشخیص وجود ندارد',
    status: 'manual_review',
  })
  const result = await promoteEligibleCandidates(client, { createdBy: 'admin-1' })
  assert.equal(result.eligibleBefore, 0)
  assert.equal(result.promoted, 0)
  assert.equal(client.tables.sales_leads.length, 0)
})

// --- Section F: website enrichment scaffold (never wired into the live path)

await check('enrichFromWebsite() rejects a non-text/html response without throwing', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, headers: { get: () => 'application/pdf' } })
  try {
    const result = await enrichFromWebsite('https://example.com/')
    assert.equal(result.ok, false)
    assert.equal(result.pagesFetched, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

await check('enrichFromWebsite() extracts stripped text from a successful homepage fetch and never throws on a fetch error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => '<html><body><h1>Example Co</h1><p>تولیدکننده لوله پلی اتیلن</p></body></html>',
  })
  try {
    const result = await enrichFromWebsite('https://example.com/')
    assert.equal(result.ok, true)
    assert.ok(result.evidenceText.includes('تولیدکننده لوله پلی اتیلن'))
    assert.ok(!result.evidenceText.includes('<h1>'), 'HTML tags must be stripped')
  } finally {
    globalThis.fetch = originalFetch
  }
})

await check('enrichFromWebsite() never throws when the fetch itself fails - a fetch failure is not negative evidence', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('network unreachable')
  }
  try {
    const result = await enrichFromWebsite('https://example.com/')
    assert.equal(result.ok, false)
    assert.equal(result.attempts.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// --- 5. Ambiguous/incomplete direct-company result -------------------------

await check('a direct-company result with too little text stays manual_review (ambiguous), not rejected, not qualified', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'شرکت پلاستیک آلفا',
    link: 'https://alphaplastic.example/',
    snippet: '',
    _sourceQuery: 'تولید کننده قطعات پلاستیکی',
  })
  // 23D.1 item 3: entity IDENTITY (direct_company, no red flags found) is
  // decided independently of manufacturing RELEVANCE - this domain clears
  // every negative check, so it's correctly identified as a company, just
  // one with too little text to judge relevance yet (manual_review, not a
  // rejection and not a promotion).
  assert.equal(matchedEntityType(evidence), 'direct_company')
  assert.equal(qualification.status, 'manual_review')
  assert.equal(qualification.autoPromotable, false)
})

// --- 6. Irrelevant/retail business (entity-type gate must not interfere) --

await check('a retail-only business on its own domain is still rejected, not just capped at manual_review', () => {
  const { qualification, evidence } = qualifyFromSerperItem({
    title: 'فروشگاه لوازم پلاستیکی رضا',
    link: 'https://rezaplastic-shop.example/',
    snippet: 'فروشگاه خرده فروشی لوازم پلاستیکی خانگی در بازار تهران، تلفن: 02144556677',
    _sourceQuery: 'تولید کننده ظروف پلاستیکی',
  })
  // Nothing about "فروشگاه"/"خرده فروشی" trips the ENTITY classifier (that's
  // a separate, industryTaxonomy.js negative-signal concern, not an entity-
  // identity one) - it's still correctly identified as a direct_company
  // page. What matters for this test is that the retail negative signal
  // still forces rejection regardless, proving the entity-type gate never
  // overrides a rejection the way it overrides a promotion.
  assert.equal(matchedEntityType(evidence), 'direct_company')
  // 23D.3: buyer_fit must also be not_buyer/never "high" for a retail-only
  // business, regardless of the fact that it got rejected outright here
  // (a milder retail case with SOME industry text would land in
  // manual_review via the buyer_fit=not_buyer gate instead - either way,
  // never auto-promotable).
  assert.equal(matchedBuyerFit(evidence), 'not_buyer')
  assert.equal(qualification.status, 'rejected')
  assert.equal(qualification.autoPromotable, false)
})

// --- 7. Duplicate manufacturer (domain-based entity resolution) -----------

await check('two different search results for the SAME company domain resolve as a duplicate', () => {
  const a = serperSearchAdapter.normalize({
    title: 'تماشاپلاست',
    link: 'https://tamashaplast.com/',
    snippet: 'تولیدکننده فیلم پلی اتیلن کشاورزی',
    _sourceQuery: 'تولید کننده فیلم پلی اتیلن',
  })
  const b = serperSearchAdapter.normalize({
    title: 'تماشاپلاست - درباره ما',
    link: 'https://tamashaplast.com/about',
    snippet: 'شرکت تماشاپلاست، تولیدکننده نایلون کشاورزی',
    _sourceQuery: 'تولید کننده نایلون و نایلکس',
  })
  assert.equal(a.domain, b.domain, 'the two results must extract to the same domain regardless of URL path')
  const result = resolveDuplicate(buildMatchKeys({ domain: b.domain }), [{ kind: 'candidate', id: 'c1', keys: buildMatchKeys({ domain: a.domain }) }])
  assert.equal(result.matchType, 'duplicate')
})

// --- 8. Item 7: a listicle/directory title is never used as a company name

await check('serper normalize() never uses a listicle/directory title as canonical_name', () => {
  const normalized = serperSearchAdapter.normalize({
    title: 'بهترین تولیدکنندگان فیلم پلاستیک در ایران',
    link: 'https://some-blog.example/best-manufacturers',
    snippet: 'معرفی برترین تولیدکنندگان فیلم پلی اتیلن',
  })
  assert.notEqual(normalized.canonical_name, 'بهترین تولیدکنندگان فیلم پلاستیک در ایران')
  assert.equal(normalized.canonical_name, 'some-blog.example')
  // The real title is still preserved for audit purposes, just not treated
  // as the entity's name.
  assert.equal(normalized.raw_name, 'بهترین تولیدکنندگان فیلم پلاستیک در ایران')
})

// --- 9. Item 10: safe, idempotent bulk re-evaluation of existing rows -----

await check('dryRunQualification() predicts outcomes WITHOUT writing anything to the database', async () => {
  const client = makeFakeClient()
  const { data: strongDirect } = await client
    .from('prospect_candidates')
    .insert({
      canonical_name: 'تماشاپلاست، تولیدکننده فیلم نایلونی، صنعتی و کشاورزی',
      raw_name: 'تماشاپلاست، تولیدکننده فیلم نایلونی، صنعتی و کشاورزی',
      business_description:
        'تولیدکننده فیلم پلی اتیلن، فیلم کشاورزی و اکستروژن فیلم در ایران با خط تولید فعال، تلفن: 02144556677، موبایل: 09121234567، ایمیل: info@tamashaplast.com',
      website: 'https://tamashaplast.com/',
      domain: 'tamashaplast.com',
      mobile: '09121234567',
      phone: '02144556677',
      email: 'info@tamashaplast.com',
      source_url: 'https://tamashaplast.com/',
      overall_score: 42,
      status: 'manual_review',
    })
    .select()
    .single()
  const { data: directoryPage } = await client
    .from('prospect_candidates')
    .insert({
      canonical_name: 'sanatgroup.example',
      raw_name: 'فهرست تولیدکنندگان فیلم پلاستیک',
      business_description: 'دایرکتوری کامل کارخانه‌های تولید فیلم و نایلون در سراسر کشور.',
      website: 'https://sanatgroup.example/directory',
      domain: 'sanatgroup.example',
      source_url: 'https://sanatgroup.example/directory',
      overall_score: 38,
      status: 'manual_review',
    })
    .select()
    .single()

  const beforeSnapshot = JSON.parse(JSON.stringify(client.tables.prospect_candidates))
  const result = await dryRunQualification(client)

  assert.equal(result.total, 2)
  assert.equal(result.errors, 0)
  assert.equal(result.counts.qualified, 1)
  assert.equal(result.counts.manual_review, 1)

  const strongPrediction = result.predictions.find((p) => p.id === strongDirect.id)
  const directoryPrediction = result.predictions.find((p) => p.id === directoryPage.id)
  assert.equal(strongPrediction.predicted_status, 'qualified')
  assert.equal(strongPrediction.entity_type, 'direct_company')
  assert.equal(strongPrediction.current_status, 'manual_review')
  assert.equal(strongPrediction.current_score, 42, 'the CURRENT stored score must be reported, not overwritten')
  assert.equal(directoryPrediction.predicted_status, 'manual_review')
  assert.equal(directoryPrediction.entity_type, 'directory_or_list')

  // The whole point of a dry run - absolutely nothing was written.
  assert.deepEqual(client.tables.prospect_candidates, beforeSnapshot)
  assert.equal(client.tables.sales_leads.length, 0)
})

await check('reEvaluateManualReviewCandidates() rescores existing manual_review rows without ever promoting or duplicating', async () => {
  const client = makeFakeClient()
  const { data: strongDirect } = await client
    .from('prospect_candidates')
    .insert({
      canonical_name: 'تماشاپلاست، تولیدکننده فیلم نایلونی، صنعتی و کشاورزی',
      raw_name: 'تماشاپلاست، تولیدکننده فیلم نایلونی، صنعتی و کشاورزی',
      business_description:
        'تولیدکننده فیلم پلی اتیلن، فیلم کشاورزی و اکستروژن فیلم در ایران با خط تولید فعال، تلفن: 02144556677، موبایل: 09121234567، ایمیل: info@tamashaplast.com',
      website: 'https://tamashaplast.com/',
      domain: 'tamashaplast.com',
      mobile: '09121234567',
      phone: '02144556677',
      email: 'info@tamashaplast.com',
      source_url: 'https://tamashaplast.com/',
      status: 'manual_review',
    })
    .select()
    .single()
  const { data: directoryPage } = await client
    .from('prospect_candidates')
    .insert({
      canonical_name: 'sanatgroup.example',
      raw_name: 'فهرست تولیدکنندگان فیلم پلاستیک',
      business_description: 'دایرکتوری کامل کارخانه‌های تولید فیلم و نایلون در سراسر کشور.',
      website: 'https://sanatgroup.example/directory',
      domain: 'sanatgroup.example',
      source_url: 'https://sanatgroup.example/directory',
      status: 'manual_review',
    })
    .select()
    .single()

  const firstRun = await reEvaluateManualReviewCandidates(client)
  assert.equal(firstRun.total, 2)
  assert.equal(firstRun.updated, 2)
  assert.equal(firstRun.errors, 0)

  const updatedStrong = client.tables.prospect_candidates.find((c) => c.id === strongDirect.id)
  const updatedDirectory = client.tables.prospect_candidates.find((c) => c.id === directoryPage.id)
  assert.equal(updatedStrong.status, 'qualified', 'the strong direct manufacturer must move out of manual_review')
  assert.equal(updatedDirectory.status, 'manual_review', 'the directory page must stay manual_review, never qualified')
  assert.equal(client.tables.sales_leads.length, 0, 're-evaluation must never itself create a lead')

  // Idempotent: running again only touches whatever is STILL manual_review
  // (the directory page), never re-processes the now-qualified one, and
  // still creates no leads.
  const secondRun = await reEvaluateManualReviewCandidates(client)
  assert.equal(secondRun.total, 1)
  assert.equal(secondRun.updated, 1)
  assert.equal(client.tables.sales_leads.length, 0)

  // 23D.3: verifyQualificationState() re-recomputes from the SAME stored
  // fields reEvaluateManualReviewCandidates() just wrote - its
  // predicted_status must exactly match current_status for every row (the
  // write actually landed as computed), and it must write nothing itself.
  const beforeVerifySnapshot = JSON.parse(JSON.stringify(client.tables.prospect_candidates))
  const verification = await verifyQualificationState(client)
  assert.equal(verification.auditedCount, 2, 'covers both the now-qualified and the still-manual_review row')
  const verifiedStrong = verification.predictions.find((p) => p.id === strongDirect.id)
  const verifiedDirectory = verification.predictions.find((p) => p.id === directoryPage.id)
  assert.equal(verifiedStrong.predicted_status, verifiedStrong.current_status)
  assert.equal(verifiedStrong.current_status, 'qualified')
  assert.equal(verifiedDirectory.predicted_status, verifiedDirectory.current_status)
  assert.equal(verifiedDirectory.current_status, 'manual_review')
  assert.deepEqual(client.tables.prospect_candidates, beforeVerifySnapshot, 'verification must write nothing')
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
      if (type === 'in') return value.includes(row[field])
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
      in: (f, v) => (filters.push(['in', f, v]), chain),
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

// ---------------------------------------------------------------------------
// Phase 23C fix - "اجرای این منبع" for one explicitly-chosen source must run
// it regardless of its `enabled` toggle (previously the button itself was
// disabled whenever source.enabled was false, so the request was never even
// sent - no run row, no error, a silent no-op indistinguishable from the
// feature being broken). A source-less (bulk/cron) run must still only ever
// touch enabled sources.
// ---------------------------------------------------------------------------

await check('runDiscovery() runs an explicitly-chosen source even when it is DISABLED', async () => {
  const client = makeFakeClient()
  const { data: disabledSource } = await client
    .from('prospect_sources')
    .insert({ name: 'منبع غیرفعال آزمایشی', source_type: 'uploaded_dataset', enabled: false })
    .select()
    .single()
  const run = await runDiscovery(client, { sourceId: disabledSource.id, runType: 'manual' })
  assert.equal(run.status, 'completed')
  assert.equal(run.summary.sources.length, 1, 'the disabled source must still be included when explicitly chosen by id')
  assert.equal(run.summary.sources[0].sourceId, disabledSource.id)
})

await check('runDiscovery() with no sourceId (bulk/scheduled path) still only runs ENABLED sources', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'فعال', source_type: 'uploaded_dataset', enabled: true }).select().single()
  await client.from('prospect_sources').insert({ name: 'غیرفعال', source_type: 'uploaded_dataset', enabled: false }).select().single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled' })
  assert.equal(run.summary.sources.length, 1, 'only the enabled source participates in a bulk/scheduled run')
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

// ---------------------------------------------------------------------------
// Phase 24 - Autonomous Daily Prospecting Pipeline. runDiscovery() is the
// SAME function every test above already exercises - these checks cover
// only the NEW safety/idempotency behavior Phase 24 adds on top of it
// (concurrency guard, daily-only kill switch, external-request budget, run
// timeout, dry-run). See discoveryPipeline.js's own Phase 24 header comment.
// ---------------------------------------------------------------------------

await check('Phase 24: a second scheduled run is skipped while one is already "running" (duplicate cron invocation)', async () => {
  const client = makeFakeClient()
  await client.from('prospect_discovery_runs').insert({ source_id: null, run_type: 'scheduled', status: 'running' })
  const result = await runDiscovery(client, { runType: 'scheduled' })
  assert.equal(result.skipped, true)
  assert.equal(client.tables.prospect_discovery_runs.length, 1, 'no second run row was created while one was already running')
})

await check('Phase 24: a scheduled run stuck "running" past the stale threshold is reclaimed, not treated as still active', async () => {
  const client = makeFakeClient()
  const staleStartedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
  await client.from('prospect_discovery_runs').insert({ source_id: null, run_type: 'scheduled', status: 'running', started_at: staleStartedAt })
  const result = await runDiscovery(client, { runType: 'scheduled' })
  assert.notEqual(result.skipped, true, 'a stale running row must not block a new scheduled run')
  const stale = client.tables.prospect_discovery_runs.find((r) => r.started_at === staleStartedAt)
  assert.equal(stale.status, 'failed', 'the abandoned row is reclaimed as failed rather than left running forever')
})

await check('Phase 24: two full scheduled discovery runs back to back never create a duplicate lead for the same rediscovered company', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع آزمایشی روزانه', source_type: 'uploaded_dataset', enabled: true }).select().single()
  await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [manufacturerRow()] })
  await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [manufacturerRow()] })
  assert.equal(client.tables.prospect_candidates.length, 1, 'no duplicate candidate row across two scheduled runs')
  assert.equal(client.tables.sales_leads.length, 1, 'no duplicate lead across two scheduled runs')
})

await check('Phase 24: an existing lead match still blocks promotion on the scheduled (daily) path, not just manual', async () => {
  const client = makeFakeClient()
  client.tables.sales_leads.push({ id: 'lead-existing', company_name: 'شرکت قبلی', mobile: '09123456789', phone: null, email: null, city: null })
  await client.from('prospect_sources').insert({ name: 'منبع روزانه', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [manufacturerRow({ source_external_id: null })] })
  assert.equal(run.duplicates_detected, 1)
  assert.equal(client.tables.sales_leads.length, 1, 'no new lead created for a duplicate on the scheduled path')
})

await check('Phase 24: zero eligible candidates completes cleanly with promoted=0 and no errors', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع خالی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [] })
  assert.equal(run.status, 'completed')
  assert.equal(run.candidates_found, 0)
  assert.equal(run.candidates_promoted, 0)
  assert.equal(run.errors_count, 0)
})

await check('Phase 24: a source whose estimated request cost exceeds the remaining external-request budget is skipped BEFORE any network call', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].max_external_requests_per_run = 2
  await client
    .from('prospect_sources')
    .insert({
      name: 'جستجوی وب آزمایشی',
      source_type: 'search_result',
      enabled: true,
      config: { queryTemplates: ['q1', 'q2', 'q3', 'q4'] }, // estimated cost 4, budget is 2
    })
    .select()
    .single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled' })
  assert.equal(run.summary.sources.length, 1)
  assert.equal(run.summary.sources[0].skipped, true)
  assert.equal(run.summary.sources[0].reason, 'external_request_budget_exhausted')
  assert.equal(run.candidates_found, 0, 'the source was never actually queried - no fetch/Deno mock was needed for this test')
})

await check('Phase 24: exceeding run_timeout_ms stops processing further sources and marks the run "partial", never silently hanging', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].run_timeout_ms = -1 // already "expired" the instant the run starts
  await client.from('prospect_sources').insert({ name: 'منبع کند', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [manufacturerRow()] })
  assert.equal(run.status, 'partial')
  assert.equal(run.summary.timedOut, true)
  assert.equal(run.candidates_found, 0, 'the source was skipped once the timeout budget was already spent')
})

await check('Phase 24: one malformed candidate does not stop the rest of the batch from being processed', async () => {
  const client = makeFakeClient()
  const badRow = manufacturerRow({ company_name: '', source_external_id: 'bad-1' })
  const goodRow = manufacturerRow({ source_external_id: 'good-1' })
  const run = await runUploadedDatasetDiscovery(client, { rows: [badRow, goodRow], createdBy: 'admin-1' })
  assert.ok(run.errors_count >= 1, 'the malformed row is counted as an error, not silently dropped')
  assert.equal(client.tables.prospect_candidates.length, 1, 'the good row still gets processed and created')
  assert.equal(client.tables.sales_leads.length, 1, 'the good row still gets promoted despite the other row failing')
})

await check('Phase 24: a full scheduled run never touches any outreach/messaging table', async () => {
  // The fake client (makeFakeClient()) intentionally defines ONLY the
  // prospecting + sales_leads/companies tables - if the pipeline ever tried
  // to read/write an outreach/messaging table (outreach_attempts,
  // automation_tasks, inbound_replies, ...), `tables[table]` would be
  // undefined and this would throw instead of completing - that absence of
  // a throw IS the proof.
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع بدون پیام‌رسانی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [manufacturerRow()] })
  assert.equal(run.status, 'completed')
})

await check('Phase 24: daily_run_enabled=false blocks the scheduled path but NOT a manual run (a distinct kill switch from `enabled`)', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].daily_run_enabled = false
  const scheduledResult = await runDiscovery(client, { runType: 'scheduled' })
  assert.equal(scheduledResult.skipped, true)

  await client.from('prospect_sources').insert({ name: 'منبع دستی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const manualResult = await runDiscovery(client, { sourceId: null, runType: 'manual', uploadedRows: [manufacturerRow()] })
  assert.equal(manualResult.skipped, undefined, 'a manual run must still work while only the daily schedule is disabled')
  assert.equal(manualResult.status, 'completed')
})

await check('Phase 24: dry-run mode (persisted settings.dry_run) runs the full pipeline but creates zero sales_leads rows', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].dry_run = true
  await client.from('prospect_sources').insert({ name: 'منبع آزمایشی dry-run', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [manufacturerRow()] })
  assert.equal(client.tables.sales_leads.length, 0, 'dry-run must never write to sales_leads')
  assert.equal(run.candidates_promoted, 0, 'the reported promoted count must stay a true zero in dry-run')
  assert.equal(run.summary.wouldPromoteCount, 1, 'what WOULD have promoted is still reported, kept separate from the real count')
  const candidate = client.tables.prospect_candidates[0]
  assert.equal(candidate.status, 'qualified', 'the candidate is still scored/qualified for audit, just never flipped to promoted')
})

await check('Phase 24: an explicit dryRun:true argument forces dry-run even when settings.dry_run is false (the manual server-test path)', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع تست دستی سرور', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: [manufacturerRow()], dryRun: true })
  assert.equal(client.tables.sales_leads.length, 0)
  assert.equal(run.summary.dryRun, true)
})

await check('Phase 24: settingsOverride applies only to the single invocation, never persists to prospect_settings', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع اورراید', source_type: 'uploaded_dataset', enabled: true }).select().single()
  await runDiscovery(client, {
    sourceId: null,
    runType: 'scheduled',
    uploadedRows: [manufacturerRow()],
    settingsOverride: { max_candidates_per_source_per_run: 1 },
  })
  assert.equal(client.tables.prospect_settings[0].max_candidates_per_source_per_run, 100, 'the persisted setting must be untouched by a one-off override')
})

// ---------------------------------------------------------------------------
// Phase 24 acceptance-issue fix - the manual server-side test (STEP 8) must
// be able to exercise the SAME runType:'scheduled' code path the real daily
// cron will use WITHOUT requiring the persisted prospect_settings.
// daily_run_enabled to be temporarily flipped on. The fix: the edge
// function's manualTest path now passes settingsOverride:{
// daily_run_enabled: true, ... } into runDiscovery() - an in-memory
// override for that one call only, never written to the database. These
// tests exercise that EXACT override shape directly against runDiscovery(),
// the same mechanism supabase/functions/prospect-discovery/index.ts's
// manualTest branch now uses.
// ---------------------------------------------------------------------------

function manualTestSettingsOverride() {
  return { daily_run_enabled: true, max_candidates_per_source_per_run: 3, max_external_requests_per_run: 2 }
}

await check('Phase 24 fix (1): a normal scheduled run (no manualTest override) still respects daily_run_enabled=false and is skipped', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].daily_run_enabled = false
  const result = await runDiscovery(client, { runType: 'scheduled' })
  assert.equal(result.skipped, true)
})

await check('Phase 24 fix (2): the manualTest settingsOverride lets the scheduled path proceed even while daily_run_enabled=false is persisted', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].daily_run_enabled = false
  await client.from('prospect_sources').insert({ name: 'منبع تست دستی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, {
    sourceId: null,
    runType: 'scheduled',
    uploadedRows: [manufacturerRow()],
    dryRun: true,
    settingsOverride: manualTestSettingsOverride(),
  })
  assert.notEqual(run.skipped, true, 'manualTest must not be blocked by the persisted daily_run_enabled=false')
  assert.equal(run.status, 'completed')
})

await check('Phase 24 fix (3): manualTest forces dry-run - zero sales_leads even on the scheduled path with an otherwise auto-promotable candidate', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].daily_run_enabled = false
  await client.from('prospect_sources').insert({ name: 'منبع تست دستی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, {
    sourceId: null,
    runType: 'scheduled',
    uploadedRows: [manufacturerRow()],
    dryRun: true,
    settingsOverride: manualTestSettingsOverride(),
  })
  assert.equal(client.tables.sales_leads.length, 0, 'manualTest must never create a real lead')
  assert.equal(run.candidates_promoted, 0)
  assert.equal(run.summary.wouldPromoteCount, 1, 'what WOULD have promoted is still reported')
})

await check('Phase 24 fix (4): manualTest respects its own tiny 3-candidate budget even when more rows are available', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع تست دستی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const rows = [1, 2, 3, 4, 5].map((n) => manufacturerRow({ source_external_id: `ext-${n}`, mobile: `0912345670${n}` }))
  const run = await runDiscovery(client, {
    sourceId: null,
    runType: 'scheduled',
    uploadedRows: rows,
    dryRun: true,
    settingsOverride: manualTestSettingsOverride(),
  })
  assert.equal(run.candidates_found, 3, 'only 3 of the 5 available rows are evaluated, per the manualTest budget')
})

await check('Phase 24 fix (5): manualTest respects its own tiny 2-external-request budget - a costlier search source is skipped before any network call', async () => {
  const client = makeFakeClient()
  await client
    .from('prospect_sources')
    .insert({ name: 'جستجوی وب تست دستی', source_type: 'search_result', enabled: true, config: { queryTemplates: ['q1', 'q2', 'q3'] } })
    .select()
    .single()
  const run = await runDiscovery(client, {
    sourceId: null,
    runType: 'scheduled',
    dryRun: true,
    settingsOverride: manualTestSettingsOverride(),
  })
  assert.equal(run.summary.sources[0].skipped, true)
  assert.equal(run.summary.sources[0].reason, 'external_request_budget_exhausted')
})

await check('Phase 24 fix (6): manualTest never persists daily_run_enabled=true - the column stays false after the call', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].daily_run_enabled = false
  await client.from('prospect_sources').insert({ name: 'منبع تست دستی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  await runDiscovery(client, {
    sourceId: null,
    runType: 'scheduled',
    uploadedRows: [manufacturerRow()],
    dryRun: true,
    settingsOverride: manualTestSettingsOverride(),
  })
  assert.equal(client.tables.prospect_settings[0].daily_run_enabled, false, 'the persisted column must be untouched by the manualTest override')
})

await check('Phase 24 fix (7): two manualTest-shaped invocations for the same source item stay idempotent - no duplicate candidate, no duplicate lead', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع تست دستی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const rows = [manufacturerRow()] // stable source_external_id: 'ext-1'
  await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: rows, dryRun: true, settingsOverride: manualTestSettingsOverride() })
  await runDiscovery(client, { sourceId: null, runType: 'scheduled', uploadedRows: rows, dryRun: true, settingsOverride: manualTestSettingsOverride() })
  assert.equal(client.tables.prospect_candidates.length, 1, 'no duplicate candidate identity across two manualTest runs of the same item')
  assert.equal(client.tables.sales_leads.length, 0, 'still zero leads - both runs stayed dry-run')
})

await check('Phase 24 fix (8): a manualTest-shaped run never touches any outreach/messaging table (same proof-by-not-throwing as the general dry-run/scheduled tests)', async () => {
  const client = makeFakeClient()
  await client.from('prospect_sources').insert({ name: 'منبع تست دستی', source_type: 'uploaded_dataset', enabled: true }).select().single()
  const run = await runDiscovery(client, {
    sourceId: null,
    runType: 'scheduled',
    uploadedRows: [manufacturerRow()],
    dryRun: true,
    settingsOverride: manualTestSettingsOverride(),
  })
  assert.equal(run.status, 'completed')
})

// ---------------------------------------------------------------------------
// Phase 24 follow-up fix - statusCounts must reflect the TRUE final status.
// processCandidate() writes a candidate with status=finalStatus (e.g.
// 'qualified') BEFORE promoteCandidateRow() runs and flips it to 'promoted' -
// the returned `status` used to still say finalStatus even when this SAME
// call went on to promote it a moment later, so a real-time promotion was
// miscounted in run.summary.statusCounts under 'qualified' instead of
// 'promoted' (candidates_promoted itself, and the actual DB write, were
// always correct - only this one diagnostic tally was wrong).
// ---------------------------------------------------------------------------

await check('Phase 24 fix: statusCounts buckets a same-run promotion under "promoted", never under "qualified"', async () => {
  const client = makeFakeClient()
  const run = await runUploadedDatasetDiscovery(client, { rows: [manufacturerRow()], createdBy: 'admin-1' })
  assert.equal(run.candidates_promoted, 1)
  assert.equal(run.summary.statusCounts.promoted, 1, 'the newly promoted candidate must be counted under "promoted"')
  assert.equal(run.summary.statusCounts.qualified ?? 0, 0, 'it must NOT also be counted under "qualified"')
})

await check('Phase 24 fix: statusCounts still buckets a re-discovered (rescue-path) same-run promotion under "promoted" too', async () => {
  const client = makeFakeClient()
  // First run: leaves the candidate in manual_review (weak evidence), never promoted.
  const weakRow = { company_name: 'کارگاه تولیدی نمونه فاز ۲۴', business_description: 'تزریق پلاستیک برای قطعات ساده', mobile: '09121112233', source_external_id: 'rescue-ext-1' }
  await runUploadedDatasetDiscovery(client, { rows: [weakRow], createdBy: 'admin-1' })
  const before = client.tables.prospect_candidates[0]
  assert.equal(before.status, 'manual_review')
  // Re-discovering the SAME source item with strong evidence this time hits
  // the re-discovery "rescue" branch of processCandidate(), not the main
  // (new-candidate) branch - this is what regression-tests THAT branch's own
  // copy of the same fix.
  const strongRow = manufacturerRow({ source_external_id: 'rescue-ext-1' })
  const run2 = await runUploadedDatasetDiscovery(client, { rows: [strongRow], createdBy: 'admin-1' })
  assert.equal(run2.candidates_promoted, 1)
  assert.equal(run2.summary.statusCounts.promoted, 1)
  assert.equal(run2.summary.statusCounts.qualified ?? 0, 0)
})

await check('Phase 24 fix: a dry-run "would-promote" candidate is still correctly counted under "qualified", never "promoted"', async () => {
  const client = makeFakeClient()
  const run = await runDiscovery(client, {
    sourceId: (await client.from('prospect_sources').insert({ name: 'منبع dry-run آزمایشی', source_type: 'uploaded_dataset', enabled: true }).select().single()).data.id,
    runType: 'manual',
    uploadedRows: [manufacturerRow()],
    dryRun: true,
  })
  assert.equal(run.candidates_promoted, 0, 'dry-run must never flip a candidate to promoted')
  assert.equal(run.summary.statusCounts.qualified, 1, 'a would-promote candidate stays counted as qualified in dry-run')
  assert.equal(run.summary.statusCounts.promoted ?? 0, 0)
})

// ---------------------------------------------------------------------------
// Phase 33 - query rotation, reading candidates' own websites, lead
// official-site search, daily email target.
// ---------------------------------------------------------------------------

function sitePage({ title = '', siteName = null, description = '', body = '' } = {}) {
  return {
    ok: true,
    text: `<html><head><title>${title}</title>${siteName ? `<meta property="og:site_name" content="${siteName}">` : ''}<meta name="description" content="${description}"></head><body>${body}</body></html>`,
  }
}

function fakeSite(pages) {
  const calls = []
  const fetchPage = async (url) => {
    calls.push(url)
    return pages[url] || { ok: false, reason: 'پاسخ 404' }
  }
  return { fetchPage, calls }
}

function pendingCandidate(client, overrides = {}) {
  const row = {
    id: `cand-${client.tables.prospect_candidates.length + 1}`,
    status: 'manual_review',
    canonical_name: 'فیلم پلی اتیلن',
    raw_name: 'فیلم پلی اتیلن',
    normalized_name_key: normalizedNameKey('فیلم پلی اتیلن'),
    website: 'https://sample-plast.ir/film/',
    domain: 'sample-plast.ir',
    source_url: 'https://sample-plast.ir/film/',
    business_description: 'فیلم پلی اتیلن سه لایه',
    email: null,
    first_seen_at: '2026-09-24T05:00:00Z',
    ...overrides,
  }
  client.tables.prospect_candidates.push(row)
  return row
}

const MANUFACTURER_HOME = sitePage({
  title: 'صنایع پلاستیک نمونه | تولید کننده فیلم پلی اتیلن',
  siteName: 'صنایع پلاستیک نمونه',
  description: 'شرکت صنایع پلاستیک نمونه تولید کننده فیلم پلی اتیلن و نایلون کشاورزی با کارخانه در شهرک صنعتی',
  body: '<footer>ایمیل: info[at]sample-plast.ir</footer>',
})

await check('Phase 33: buildQueryPlan walks every template x location on page 1 before page 2', () => {
  const plan = buildQueryPlan({ queryTemplates: ['الف', 'ب'], locations: ['', 'تهران'], maxPages: 2 })
  assert.deepEqual(plan.map((p) => `${p.q}#${p.page}`), ['الف#1', 'ب#1', 'الف تهران#1', 'ب تهران#1', 'الف#2', 'ب#2', 'الف تهران#2', 'ب تهران#2'])
})

await check('Phase 33: nextRotationSlice continues from the cursor and wraps around', () => {
  const plan = [1, 2, 3, 4, 5].map((n) => ({ q: String(n), page: 1 }))
  const a = nextRotationSlice(plan, 3, 3)
  assert.deepEqual(a.queries.map((q) => q.q), ['4', '5', '1'])
  assert.equal(a.nextCursor, 1)
  assert.equal(nextRotationSlice(plan, 99, 2).queries[0].q, '5', 'a stale cursor past the end wraps instead of failing')
})

await check('Phase 33: a rotating search source sends the page number and runDiscovery saves the next cursor', async () => {
  const client = makeFakeClient()
  const source = (
    await client
      .from('prospect_sources')
      .insert({ name: 'serper rotating', source_type: 'search_result', enabled: true, config: { rotate: true, queriesPerRun: 3, queryTemplates: ['الف', 'ب'], locations: [''], maxPages: 3, rotationCursor: 1 } })
      .select()
      .single()
  ).data
  const bodies = []
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async (url, options) => {
      bodies.push(JSON.parse(options.body))
      return serperResponse([])
    })
    try {
      await runDiscovery(client, { sourceId: source.id, runType: 'manual' })
    } finally {
      restoreFetch()
    }
  })
  assert.deepEqual(bodies.map((b) => `${b.q}#${b.page || 1}`), ['ب#1', 'الف#2', 'ب#2'])
  assert.equal(client.tables.prospect_sources.find((s) => s.id === source.id).config.rotationCursor, 4)
})

await check('Phase 33: a dry run never moves the rotation cursor', async () => {
  const client = makeFakeClient()
  const source = (
    await client
      .from('prospect_sources')
      .insert({ name: 'serper rotating dry', source_type: 'search_result', enabled: true, config: { rotate: true, queriesPerRun: 2, queryTemplates: ['الف'], locations: [''], maxPages: 5, rotationCursor: 0 } })
      .select()
      .single()
  ).data
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async () => serperResponse([]))
    try {
      await runDiscovery(client, { sourceId: source.id, runType: 'manual', dryRun: true })
    } finally {
      restoreFetch()
    }
  })
  assert.equal(client.tables.prospect_sources.find((s) => s.id === source.id).config.rotationCursor, 0)
})

await check('Phase 33: a rotating source runs fewer queries when the external-request budget is short', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].max_external_requests_per_run = 2
  const source = (
    await client
      .from('prospect_sources')
      .insert({ name: 'serper budget', source_type: 'search_result', enabled: true, config: { rotate: true, queriesPerRun: 10, queryTemplates: ['الف'], locations: [''], maxPages: 9 } })
      .select()
      .single()
  ).data
  let calls = 0
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async () => {
      calls += 1
      return serperResponse([])
    })
    try {
      await runDiscovery(client, { sourceId: source.id, runType: 'manual' })
    } finally {
      restoreFetch()
    }
  })
  assert.equal(calls, 2)
})

await check('Phase 33: site step promotes a manufacturer the snippet left in manual_review, named and emailed from its own site', async () => {
  const client = makeFakeClient()
  pendingCandidate(client)
  const { fetchPage } = fakeSite({ 'https://sample-plast.ir/': MANUFACTURER_HOME })
  const summary = await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  assert.equal(summary.promoted, 1)
  assert.equal(summary.promotedWithEmail, 1)
  const lead = client.tables.sales_leads[0]
  assert.equal(lead.company_name, 'صنایع پلاستیک نمونه', 'the lead is named after the company, not the product page title')
  assert.equal(lead.email, 'info@sample-plast.ir', 'the obfuscated address published on the site')
  assert.equal(lead.email_lookup_status, 'found')
  assert.equal(lead.email_source_url, 'https://sample-plast.ir/')
  const cand = client.tables.prospect_candidates[0]
  assert.equal(cand.status, 'promoted')
  assert.equal(cand.site_check_status, 'email_found')
  assert.ok(cand.site_checked_at)
})

await check('Phase 33: site step never fetches a page the snippet already shows is an article/directory', async () => {
  const client = makeFakeClient()
  pendingCandidate(client, { raw_name: 'بهترین تولیدکنندگان فیلم پلی اتیلن', canonical_name: 'sample', business_description: 'لیست بهترین کارخانه های تولید فیلم' })
  const { fetchPage, calls } = fakeSite({})
  const summary = await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  assert.equal(calls.length, 0)
  assert.equal(summary.byStatus.not_company, 1)
  assert.equal(client.tables.prospect_candidates[0].site_check_status, 'not_company')
  assert.equal(client.tables.sales_leads.length, 0)
})

await check('Phase 33: site step does not promote a site that turns out to be a marketplace', async () => {
  const client = makeFakeClient()
  pendingCandidate(client)
  const { fetchPage } = fakeSite({
    'https://sample-plast.ir/': sitePage({ title: 'نما بازار , نمایشگاه و بازار مجازی ایران', description: 'نمایشگاه و بازار مجازی ایران', body: 'info@sample-plast.ir' }),
  })
  await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  assert.equal(client.tables.sales_leads.length, 0)
  assert.notEqual(client.tables.prospect_candidates[0].status, 'promoted')
})

await check('Phase 33: site step does not promote a packaging-machinery maker', async () => {
  const client = makeFakeClient()
  pendingCandidate(client)
  const { fetchPage } = fakeSite({
    'https://sample-plast.ir/': sitePage({
      title: 'ایرانو صنعت | تولیدکننده تخصصی دستگاه‌های بسته‌بندی',
      siteName: 'ایرانو صنعت',
      description: 'تولیدکننده دستگاه‌های بسته‌بندی شیرینگ و استرچ پالت',
      body: 'info@sample-plast.ir',
    }),
  })
  await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  assert.equal(client.tables.sales_leads.length, 0)
})

await check('Phase 33: site step marks a candidate whose email or site already belongs to a lead as a duplicate', async () => {
  const client = makeFakeClient()
  client.tables.sales_leads.push({ id: 'lead-existing', company_name: 'قدیمی', email: 'INFO@sample-plast.ir', website: null })
  pendingCandidate(client)
  const { fetchPage } = fakeSite({ 'https://sample-plast.ir/': MANUFACTURER_HOME })
  const summary = await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  assert.equal(summary.duplicates, 1)
  assert.equal(client.tables.sales_leads.length, 1, 'no second lead for the same address')
  assert.equal(client.tables.prospect_candidates[0].status, 'duplicate')
  assert.equal(client.tables.prospect_candidates[0].matched_lead_id, 'lead-existing')
})

await check('Phase 33: site step in dry-run reads and counts but writes nothing', async () => {
  const client = makeFakeClient()
  pendingCandidate(client)
  const { fetchPage } = fakeSite({ 'https://sample-plast.ir/': MANUFACTURER_HOME })
  const summary = await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, dryRun: true, promotions: { remaining: 5 }, fetchPage })
  assert.equal(summary.wouldPromote, 1)
  assert.equal(client.tables.sales_leads.length, 0)
  assert.equal(client.tables.prospect_candidates[0].site_checked_at, undefined)
  assert.equal(client.tables.prospect_candidates[0].status, 'manual_review')
})

await check('Phase 33: site step leaves candidates pending once the promotion budget is used up', async () => {
  const client = makeFakeClient()
  pendingCandidate(client, { first_seen_at: '2026-09-24T06:00:00Z' })
  pendingCandidate(client, { website: 'https://second-plast.ir/', domain: 'second-plast.ir', first_seen_at: '2026-09-24T05:00:00Z' })
  const second = sitePage({ title: 'پلاستیک دوم', siteName: 'پلاستیک دوم', description: 'شرکت پلاستیک دوم تولید کننده فیلم پلی اتیلن با کارخانه', body: 'sales@second-plast.ir' })
  const { fetchPage } = fakeSite({ 'https://sample-plast.ir/': MANUFACTURER_HOME, 'https://second-plast.ir/': second })
  const summary = await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 1 }, fetchPage })
  assert.equal(summary.promoted, 1)
  assert.equal(summary.stoppedBy, 'promotion_budget')
  const unpromoted = client.tables.prospect_candidates.find((c) => c.status !== 'promoted')
  assert.equal(unpromoted.site_checked_at, undefined, 'the one over budget is checked again next run, not lost')
})

await check('Phase 33: site step retries a site that failed to load only after a few days', async () => {
  const client = makeFakeClient()
  const now = Date.parse('2026-09-24T10:00:00Z')
  pendingCandidate(client, { site_checked_at: '2026-09-23T10:00:00Z', site_check_status: 'fetch_failed' })
  const { fetchPage, calls } = fakeSite({})
  await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage, now })
  assert.equal(calls.length, 0)
  await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage, now: now + 3 * 86400000 })
  assert.ok(calls.length > 0)
})

await check('Phase 33: lead official-site search accepts a site only when its own name markers contain every distinctive word', async () => {
  const search = async () => [
    { title: 'شیمی لیا فردوس - اخبار', link: 'https://news-site.ir/x', snippet: 'مقاله' },
    { title: 'فردوس شیمی لیا', link: 'https://ferdows-lia.ir/', snippet: 'تولید مواد شوینده' },
  ]
  const { fetchPage } = fakeSite({
    'https://news-site.ir/': sitePage({ title: 'خبرگزاری', siteName: 'خبرگزاری' }),
    'https://ferdows-lia.ir/': sitePage({ title: 'فردوس شیمی لیا', siteName: 'فردوس شیمی لیا', body: 'info@ferdows-lia.ir' }),
  })
  const result = await findLeadEmailViaSearch({ companyName: 'فردوس شیمی لیا', search, fetchPage })
  assert.equal(result.status, 'found')
  assert.equal(result.email, 'info@ferdows-lia.ir')
  assert.equal(result.site, 'https://ferdows-lia.ir/')

  const partial = fakeSite({ 'https://ferdows-lia.ir/': sitePage({ title: 'فردوس ساختمان', siteName: 'فردوس ساختمان', body: 'info@ferdows-lia.ir' }) })
  const miss = await findLeadEmailViaSearch({ companyName: 'فردوس شیمی لیا', search: async () => [{ title: 'x', link: 'https://ferdows-lia.ir/' }], fetchPage: partial.fetchPage })
  assert.equal(miss.status, 'official_site_not_found', 'a site sharing only one word of the name is another company')
})

await check('Phase 33: lead official-site search never searches a one-word name', async () => {
  let searched = false
  const result = await findLeadEmailViaSearch({
    companyName: 'زیباوش',
    search: async () => {
      searched = true
      return []
    },
  })
  assert.equal(result.status, 'name_too_generic')
  assert.equal(searched, false)
})

await check('Phase 33: searchOfficialSitesForLeads fills the email once, never over another lead\'s address', async () => {
  const client = makeFakeClient()
  client.tables.sales_leads.push(
    { id: 'l1', company_name: 'فردوس شیمی لیا', email: null, status: 'new', email_lookup_status: 'not_official_website', website: 'https://dhci.org/x.pdf' },
    { id: 'l2', company_name: 'آریا شیمی رایکا', email: null, status: 'new', email_lookup_status: 'not_official_website' },
    { id: 'l3', company_name: 'قبلی', email: 'info@aria-raika.ir', status: 'new' },
    { id: 'l4', company_name: 'سپیدار شیمی مهرا', email: null, status: 'new', do_not_contact: true, email_lookup_status: 'identity_mismatch' },
  )
  const search = async (q) => (q.includes('فردوس') ? [{ title: 'فردوس شیمی لیا', link: 'https://ferdows-lia.ir/' }] : [{ title: 'آریا شیمی رایکا', link: 'https://aria-raika.ir/' }])
  const { fetchPage } = fakeSite({
    'https://ferdows-lia.ir/': sitePage({ title: 'فردوس شیمی لیا', siteName: 'فردوس شیمی لیا', body: 'info@ferdows-lia.ir' }),
    'https://aria-raika.ir/': sitePage({ title: 'آریا شیمی رایکا', siteName: 'آریا شیمی رایکا', body: 'info@aria-raika.ir' }),
  })
  const summary = await searchOfficialSitesForLeads(client, { deadline: Date.now() + 60000, maxSearches: 4, search, fetchPage })
  assert.equal(summary.found, 1)
  const [l1, l2, , l4] = client.tables.sales_leads
  assert.equal(l1.email, 'info@ferdows-lia.ir')
  assert.equal(l1.website, 'https://dhci.org/x.pdf', 'the recorded website is left as the admin entered it')
  assert.equal(l2.email, null, 'an address already used by another lead is not attached')
  assert.ok(l2.official_site_search_at)
  assert.equal(l4.official_site_search_at, undefined, 'do-not-contact leads are never searched')
  const again = await searchOfficialSitesForLeads(client, { deadline: Date.now() + 60000, maxSearches: 4, search, fetchPage })
  assert.equal(again.searched, 0, 'each lead is searched once')
})

await check('Phase 33: a scheduled server run skips once today\'s new-email target is reached', async () => {
  const client = makeFakeClient()
  client.tables.prospect_settings[0].daily_new_email_target = 2
  const nowIso = new Date().toISOString()
  client.tables.sales_leads.push({ id: 'a', email_lookup_status: 'found', email_lookup_at: nowIso }, { id: 'b', email_lookup_status: 'found', email_lookup_at: nowIso })
  const result = await runDiscovery(client, { runType: 'scheduled', serverPhases: true, fetchPage: async () => ({ ok: false }), search: async () => [] })
  assert.equal(result.skipped, true)
  assert.equal(client.tables.prospect_discovery_runs.length, 0)
})

await check('Phase 33: a server run discovers, then reads the new candidate\'s site and promotes it with its email', async () => {
  const client = makeFakeClient()
  const source = (
    await client
      .from('prospect_sources')
      .insert({ name: 'serper e2e', source_type: 'search_result', enabled: true, config: { rotate: true, queriesPerRun: 1, queryTemplates: ['فیلم'], locations: [''] } })
      .select()
      .single()
  ).data
  const { fetchPage } = fakeSite({ 'https://sample-plast.ir/': MANUFACTURER_HOME })
  let run
  await withFakeDenoEnv({ SERPER_API_KEY: 'fake-key' }, async () => {
    mockFetch(async () => serperResponse([{ title: 'فیلم پلی اتیلن', link: 'https://sample-plast.ir/film/', snippet: 'فیلم پلی اتیلن سه لایه' }]))
    try {
      run = await runDiscovery(client, { sourceId: source.id, runType: 'manual', serverPhases: true, fetchPage, search: async () => [] })
    } finally {
      restoreFetch()
    }
  })
  assert.equal(run.candidates_created, 1)
  assert.equal(run.summary.siteVerification.promoted, 1)
  assert.equal(run.candidates_promoted, 1)
  assert.equal(client.tables.sales_leads[0].email, 'info@sample-plast.ir')
  assert.equal(run.summary.emailsFoundTodayAfter, 1)
})

await check('Phase 33: a theme placeholder name (Latin, unrelated to the domain) is skipped for the site title', async () => {
  const client = makeFakeClient()
  pendingCandidate(client, { website: 'https://rashaplast.ir/x/', domain: 'rashaplast.ir' })
  const { fetchPage } = fakeSite({
    'https://rashaplast.ir/': sitePage({ title: 'خانه - راشا پلاست', siteName: 'recook', description: 'شرکت راشا پلاست تولید کننده کیسه گونی پلاستیکی با کارخانه', body: 'info@rashaplast.ir' }),
  })
  await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  assert.equal(client.tables.sales_leads[0]?.company_name, 'راشا پلاست')
})

await check('Phase 35: site step also takes the numbers the candidate\'s site publishes, with their source page', async () => {
  const client = makeFakeClient()
  pendingCandidate(client)
  const home = sitePage({
    title: 'صنایع پلاستیک نمونه | تولید کننده فیلم پلی اتیلن',
    siteName: 'صنایع پلاستیک نمونه',
    description: 'شرکت صنایع پلاستیک نمونه تولید کننده فیلم پلی اتیلن و نایلون کشاورزی با کارخانه در شهرک صنعتی',
    body: '<footer>info@sample-plast.ir <a href="tel:09121234567">تماس</a> تلفن: 021-88001122</footer>',
  })
  const { fetchPage } = fakeSite({ 'https://sample-plast.ir/': home })
  await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  const lead = client.tables.sales_leads[0]
  assert.equal(lead.mobile, '09121234567')
  assert.equal(lead.phone, '02188001122')
  assert.equal(lead.phone_source_url, 'https://sample-plast.ir/')
  assert.equal(lead.contact_lookup_status, 'found')
  assert.ok(lead.contact_sources.some((c) => c.field === 'mobile' && c.value === '09121234567' && c.sourceUrl === 'https://sample-plast.ir/'))
})

await check('Phase 35: a candidate whose site mobile is already on a lead is a duplicate, not a second lead', async () => {
  const client = makeFakeClient()
  client.tables.sales_leads.push({ id: 'lead-by-hand', company_name: 'ثبت دستی', email: null, website: null, mobile: '0912 123 4567', phone: null })
  pendingCandidate(client)
  const home = sitePage({
    title: 'صنایع پلاستیک نمونه',
    siteName: 'صنایع پلاستیک نمونه',
    description: 'شرکت صنایع پلاستیک نمونه تولید کننده فیلم پلی اتیلن با کارخانه',
    body: '<a href="tel:+989121234567">تماس</a>',
  })
  const { fetchPage } = fakeSite({ 'https://sample-plast.ir/': home })
  await verifyPendingCandidateSites(client, { settings: DEFAULT_SETTINGS, deadline: Date.now() + 60000, promotions: { remaining: 5 }, fetchPage })
  assert.equal(client.tables.sales_leads.length, 1)
  assert.equal(client.tables.prospect_candidates[0].status, 'duplicate')
  assert.equal(client.tables.prospect_candidates[0].matched_lead_id, 'lead-by-hand')
})

console.log(`\n${passed} check(s) passed.`)
