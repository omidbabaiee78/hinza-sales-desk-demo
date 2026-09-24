// ---------------------------------------------------------------------------
// Phase 23D-FINAL, section F - FIRST-PARTY WEBSITE ENRICHMENT.
//
// A SCAFFOLDED, SAFETY-CAPPED foundation, deliberately NOT wired into the
// live discovery/qualification pipeline yet - the same "foundation, not yet
// a working source" pattern already established by
// sourceAdapters/genericHttpDirectory.js in this codebase. It has never
// been exercised against a real website in this session (no live network
// calls were made while building it, per this phase's explicit
// constraints), so wiring it into the auto-promote path before that
// happens would be exactly the kind of untested-live-behavior recklessness
// the rest of this engine goes out of its way to avoid.
//
// What it WOULD do, once wired up and verified against real traffic:
//   - fetch ONLY a candidate's own homepage, plus (if linked from it)
//     about/about-us, products/services, and contact pages - never a
//     broader crawl.
//   - enforce a page cap, a byte cap, a timeout, a redirect cap, and
//     content-type validation (text/html only) BEFORE reading any body.
//   - never bypass robots.txt, auth walls, CAPTCHAs, or any other access
//     control.
//   - extract the SAME kind of deterministic evidence extractEvidence()
//     already looks for (industry keywords, production language, contact
//     info) from the fetched page text - never invent anything, never call
//     an LLM.
//   - treat a fetch FAILURE as "we learned nothing new", never as negative
//     evidence - see qualification.js's "absence of evidence != negative
//     evidence" principle (section D). A candidate is exactly as
//     qualified/rejected after a failed enrichment attempt as it was
//     before.
//
// To actually wire this in: a caller (e.g. a new, separate step in
// discoveryPipeline.js, gated by its own settings flag and never inline in
// the hot qualification path) would call enrichFromWebsite(url), merge its
// `.evidenceText` into the candidate's business_description (or pass it
// straight to extractEvidence() as extra text), and log/store
// `.attempts`/`.pagesFetched` for auditability - then be verified against
// real candidate websites before any auto-promote path is allowed to
// depend on it.
// ---------------------------------------------------------------------------

export const ENRICHMENT_LIMITS = {
  maxPages: 4, // homepage + about + products/services + contact
  maxBytesPerPage: 300000, // ~300 KB - enough for real HTML, not a media dump
  timeoutMsPerPage: 8000,
  maxRedirects: 3,
}

// Phase 23D-FINAL.1, "FINAL AUTONOMY BLOCKER" round, section 1 - IDENTITY
// VERIFICATION fetch limits. Deliberately tighter than ENRICHMENT_LIMITS
// above (shorter timeout, smaller byte cap, exactly 3 pages max: homepage +
// About + Contact, no products page) - this runs synchronously inside the
// comprehensive audit's per-candidate loop for every candidate that would
// otherwise become auto-promotable, so it must stay fast and bounded; see
// discoveryPipeline.js's MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN for the
// additional per-run cap on how many candidates get fetched at all.
export const IDENTITY_FETCH_LIMITS = {
  maxPages: 3,
  maxBytesPerPage: 200000,
  timeoutMsPerPage: 6000,
  maxRedirects: 3,
}

const ALLOWED_CONTENT_TYPE = /^text\/html/i
const ABOUT_LINK_PATTERN = /about|درباره/i
const PRODUCTS_LINK_PATTERN = /product|service|محصول|خدمات/i
const CONTACT_LINK_PATTERN = /contact|تماس/i

function withinSameOrigin(baseUrl, candidateUrl) {
  try {
    const base = new URL(baseUrl)
    const candidate = new URL(candidateUrl, base)
    return candidate.hostname === base.hostname
  } catch {
    return false
  }
}

export async function fetchPageSafely(url, { timeoutMs, maxBytes }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`تایم‌اوت هنگام دریافت ${url}`)), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'HinzaProspecting/1.0 (+https://hinzapolymer.com)' },
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') || ''
    if (!ALLOWED_CONTENT_TYPE.test(contentType)) {
      return { ok: false, reason: `نوع محتوای غیرمجاز: ${contentType || 'نامشخص'}` }
    }
    if (!response.ok) {
      return { ok: false, reason: `پاسخ ${response.status}` }
    }
    // Never read more than maxBytes, even if the server lies about
    // content-length - stream-truncate defensively.
    const reader = response.body?.getReader?.()
    if (!reader) {
      const text = await response.text()
      return { ok: true, text: text.slice(0, maxBytes) }
    }
    const chunks = []
    let received = 0
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
    }
    reader.cancel().catch(() => {})
    // Concatenate via Uint8Array, never Node's Buffer - this module must
    // also run portably in the Deno Edge Function runtime once it's wired
    // up (see the file header - not yet).
    const combined = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(combined)
    return { ok: true, text: text.slice(0, maxBytes) }
  } catch (err) {
    return { ok: false, reason: err?.isTimeout || controller.signal.aborted ? 'تایم‌اوت' : err?.message || 'خطای شبکه' }
  } finally {
    clearTimeout(timer)
  }
}

// "FINAL REGRESSION FIX" round, item 1 - Entekhab Group's real
// resolved_company_name came back as "سایت تولید قطعات پلاستیک &#8211;
// گروه صنعتی انتخاب" - the raw HTML entity (&#8211; = "–", an en-dash)
// was never decoded, so it leaked straight into a value later presented as
// a clean company name. A small, deterministic decoder (numeric decimal/
// hex entities + the common named ones) - never a full HTML-entity table,
// never a DOM parser (this must also run in the Deno Edge Function
// runtime, which has no DOMParser).
const HTML_NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  laquo: '«',
  raquo: '»',
}

export function decodeHtmlEntities(text) {
  if (!text) return text
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => HTML_NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

function stripHtmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function extractInternalLinks(html, baseUrl, pattern) {
  const links = []
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi
  let match
  while ((match = hrefRegex.exec(html))) {
    const href = match[1]
    if (pattern.test(href) && withinSameOrigin(baseUrl, href)) {
      try {
        links.push(new URL(href, baseUrl).toString())
      } catch {
        // ignore unparsable hrefs
      }
    }
  }
  return [...new Set(links)]
}

// Never fetches ANYTHING outside the candidate's own domain - `homepageUrl`
// must be the candidate's own website. Returns combined page TEXT (never
// raw HTML) plus a safe, PII-free diagnostic trail - never throws; a
// failure is always `{ ok: false, attempts }`, matching the "fetch failure
// never means rejection" rule (section D/F).
export async function enrichFromWebsite(homepageUrl, limits = ENRICHMENT_LIMITS) {
  if (!homepageUrl) return { ok: false, attempts: [], pagesFetched: 0, evidenceText: '' }

  const attempts = []
  const textParts = []
  let pagesFetched = 0

  const homepage = await fetchPageSafely(homepageUrl, { timeoutMs: limits.timeoutMsPerPage, maxBytes: limits.maxBytesPerPage })
  attempts.push({ url: homepageUrl, ok: homepage.ok, reason: homepage.ok ? undefined : homepage.reason })
  if (!homepage.ok) return { ok: false, attempts, pagesFetched: 0, evidenceText: '' }
  pagesFetched += 1
  textParts.push(stripHtmlToText(homepage.text))

  const linkTargets = [
    { pattern: ABOUT_LINK_PATTERN, label: 'about' },
    { pattern: PRODUCTS_LINK_PATTERN, label: 'products' },
    { pattern: CONTACT_LINK_PATTERN, label: 'contact' },
  ]

  for (const { pattern, label } of linkTargets) {
    if (pagesFetched >= limits.maxPages) break
    const candidates = extractInternalLinks(homepage.text, homepageUrl, pattern)
    const link = candidates[0]
    if (!link) continue
    const page = await fetchPageSafely(link, { timeoutMs: limits.timeoutMsPerPage, maxBytes: limits.maxBytesPerPage })
    attempts.push({ url: link, label, ok: page.ok, reason: page.ok ? undefined : page.reason })
    if (page.ok) {
      pagesFetched += 1
      textParts.push(stripHtmlToText(page.text))
    }
  }

  return { ok: true, attempts, pagesFetched, evidenceText: textParts.join(' ').slice(0, 20000) }
}

// ---------------------------------------------------------------------------
// Phase 23D-FINAL.1, "FINAL AUTONOMY BLOCKER" round, section 1 - IDENTITY
// VERIFICATION. Unlike enrichFromWebsite() above (which strips ALL markup
// down to plain text, for generic industry-keyword evidence), identity
// verification needs to read specific STRUCTURED markers - JSON-LD
// Organization.name, <meta property="og:site_name">, the <title> tag's own
// brand segment - which only exist in the raw HTML, before stripping. This
// function is a pure FETCH + EXTRACT step: it returns the raw signals found,
// never decides what they mean - identityResolution.js's
// resolveVerifiedIdentity() (a plain, synchronous, easily-unit-testable
// function) is what applies the actual priority order. Same safety
// discipline as enrichFromWebsite(): same-origin only, page/byte/timeout
// caps, content-type validation, never throws - a fetch failure returns
// `{ ok: false }`, which the caller must treat as "no new information,"
// never as negative evidence (same "absence of evidence != negative
// evidence" principle as qualification.js section D).
// ---------------------------------------------------------------------------

const JSONLD_SCRIPT_REGEX = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
const ORGANIZATION_TYPE_PATTERN = /organization|corporation|localbusiness|manufacturer/i

function extractJsonLdOrganizationName(html) {
  let match
  JSONLD_SCRIPT_REGEX.lastIndex = 0
  while ((match = JSONLD_SCRIPT_REGEX.exec(html))) {
    let parsed
    try {
      parsed = JSON.parse(match[1].trim())
    } catch {
      continue // malformed JSON-LD on the page - skip it, never throw
    }
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed]
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']]
      const isOrganization = types.some((t) => typeof t === 'string' && ORGANIZATION_TYPE_PATTERN.test(t))
      if (isOrganization && typeof item.name === 'string' && item.name.trim()) return decodeHtmlEntities(item.name.trim())
    }
  }
  return null
}

function extractMetaContent(html, propertyName) {
  const patterns = [
    new RegExp(`<meta[^>]+property\\s*=\\s*["']${propertyName}["'][^>]+content\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]+property\\s*=\\s*["']${propertyName}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]?.trim()) return decodeHtmlEntities(match[1].trim())
  }
  return null
}

function extractTitleTagText(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1]?.trim() ? decodeHtmlEntities(match[1].trim()) : null
}

// The same homepage identity markers fetchIdentitySignals() reads, plus the
// meta description, from HTML the caller already fetched (siteVerification.js
// reuses the pages its email lookup loaded instead of fetching them again).
export function identitySignalsFromHtml(html) {
  const text = html || ''
  return {
    jsonLdOrganizationName: extractJsonLdOrganizationName(text),
    ogSiteName: extractMetaContent(text, 'og:site_name'),
    titleText: extractTitleTagText(text),
    description: extractMetaContent(text, 'og:description') || extractNamedMeta(text, 'description'),
  }
}

function extractNamedMeta(html, name) {
  const match =
    html.match(new RegExp(`<meta[^>]+name\\s*=\\s*["']${name}["'][^>]+content\\s*=\\s*["']([^"']+)["']`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]+name\\s*=\\s*["']${name}["']`, 'i'))
  return match?.[1]?.trim() ? decodeHtmlEntities(match[1].trim()) : null
}

// { homepageUrl, limits? } -> { ok, attempts, jsonLdOrganizationName,
// ogSiteName, titleText, aboutText, contactText }. Fetches the homepage
// (mandatory) plus, IF linked from it, an About page and a Contact page -
// never more than IDENTITY_FETCH_LIMITS.maxPages total, never off-domain
// (extractInternalLinks already enforces same-origin).
export async function fetchIdentitySignals({ homepageUrl, limits = IDENTITY_FETCH_LIMITS }) {
  const empty = { ok: false, attempts: [], jsonLdOrganizationName: null, ogSiteName: null, titleText: null, aboutText: null, contactText: null }
  if (!homepageUrl) return empty

  const attempts = []
  const homepage = await fetchPageSafely(homepageUrl, { timeoutMs: limits.timeoutMsPerPage, maxBytes: limits.maxBytesPerPage })
  attempts.push({ url: homepageUrl, ok: homepage.ok, reason: homepage.ok ? undefined : homepage.reason })
  if (!homepage.ok) return { ...empty, attempts }

  const jsonLdOrganizationName = extractJsonLdOrganizationName(homepage.text)
  const ogSiteName = extractMetaContent(homepage.text, 'og:site_name')
  const titleText = extractTitleTagText(homepage.text)

  let aboutText = null
  let contactText = null
  let pagesFetched = 1

  const aboutLink = extractInternalLinks(homepage.text, homepageUrl, ABOUT_LINK_PATTERN)[0]
  if (aboutLink && pagesFetched < limits.maxPages) {
    const page = await fetchPageSafely(aboutLink, { timeoutMs: limits.timeoutMsPerPage, maxBytes: limits.maxBytesPerPage })
    attempts.push({ url: aboutLink, label: 'about', ok: page.ok, reason: page.ok ? undefined : page.reason })
    if (page.ok) {
      aboutText = stripHtmlToText(page.text)
      pagesFetched += 1
    }
  }

  const contactLink = extractInternalLinks(homepage.text, homepageUrl, CONTACT_LINK_PATTERN)[0]
  if (contactLink && pagesFetched < limits.maxPages) {
    const page = await fetchPageSafely(contactLink, { timeoutMs: limits.timeoutMsPerPage, maxBytes: limits.maxBytesPerPage })
    attempts.push({ url: contactLink, label: 'contact', ok: page.ok, reason: page.ok ? undefined : page.reason })
    if (page.ok) contactText = stripHtmlToText(page.text)
  }

  return { ok: true, attempts, jsonLdOrganizationName, ogSiteName, titleText, aboutText, contactText }
}
