import { normalizedNameKey, cleanCompanyName, extractContactNumbers, extractDomain, normalizeEmail } from '../normalization.js'

// ---------------------------------------------------------------------------
// A REAL, working live source: OpenStreetMap's Overpass API. Public, free,
// no API key, no login, no CAPTCHA - the sanctioned query interface OSM
// itself provides for exactly this kind of "find businesses matching a tag/
// name pattern" use. Data is community-mapped and licensed ODbL
// (https://www.openstreetmap.org/copyright) - every candidate this adapter
// produces carries its real OSM node/way URL as source_url, so provenance
// is always traceable back to the actual public record, never fabricated.
//
// This adapter must only ever run server-side (inside
// supabase/functions/prospect-discovery) - never invoked directly from a
// browser client (see discoveryPipeline.js / the Edge Function for why).
//
// Reliability, Phase 23B hardening:
//   - a POOL of public Overpass mirrors, configurable per source
//     (source.config.endpoints), never hardcoded to one host - any one
//     mirror being down/rate-limited only ever costs that mirror's own
//     timeout budget before moving to the next.
//   - every request carries a descriptive User-Agent, per Overpass's own
//     usage expectations.
//   - all configured keywords are combined into ONE regex alternation in
//     ONE query - never one HTTP request per keyword.
//   - requests are always sequential, never Promise.all'd in parallel -
//     this is shared public infrastructure, not ours to hammer.
//   - a 429 is a TRANSIENT/degraded provider state, never a hard failure -
//     but we never sit on our hands waiting for a slow/misbehaving mirror.
//     During discover(), a SHORT, EXPLICIT Retry-After is honored (one
//     retry, same endpoint, budget spent once per call) - anything longer,
//     or no Retry-After at all, fails over to the next endpoint immediately.
//     During healthCheck() we never wait on a 429 at all - it is a cheap,
//     frequent probe and must fail over instantly.
//   - on any failure (network error, timeout, non-2xx, 429), a short
//     per-endpoint outcome is recorded (e.g. "overpass-api.de: timeout")
//     so a fully-failed attempt reports which mirrors were tried and how
//     each one failed, not just the last error.
// ---------------------------------------------------------------------------

// overpass.kumi.systems was retired - replaced with overpass.private.coffee.
// Order matters: earlier entries are tried first.
const DEFAULT_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

const DEFAULT_KEYWORDS = ['پلاستیک', 'پلیمر', 'مستربچ']
const DEFAULT_COUNTRY_CODE = 'IR'
const DEFAULT_LIMIT = 80

// Per-endpoint HTTP timeouts. Kept comfortably below any caller-side budget
// (the pipeline isolates one source's failure from the rest of a run) so a
// single slow mirror never eats more than its own share before failover.
const OVERPASS_TIMEOUT_SECONDS = 25
const DISCOVER_FETCH_TIMEOUT_MS = 28000
const HEALTH_CHECK_FETCH_TIMEOUT_MS = 14000

// A Retry-After is only ever honored during discover() when it's short
// enough that waiting is still cheaper than just moving on - never the
// unbounded/long waits a provider might ask for. healthCheck() never
// honors Retry-After at all (see ALLOW_RETRY_AFTER below).
const REASONABLE_RETRY_AFTER_CAP_MS = 10000

const USER_AGENT = 'HinzaProspecting/1.0 (+https://hinzapolymer.com)'
const HEALTH_CHECK_QUERY = '[out:json][timeout:5];out count;'

function escapeForRegex(keyword) {
  // Keywords are our own configured Persian/English words, never raw user
  // input from outside this codebase - still stripped of characters that
  // would otherwise break the Overpass regex syntax if ever misconfigured.
  return String(keyword).replace(/["\\]/g, '')
}

// One combined query for ALL configured keywords via a single regex
// alternation - never one HTTP request per keyword.
function buildDiscoverQuery({ keywords, countryCode, limit }) {
  const pattern = keywords.map(escapeForRegex).join('|')
  return (
    `[out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];` +
    `area["ISO3166-1"="${countryCode}"][admin_level=2]->.country;` +
    `node["name"~"${pattern}",i](area.country);` +
    `out center tags ${limit};`
  )
}

function resolveEndpoints(config) {
  if (Array.isArray(config?.endpoints)) {
    const valid = config.endpoints.filter((e) => typeof e === 'string' && /^https?:\/\//.test(e))
    if (valid.length > 0) return valid
  }
  return DEFAULT_ENDPOINTS
}

// A genuine admin mistake (e.g. hand-editing prospect_sources.config and
// setting keywords/endpoints to something other than an array) is a
// CONFIGURATION error, distinct from a network/provider problem - it must
// never be silently swallowed by falling back to defaults, or the admin
// would never learn their config change had no effect.
function validateConfig(config) {
  if (config?.keywords !== undefined && !Array.isArray(config.keywords)) {
    return 'کلیدواژه‌ها (keywords) در تنظیمات این منبع باید به‌صورت آرایه تعریف شوند.'
  }
  if (config?.endpoints !== undefined && !Array.isArray(config.endpoints)) {
    return 'آدرس‌های Overpass (endpoints) در تنظیمات این منبع باید به‌صورت آرایه تعریف شوند.'
  }
  return null
}

// Raw Retry-After parse, no capping - the caller decides what "reasonable"
// means for its own context (discover() caps it, healthCheck() never
// honors it at all).
function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null
  const seconds = Number(headerValue)
  if (Number.isFinite(seconds)) return Math.max(seconds, 0) * 1000
  const dateMs = Date.parse(headerValue)
  if (!Number.isNaN(dateMs)) {
    const diffMs = dateMs - Date.now()
    return diffMs > 0 ? diffMs : 0
  }
  return null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hostLabel(endpoint) {
  try {
    return new URL(endpoint).hostname
  } catch {
    return endpoint
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timeoutError = new Error(`درخواست به ${url} بیش از ${timeoutMs} میلی‌ثانیه طول کشید.`)
  timeoutError.isTimeout = true
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    // Some runtimes reject with a generic AbortError/DOMException instead of
    // propagating the abort reason itself - normalize either way so timeout
    // diagnostics are never misreported as a plain network error.
    if (controller.signal.aborted) throw timeoutError
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function postOnce(endpoint, query, timeoutMs) {
  return fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    },
    timeoutMs,
  )
}

function describeOutcome(err, response) {
  if (response) return response.status === 429 ? '429' : String(response.status)
  if (err?.isTimeout) return 'timeout'
  const message = err?.message || 'خطای ناشناخته'
  return message.length > 80 ? `${message.slice(0, 80)}…` : message
}

// Sequential (never parallel) attempt across the endpoint pool. Returns
// { json, endpoint, rateLimited, attempts } on success - `attempts` lists
// any endpoints that failed BEFORE the one that succeeded, in the same
// "host: outcome" shape used on total failure, for callers that want to
// log a partial-degradation trail even when the call ultimately succeeded.
// Throws an Error with `.rateLimited` and `.attempts` set when every
// endpoint fails; the thrown message itself already includes the
// per-endpoint summary, so callers never need to re-derive it.
async function postOverpassQuery(query, { endpoints, timeoutMs, allowRetryAfter, retryAfterCapMs = 0 }) {
  const attempts = []
  let sawRateLimit = false
  let retryUsed = false

  for (const endpoint of endpoints) {
    let response
    try {
      response = await postOnce(endpoint, query, timeoutMs)
    } catch (err) {
      attempts.push(`${hostLabel(endpoint)}: ${describeOutcome(err)}`)
      continue
    }

    if (response.status === 429) {
      sawRateLimit = true
      let retried = false

      if (allowRetryAfter && !retryUsed) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'))
        if (retryAfterMs !== null && retryAfterMs <= retryAfterCapMs) {
          retryUsed = true
          retried = true
          await sleep(retryAfterMs)
          try {
            response = await postOnce(endpoint, query, timeoutMs)
            if (response.status === 429) sawRateLimit = true
          } catch (err) {
            attempts.push(`${hostLabel(endpoint)}: ${describeOutcome(err)} (پس از تلاش دوباره)`)
            continue
          }
        }
      }

      if (response.status === 429) {
        attempts.push(`${hostLabel(endpoint)}: 429${retried ? ' (پس از تلاش دوباره)' : ''}`)
        continue
      }
    }

    if (!response.ok) {
      attempts.push(`${hostLabel(endpoint)}: ${describeOutcome(null, response)}`)
      continue
    }

    return { json: await response.json(), endpoint, rateLimited: sawRateLimit, attempts }
  }

  const summary = attempts.join('، ')
  const error = new Error(`هیچ‌کدام از آدرس‌های Overpass API در دسترس نبودند: ${summary}`)
  error.rateLimited = sawRateLimit
  error.attempts = attempts
  throw error
}

function tagsToDescription(tags) {
  const parts = []
  if (tags.description) parts.push(tags.description)
  if (tags.shop) parts.push(`نوع ثبت‌شده: فروشگاه (${tags.shop})`)
  if (tags.craft) parts.push(`نوع ثبت‌شده: کارگاه تولیدی (${tags.craft})`)
  if (tags.man_made) parts.push(`نوع ثبت‌شده: ${tags.man_made}`)
  if (tags.office) parts.push(`نوع ثبت‌شده: دفتر (${tags.office})`)
  return parts.join(' - ')
}

function buildAddress(tags) {
  return [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join('، ') || null
}

export const osmOverpassAdapter = {
  sourceType: 'public_directory',

  async discover(source) {
    const config = source?.config || {}
    const configError = validateConfig(config)
    if (configError) throw new Error(configError)

    const keywords = Array.isArray(config.keywords) && config.keywords.length ? config.keywords : DEFAULT_KEYWORDS
    const countryCode = config.countryCode || DEFAULT_COUNTRY_CODE
    const limit = Number.isFinite(config.limit) ? config.limit : DEFAULT_LIMIT
    const endpoints = resolveEndpoints(config)

    if (keywords.length === 0) {
      throw new Error('پیکربندی منبع OSM ناقص است: هیچ کلیدواژه‌ای تعریف نشده است.')
    }

    const { json, endpoint, attempts } = await postOverpassQuery(buildDiscoverQuery({ keywords, countryCode, limit }), {
      endpoints,
      timeoutMs: DISCOVER_FETCH_TIMEOUT_MS,
      allowRetryAfter: true,
      retryAfterCapMs: REASONABLE_RETRY_AFTER_CAP_MS,
    })
    if (attempts.length > 0) {
      console.warn(`prospect-discovery/osmOverpass: succeeded via ${endpoint} after failover (${attempts.join('، ')})`)
    }
    return (json?.elements || []).filter((el) => el?.tags?.name)
  },

  normalize(rawItem) {
    const tags = rawItem.tags || {}
    const name = tags.name
    const phoneRaw = tags.phone || tags['contact:phone'] || ''
    const contacts = extractContactNumbers(phoneRaw)
    const website = tags.website || tags['contact:website'] || null
    const email = normalizeEmail(tags.email || tags['contact:email'])

    return {
      canonical_name: cleanCompanyName(name),
      raw_name: name,
      normalized_name_key: normalizedNameKey(name),
      website,
      domain: extractDomain(website) || extractDomain(email),
      phone: contacts.phone,
      mobile: contacts.mobile,
      email,
      province: null,
      city: tags['addr:city'] || null,
      address: buildAddress(tags),
      industry_guess: tags.shop || tags.craft || tags.man_made || tags.office || null,
      business_description: tagsToDescription(tags),
      source_url: `https://www.openstreetmap.org/${rawItem.type}/${rawItem.id}`,
      source_external_id: `${rawItem.type}/${rawItem.id}`,
      raw_data: rawItem,
    }
  },

  // Deliberately NOT the same query discover() runs - a tiny `out count`
  // query, cheap enough to call often without contributing to any
  // provider's rate limiting on its own. Never waits on a 429 - a health
  // probe that itself sits idle for 30s defeats its own purpose - it just
  // fails over to the next mirror immediately.
  async healthCheck(source) {
    const config = source?.config || {}
    const configError = validateConfig(config)
    if (configError) {
      return { ok: false, status: 'config_error', message: configError }
    }
    const endpoints = resolveEndpoints(config)

    try {
      const { endpoint, rateLimited, attempts } = await postOverpassQuery(HEALTH_CHECK_QUERY, {
        endpoints,
        timeoutMs: HEALTH_CHECK_FETCH_TIMEOUT_MS,
        allowRetryAfter: false,
      })
      if (rateLimited) {
        const suffix = attempts.length > 0 ? ` (${attempts.join('، ')})` : ''
        return {
          ok: false,
          status: 'degraded',
          message: `منبع در دسترس است اما با محدودیت نرخ درخواست مواجه شد (نهایتاً از ${endpoint} پاسخ گرفته شد)${suffix}.`,
        }
      }
      return { ok: true, status: 'healthy', message: `Overpass API در دسترس است (${endpoint}).` }
    } catch (err) {
      if (err.rateLimited) {
        return {
          ok: false,
          status: 'degraded',
          message: `همه آدرس‌های پیکربندی‌شده در حال حاضر محدودیت نرخ درخواست (429) دارند - بعداً دوباره تلاش کنید: ${(err.attempts || []).join('، ')}`,
        }
      }
      return { ok: false, status: 'unavailable', message: `Overpass API در دسترس نیست: ${err.message}` }
    }
  },
}

export const __testing = { DEFAULT_ENDPOINTS }
