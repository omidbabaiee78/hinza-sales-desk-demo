import { normalizedNameKey, cleanCompanyName, extractContactNumbers, extractDomain, normalizeEmail, normalizeSearchText } from '../normalization.js'
import { classifyEntityType, isNonCompanyEntityType } from '../entityClassification.js'
import { resolveCompanySelfIdentity } from '../textMatching.js'

// ---------------------------------------------------------------------------
// Phase 23C - Serper (google.serper.dev) Google Search API as the primary
// live prospect source. OSM/Overpass (Phase 23B) stays wired up as an
// optional secondary/experimental source - see discoveryPipeline.js's
// ensureDefaultSources() - but repeated live testing showed its public
// mirrors are too unreliable (timeouts / 406s) to be the PRIMARY source, so
// this adapter searches Google instead, via a paid, reliable, ToS-compliant
// API - never raw scraping of Google itself.
//
// Same "only ever runs server-side" rule as osmOverpass.js: this file is
// still imported into the browser bundle (via sourceAdapters/index.js ->
// discoveryPipeline.js), but its discover()/healthCheck() are only ever
// actually CALLED from supabase/functions/prospect-discovery/index.ts - the
// browser only ever invokes that Edge Function (see useProspecting.js). This
// is what makes it safe to read Deno.env.get('SERPER_API_KEY') lazily inside
// those two functions: it is never evaluated in a browser context.
//
// Query themes (source.config.queryTemplates) are per-source CONFIG, not
// pipeline logic - see DEFAULT_QUERY_TEMPLATES below, which
// discoveryPipeline.js's ensureDefaultSources() seeds the DB row with, and
// which an admin can freely edit afterwards via prospect_sources.config.
//
// Enrichment readiness (spec section 12): source_url/website/domain are
// captured here so a LATER, separate step could visit a shortlisted
// candidate's own site and look for products/phone/email/address - that
// enrichment step does not exist yet (deliberately: it would need its own
// careful, ToS-respecting fetch/parse design, e.g. robots.txt checks and a
// tight timeout, not something to bolt on here) - this adapter only ever
// stores what Google's own search index already returned, never fetches a
// result's page itself.
// ---------------------------------------------------------------------------

export const DEFAULT_QUERY_TEMPLATES = [
  'تولید کننده فیلم پلی اتیلن',
  'تولید کننده نایلون و نایلکس',
  'تولید کننده فیلم کشاورزی',
  'تولید کننده شیرینگ',
  'تولید کننده لوله پلی اتیلن',
  'تولید کننده تیپ آبیاری',
  'کارخانه تزریق پلاستیک',
  'تولید کننده قطعات پلاستیکی',
  'تولید کننده ظروف پلاستیکی',
  'تولید کننده PET و پریفرم',
  'تولید کننده ورق پلی کربنات',
  'تولید کننده ABS',
  'کارخانه اکستروژن پلاستیک',
  'تولید کننده شیلنگ پلاستیکی',
  'تولید کننده کامپاند پلیمری',
]

const SERPER_SEARCH_URL = 'https://google.serper.dev/search'
const DEFAULT_GL = 'ir'
const DEFAULT_HL = 'fa'
const DEFAULT_RESULTS_PER_QUERY = 10
const SEARCH_FETCH_TIMEOUT_MS = 15000
const HEALTH_CHECK_FETCH_TIMEOUT_MS = 12000
const HEALTH_CHECK_QUERY = 'تولید کننده پلاستیک ایران'

function getApiKey() {
  // globalThis.Deno only exists in the Edge Function runtime - referenced
  // via globalThis (never the bare `Deno` global) so this never trips
  // no-undef under the browser bundle's lint config; the branch itself
  // never executes in the browser anyway (see file header).
  return typeof globalThis.Deno !== 'undefined' ? globalThis.Deno.env.get('SERPER_API_KEY') : undefined
}

function validateConfig(config) {
  if (config?.queryTemplates !== undefined && !Array.isArray(config.queryTemplates)) {
    return 'الگوهای جستجو (queryTemplates) در تنظیمات این منبع باید به‌صورت آرایه تعریف شوند.'
  }
  if (config?.maxQueriesPerRun !== undefined && !Number.isFinite(config.maxQueriesPerRun)) {
    return 'حداکثر تعداد جستجو در هر اجرا (maxQueriesPerRun) باید یک عدد باشد.'
  }
  if (config?.resultsPerQuery !== undefined && !Number.isFinite(config.resultsPerQuery)) {
    return 'تعداد نتایج هر جستجو (resultsPerQuery) باید یک عدد باشد.'
  }
  return null
}

async function runSearch({ apiKey, query, gl, hl, num, timeoutMs }) {
  const controller = new AbortController()
  const timeoutError = new Error(`درخواست به Serper API برای عبارت «${query}» بیش از ${timeoutMs} میلی‌ثانیه طول کشید.`)
  timeoutError.isTimeout = true
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)

  let response
  try {
    response = await fetch(SERPER_SEARCH_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, gl, hl, num }),
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) throw timeoutError
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const error = new Error(`Serper API برای عبارت «${query}» پاسخ ${response.status} داد.`)
    error.status = response.status
    throw error
  }
  return response.json()
}

// Best-effort company-name guess from a search result's own title/domain -
// NEVER invented text, just the shortest usable slice of what Google's
// index already returned. Titles are commonly "Company Name | تاگ‌لاین" or
// "Company Name - Page" - the segment before the first separator is almost
// always the site/company name; falling back to the domain label keeps
// every result usable even when the title has no clean separator.
function guessCompanyName(title, domain) {
  if (title) {
    const firstSegment = title.split(/[-|–—:]/)[0].trim()
    if (firstSegment.length >= 2 && firstSegment.length <= 80) return firstSegment
  }
  if (domain) {
    const label = domain.split('.')[0].replace(/[-_]/g, ' ').trim()
    if (label) return label
  }
  return title || null
}

// Phase 23D-FINAL, section G - COMPANY IDENTITY RESOLUTION. A Serper title
// is very often a PRODUCT/PAGE title, not a company name at all
// ("فیلم پلی اتیلن" for a company's product subpage) - guessCompanyName()
// above would then wrongly turn a product name into the "company", and a
// lead could end up created with a company_name like "فیلم پلی اتیلن"
// instead of the company that actually makes it.
//
// A company almost always self-identifies SOMEWHERE in the title/snippet
// text Google already returned - see textMatching.js's
// resolveCompanySelfIdentity() (moved there in 23D-FINAL.1 so the SAME
// extraction also runs against a fetched About/Contact page's own text, see
// identityResolution.js/websiteEnrichment.js). This is only ever a hint the
// search snippet offers, never itself sufficient to AUTO-PROMOTE a candidate
// any more - see qualification.js's isPromotableIdentity()/hasResolvedIdentity
// gate, which now requires real first-party website verification for
// exactly this reason (a title/snippet self-ID can still be wrong or
// stale/copied from elsewhere).
function resolveCompanyIdentity(title, snippet) {
  return resolveCompanySelfIdentity(`${title || ''} ${snippet || ''}`)
}

// A title that OPENS with a bare product/material word and never
// self-identifies as a maker/company anywhere is very likely just a
// product/page title, not a company name - safer to fall back to the
// domain (an honest "we found this on domain X, not sure of the exact
// company name yet") than to create a candidate literally named after a
// product.
const PRODUCT_ONLY_TITLE_STARTERS = [
  'فیلم', 'نایلون', 'نایلکس', 'لوله', 'اتصالات', 'پریفرم', 'ظروف', 'قطعات', 'شیلنگ', 'ورق', 'کامپاند', 'نوار', 'بطری', 'شرینک', 'استرچ',
]

function looksLikeProductOnlyTitle(title, hasCompanySelfId) {
  if (hasCompanySelfId || !title) return false
  const firstWord = normalizeSearchText(title).split(/\s+/)[0]
  return PRODUCT_ONLY_TITLE_STARTERS.includes(firstWord)
}

const EMAIL_IN_TEXT_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/

export const serperSearchAdapter = {
  sourceType: 'search_result',

  async discover(source) {
    const config = source?.config || {}
    const configError = validateConfig(config)
    if (configError) throw new Error(configError)

    const apiKey = getApiKey()
    if (!apiKey) {
      const error = new Error('credential_required: کلید Serper API (SERPER_API_KEY) در Edge Function تنظیم نشده است - این منبع بدون آن کار نمی‌کند.')
      error.code = 'credential_required'
      throw error
    }

    const queryTemplates = Array.isArray(config.queryTemplates) && config.queryTemplates.length ? config.queryTemplates : DEFAULT_QUERY_TEMPLATES
    const maxQueriesPerRun = Number.isFinite(config.maxQueriesPerRun) ? config.maxQueriesPerRun : queryTemplates.length
    const resultsPerQuery = Number.isFinite(config.resultsPerQuery) ? config.resultsPerQuery : DEFAULT_RESULTS_PER_QUERY
    const gl = config.gl || DEFAULT_GL
    const hl = config.hl || DEFAULT_HL
    const templatesToRun = queryTemplates.slice(0, Math.max(1, maxQueriesPerRun))

    const results = []
    const seenLinks = new Set()
    const queryErrors = []

    // Sequential, never Promise.all'd - same "don't hammer shared/rate-
    // limited infrastructure" discipline as the OSM adapter, and it also
    // keeps credit spend predictable (one request in flight at a time).
    for (const query of templatesToRun) {
      let payload
      try {
        payload = await runSearch({ apiKey, query, gl, hl, num: resultsPerQuery, timeoutMs: SEARCH_FETCH_TIMEOUT_MS })
      } catch (err) {
        // One query failing (a transient timeout, a single bad request)
        // must never abort the whole source - the same "one failure never
        // aborts the whole run" principle runDiscovery() already applies
        // one level up, applied here one level down.
        queryErrors.push(`«${query}»: ${err.isTimeout ? 'timeout' : err.status || err.message}`)
        continue
      }
      for (const item of payload?.organic || []) {
        if (!item?.link || seenLinks.has(item.link)) continue
        seenLinks.add(item.link)
        results.push({ ...item, _sourceQuery: query })
      }
    }

    if (results.length === 0 && queryErrors.length > 0) {
      throw new Error(`هیچ نتیجه‌ای از Serper API دریافت نشد: ${queryErrors.join('، ')}`)
    }
    if (queryErrors.length > 0) {
      console.warn(`prospect-discovery/serperSearch: ${queryErrors.length} query(ies) failed but others succeeded: ${queryErrors.join('، ')}`)
    }

    return results
  },

  normalize(rawItem) {
    const title = rawItem.title || ''
    const link = rawItem.link || null
    const domain = extractDomain(link)
    const snippet = rawItem.snippet || ''
    const combinedText = `${title} ${snippet}`
    const contacts = extractContactNumbers(combinedText)
    const email = normalizeEmail((combinedText.match(EMAIL_IN_TEXT_REGEX) || [])[0])

    // Phase 23D (Smart Qualification 2.0), item 7: a listicle/directory
    // page's own headline ("بهترین تولیدکنندگان...", "لیست کارخانه‌ها...")
    // must never be presented as if it were a company's name - the SAME
    // deterministic classification evidenceEngine.js later uses to gate
    // qualification is applied here first, so a non-company result's
    // canonical_name safely falls back to its domain instead of a
    // misleading article headline.
    const entityType = classifyEntityType({ domain, title, snippet, url: link })
    // Section G - prefer the page's own self-identification ("X،
    // تولیدکننده Y" / "شرکت X") over a raw title guess; if neither exists
    // AND the title reads as a bare product name, fall back to the domain
    // rather than turning a product/page title into a fake company name.
    const resolvedIdentity = isNonCompanyEntityType(entityType) ? null : resolveCompanyIdentity(title, snippet)
    const productOnlyTitle = looksLikeProductOnlyTitle(title, Boolean(resolvedIdentity))
    const companyNameGuess = resolvedIdentity
      ? resolvedIdentity
      : isNonCompanyEntityType(entityType)
        ? null
        : // A bare product-name title ("فیلم پلی اتیلن") falls back to the
          // domain label (via guessCompanyName's own domain branch, never
          // the raw domain string) rather than becoming a fake company
          // name.
          guessCompanyName(productOnlyTitle ? '' : title, domain)
    const nameForCandidate = companyNameGuess || domain || title || null

    return {
      canonical_name: cleanCompanyName(nameForCandidate),
      // raw_name keeps the actual literal title regardless of entity type -
      // canonical_name is the conservative/safe identity, raw_name is the
      // full audit trail of what the page actually said.
      raw_name: title || companyNameGuess || domain || null,
      normalized_name_key: normalizedNameKey(nameForCandidate),
      website: link,
      domain,
      phone: contacts.phone,
      mobile: contacts.mobile,
      email,
      province: null,
      city: null,
      address: null,
      // Phase 23D, item 2: the search query that SURFACED this result is
      // NOT proof of what the result itself is - it must never be folded
      // into industry evidence as if it were confirmed (see
      // evidenceEngine.js's candidateSearchText()). It stays out of
      // industry_guess entirely; the query is still preserved, for
      // traceability only, inside raw_data._sourceQuery below.
      industry_guess: null,
      business_description: snippet || null,
      source_url: link,
      source_external_id: link,
      raw_data: rawItem,
    }
  },

  async healthCheck(source) {
    const config = source?.config || {}
    const configError = validateConfig(config)
    if (configError) {
      return { ok: false, status: 'config_error', message: configError }
    }

    const apiKey = getApiKey()
    if (!apiKey) {
      return {
        ok: false,
        status: 'credential_required',
        message: 'credential_required: کلید Serper API (SERPER_API_KEY) در Edge Function تنظیم نشده است.',
      }
    }

    try {
      const payload = await runSearch({
        apiKey,
        query: HEALTH_CHECK_QUERY,
        gl: config.gl || DEFAULT_GL,
        hl: config.hl || DEFAULT_HL,
        num: 1,
        timeoutMs: HEALTH_CHECK_FETCH_TIMEOUT_MS,
      })
      if (!Array.isArray(payload?.organic)) {
        return { ok: false, status: 'unavailable', message: 'پاسخ Serper API ساختار مورد انتظار را نداشت.' }
      }
      return { ok: true, status: 'healthy', message: `Serper API در دسترس است (${payload.organic.length} نتیجه آزمایشی دریافت شد).` }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        return { ok: false, status: 'credential_required', message: `کلید Serper API نامعتبر یا رد شده است (HTTP ${err.status}).` }
      }
      if (err.isTimeout) {
        return { ok: false, status: 'unavailable', message: 'درخواست به Serper API با تایم‌اوت مواجه شد.' }
      }
      return { ok: false, status: 'unavailable', message: `Serper API در دسترس نیست: ${err.message}` }
    }
  },
}
