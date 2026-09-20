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
//   - a 429 is a TRANSIENT/degraded provider state, never a hard failure:
//     the FIRST 429 seen across the whole attempt sequence honors
//     Retry-After (capped, so a misbehaving provider can never stall the
//     whole run) or waits ~30s, then retries that same endpoint exactly
//     once - never more than one retry, never a tight loop. If a LATER
//     endpoint also 429s, no further waiting happens - we just move on
//     (the retry budget is spent once per discover()/healthCheck() call).
//   - every request carries a descriptive User-Agent, per Overpass's own
//     usage expectations.
//   - all configured keywords are combined into ONE regex alternation in
//     ONE query - never one HTTP request per keyword.
//   - requests are always sequential, never Promise.all'd in parallel -
//     this is shared public infrastructure, not ours to hammer.
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const DEFAULT_KEYWORDS = ['پلاستیک', 'پلیمر', 'مستربچ']
const DEFAULT_COUNTRY_CODE = 'IR'
const DEFAULT_LIMIT = 80
const OVERPASS_TIMEOUT_SECONDS = 25
const DISCOVER_FETCH_TIMEOUT_MS = 20000
const HEALTH_CHECK_FETCH_TIMEOUT_MS = 8000
// Retry-After is honored but always capped - a provider asking for an
// unreasonably long wait must never be allowed to stall the whole
// discovery run (which has its own, much larger, set of other sources
// still waiting their turn).
const RATE_LIMIT_WAIT_CAP_MS = 30000
const DEFAULT_RATE_LIMIT_WAIT_MS = 30000
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

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null
  const seconds = Number(headerValue)
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, RATE_LIMIT_WAIT_CAP_MS)
  const dateMs = Date.parse(headerValue)
  if (!Number.isNaN(dateMs)) {
    const diffMs = dateMs - Date.now()
    return diffMs > 0 ? Math.min(diffMs, RATE_LIMIT_WAIT_CAP_MS) : 0
  }
  return null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`درخواست به ${url} بیش از ${timeoutMs} میلی‌ثانیه طول کشید.`)), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
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

// Sequential (never parallel) attempt across the endpoint pool. Returns
// { json, endpoint, rateLimited } on success; throws an Error with a
// `.rateLimited` flag set when every endpoint that responded did so with
// 429 (as opposed to being simply unreachable/erroring).
async function postOverpassQuery(query, { endpoints, timeoutMs }) {
  let lastError = null
  let sawRateLimit = false
  let usedRetryBudget = false

  for (const endpoint of endpoints) {
    try {
      let response = await postOnce(endpoint, query, timeoutMs)

      if (response.status === 429) {
        sawRateLimit = true
        if (!usedRetryBudget) {
          usedRetryBudget = true
          const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After')) ?? DEFAULT_RATE_LIMIT_WAIT_MS
          await sleep(retryAfterMs)
          response = await postOnce(endpoint, query, timeoutMs)
          if (response.status === 429) sawRateLimit = true
        }
      }

      if (response.status === 429) {
        lastError = new Error(`منبع Overpass (${endpoint}) در وضعیت محدودیت نرخ درخواست (429) قرار دارد.`)
        continue
      }
      if (!response.ok) {
        lastError = new Error(`Overpass API (${endpoint}) پاسخ ${response.status} داد.`)
        continue
      }

      return { json: await response.json(), endpoint, rateLimited: sawRateLimit }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  const error = lastError || new Error('هیچ‌کدام از آدرس‌های Overpass API در دسترس نبودند.')
  error.rateLimited = sawRateLimit
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

    const { json } = await postOverpassQuery(buildDiscoverQuery({ keywords, countryCode, limit }), {
      endpoints,
      timeoutMs: DISCOVER_FETCH_TIMEOUT_MS,
    })
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
  // provider's rate limiting on its own.
  async healthCheck(source) {
    const config = source?.config || {}
    const configError = validateConfig(config)
    if (configError) {
      return { ok: false, status: 'config_error', message: configError }
    }
    const endpoints = resolveEndpoints(config)

    try {
      const { endpoint, rateLimited } = await postOverpassQuery(HEALTH_CHECK_QUERY, {
        endpoints,
        timeoutMs: HEALTH_CHECK_FETCH_TIMEOUT_MS,
      })
      if (rateLimited) {
        return {
          ok: false,
          status: 'degraded',
          message: `منبع در دسترس است اما با محدودیت نرخ درخواست مواجه شد (نهایتاً از ${endpoint} پاسخ گرفته شد).`,
        }
      }
      return { ok: true, status: 'healthy', message: `Overpass API در دسترس است (${endpoint}).` }
    } catch (err) {
      if (err.rateLimited) {
        return {
          ok: false,
          status: 'degraded',
          message: 'همه آدرس‌های پیکربندی‌شده در حال حاضر محدودیت نرخ درخواست (429) دارند - بعداً دوباره تلاش کنید.',
        }
      }
      return { ok: false, status: 'unavailable', message: `Overpass API در دسترس نیست: ${err.message}` }
    }
  },
}
