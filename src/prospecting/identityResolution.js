import { isNonCompanyEntityType } from './entityClassification.js'
import { resolveCompanySelfIdentity } from './textMatching.js'
import { normalizeSearchText } from './normalization.js'

// ---------------------------------------------------------------------------
// Phase 23D-FINAL.1 (sections 5/6/7), hardened further in the same phase's
// "FINAL AUTONOMY BLOCKER" round - SITE OWNER IDENTITY, separate from PAGE
// TYPE. entity_type (entityClassification.js) already answers "what KIND of
// page is this" - this module answers the SEPARATE question "what is this
// page's own COMPANY NAME, and how sure are we."
//
// The first version of this module treated a title/snippet self-declaration
// ("X، تولیدکننده Y") as good enough, on its own, to unlock auto-promotion.
// Production auditing showed that was too permissive: a Serper snippet's own
// wording can still just be echoing a PRODUCT/PAGE title
// ("فیلم پلی اتیلن", "تولید پریفرم پت و تولید پریفرم قم") that happens to
// loosely match the self-ID regex, or can be genuinely ambiguous. Real
// verification now requires visiting the candidate's OWN website (see
// websiteEnrichment.js's fetchIdentitySignals()) and checking, in priority
// order, for a structured/explicit self-declaration:
//   1. JSON-LD Organization.name
//   2. og:site_name
//   3. homepage <title> brand segment
//   4. About-page explicit self-declaration
//   5. Contact-page explicit self-declaration
//   6. (folded into #3/#1-2 above) a strong domain/brand match - used to
//      pick the RIGHT <title> segment when there are several, not a
//      separate identity_source of its own (see extractHomepageBrand below)
//   7. the existing baseline identity (OSM/raw_title/self_declared/...) -
//      the final fallback when nothing on the live page confirms anything
//      new; never WORSE than before a failed/inconclusive fetch.
//
// identity_status is now the primary decision signal (never a bare
// true/false "resolved"):
//   - verified: JSON-LD Organization.name, og:site_name, a first-party
//     structured source (OSM tags), or a raw admin-provided/API record - the
//     entity effectively declared its own name in a structured, hard-to-fake
//     way.
//   - probable: extracted from real page text (homepage <title> brand,
//     About/Contact page self-declaration) - first-party, but a heuristic
//     extraction, not a structured declaration.
//   - unresolved: a bare domain-label fallback, or nothing found at all.
// Auto-promotion (qualification.js's isPromotableIdentity()) requires
// verified OR a "strong" probable source (title/about/contact/structured/
// raw_title) - a bare title/snippet self-declaration that was NEVER checked
// against the actual website (self_declared) does not qualify by itself.
// ---------------------------------------------------------------------------

export const IDENTITY_STATUS = {
  VERIFIED: 'verified',
  PROBABLE: 'probable',
  UNRESOLVED: 'unresolved',
}

export const IDENTITY_SOURCES = {
  JSONLD_ORGANIZATION: 'jsonld_organization',
  OG_SITE_NAME: 'og_site_name',
  HOMEPAGE_BRAND: 'homepage_brand',
  ABOUT_PAGE: 'about_page',
  CONTACT_PAGE: 'contact_page',
  STRUCTURED_SOURCE: 'structured_source', // OSM tags.name or similar first-party structured data
  RAW_TITLE: 'raw_title', // uploaded_dataset/custom_api - the name IS the record by construction
  SELF_DECLARED: 'self_declared', // title/snippet self-ID - a HINT only, never sufficient alone to auto-promote
  DOMAIN_FALLBACK: 'domain_fallback', // no self-ID found - fell back to the bare domain label
  NOT_APPLICABLE: 'not_applicable', // a non-company page (article/directory/...) - no identity to resolve
  UNRESOLVED: 'unresolved',
}

// Sources strong enough that, at PROBABLE status, still count toward
// "verified OR strong probable" for auto-promotion. self_declared and
// domain_fallback are deliberately excluded - an unverified search-snippet
// guess or a bare domain label is exactly what production auditing showed
// was too weak to safely name a real sales_leads row after.
const STRONG_IDENTITY_SOURCES = new Set([
  IDENTITY_SOURCES.JSONLD_ORGANIZATION,
  IDENTITY_SOURCES.OG_SITE_NAME,
  IDENTITY_SOURCES.HOMEPAGE_BRAND,
  IDENTITY_SOURCES.ABOUT_PAGE,
  IDENTITY_SOURCES.CONTACT_PAGE,
  IDENTITY_SOURCES.STRUCTURED_SOURCE,
  IDENTITY_SOURCES.RAW_TITLE,
])

// No exceptions (section 6/"FINAL AUTONOMY BLOCKER" section 2, extended by
// the "FINAL REGRESSION FIX" round's isPlausibleOrganizationName check
// below): the ONE gate every auto-promote path must call instead of
// re-deriving its own "is this identity good enough" logic. Applied here
// (not just as a report-time invariant) so a live discovery/re-evaluation
// run - not only the read-only audit - is ALSO protected the moment
// cron/autonomy is eventually turned on.
export function isPromotableIdentity(identity) {
  if (!identity?.resolvedName) return false
  if (!isPlausibleOrganizationName(identity.resolvedName)) return false
  if (identity.status === IDENTITY_STATUS.VERIFIED) return true
  if (identity.status === IDENTITY_STATUS.PROBABLE) return STRONG_IDENTITY_SOURCES.has(identity.source)
  return false
}

function domainLabelOf(domain) {
  if (!domain) return null
  return domain.split('.')[0].replace(/[-_]/g, ' ').trim().toLowerCase()
}

function normalizeForLatinCompare(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// "FINAL REGRESSION FIX" round, item 1 - a real production result showed
// resolved_company_name = "سایت تولید قطعات پلاستیک – گروه صنعتی انتخاب"
// (an HTML-entity-undecoded PAGE TITLE, not a clean organization name).
// This is the independent, general safety net: a name that reads like a
// generic page/product/article description ("سایت تولید...", "تولید...",
// "محصول...", "خط تولید...", "کارخانه تولید...") is never accepted as a
// final resolved company name, REGARDLESS of which extraction path
// produced it - see resolveVerifiedIdentity() below (which also tries the
// NEXT priority tier instead of stopping on an implausible name) and
// discoveryPipeline.js's detectConflicts() (which hard-blocks
// autoPromotable if this is somehow still violated - "no exceptions").
// Deliberately NO trailing \b - it is ASCII-only ([A-Za-z0-9_]) and
// silently never matches around Persian/Arabic letters at all (the exact
// same gotcha already documented on textMatching.js's COMPANY_SELF_ID_
// PATTERNS and normalization.js's normalizedNameKey()).
const GENERIC_TITLE_PREFIX_PATTERN =
  /^(سایت\s*تولید|تولید\s*کننده|تولیدکننده|تولید|محصول(ات)?|خط\s*تولید|کارخانه\s*تولید|فروش|خرید|قیمت|صفحه\s*اصلی|درباره(\s*ما)?|معرفی|وب\s*سایت|وبسایت|خانه|لیست|فهرست|بهترین|برترین|راهنمای|عرضه|انواع|فروشگاه|ارائه\s*دهنده)/

export function isPlausibleOrganizationName(name) {
  if (!name) return false
  const trimmed = name.trim()
  if (trimmed.length < 2) return false
  return !GENERIC_TITLE_PREFIX_PATTERN.test(normalizeSearchText(trimmed))
}

// { canonical_name, raw_name, domain, raw_data, ... } - a full candidate
// row, plus its already-computed entityType (matchedEntityType(evidence),
// passed in so this never re-classifies from scratch). This is the BASELINE
// pass - reads only fields already persisted on the candidate row (no live
// fetch); see resolveVerifiedIdentity() below for the live-website upgrade
// path.
export function resolveIdentity(candidate, entityType) {
  if (isNonCompanyEntityType(entityType)) {
    return { resolvedName: null, source: IDENTITY_SOURCES.NOT_APPLICABLE, status: IDENTITY_STATUS.UNRESOLVED }
  }
  if (!candidate.canonical_name) {
    return { resolvedName: null, source: IDENTITY_SOURCES.UNRESOLVED, status: IDENTITY_STATUS.UNRESOLVED }
  }

  const rawData = candidate.raw_data
  const isOsmShaped = rawData && typeof rawData === 'object' && rawData.tags && typeof rawData.tags === 'object'
  const isSerperShaped = rawData && typeof rawData === 'object' && typeof rawData.link === 'string'

  if (isOsmShaped) {
    // A real, named OSM node IS the entity by construction - structured,
    // first-party identity evidence, not a guess. Section 4 ("FINAL
    // AUTONOMY BLOCKER"): stays VERIFIED - structured OSM company names may
    // remain high-confidence identity when the record itself clearly
    // identifies a named industrial entity.
    return { resolvedName: candidate.canonical_name, source: IDENTITY_SOURCES.STRUCTURED_SOURCE, status: IDENTITY_STATUS.VERIFIED }
  }
  if (!isSerperShaped) {
    // uploaded_dataset / custom_api - an admin-provided or structured row;
    // the name field IS the entity, not extracted from a headline.
    return { resolvedName: candidate.canonical_name, source: IDENTITY_SOURCES.RAW_TITLE, status: IDENTITY_STATUS.VERIFIED }
  }

  // Serper: did normalize() extract something beyond a bare domain-derived
  // label? Compare against what THAT fallback would have produced.
  const domainLabel = domainLabelOf(candidate.domain)
  if (domainLabel && candidate.canonical_name.trim().toLowerCase() === domainLabel) {
    return { resolvedName: candidate.canonical_name, source: IDENTITY_SOURCES.DOMAIN_FALLBACK, status: IDENTITY_STATUS.UNRESOLVED }
  }
  // A title/snippet self-declaration - a real hint, but per the "FINAL
  // AUTONOMY BLOCKER" fix, never enough on its own to auto-promote (see
  // isPromotableIdentity above). qualifyCandidate()'s caller
  // (discoveryPipeline.js) is what decides whether to attempt a live
  // website verification pass to try to upgrade this.
  return { resolvedName: candidate.canonical_name, source: IDENTITY_SOURCES.SELF_DECLARED, status: IDENTITY_STATUS.PROBABLE }
}

// Picks the most likely BRAND segment out of a homepage's <title> text - a
// real <title> is very often "Company Name | تگ‌لاین" or "Company Name -
// صفحه اصلی"; the segment before the first separator is almost always the
// brand (the same heuristic serperSearch.js's guessCompanyName() already
// uses for a search-result title, reused here for a fetched page's own
// <title>). When the domain's own label appears (in Latin characters) as a
// close match inside one of the segments - common for Iranian industrial
// sites that print an English/Latin brand name somewhere even on an
// otherwise-Persian page - that segment is preferred instead, since it is a
// stronger cross-check that the segment really is this SITE's own name, not
// just "whatever came first" (spec's priority item 6: a strong domain/brand
// match).
function extractHomepageBrand(titleText, domain) {
  if (!titleText) return null
  const parts = titleText
    .split(/[|\-–—:•·»«]/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const domainLabel = normalizeForLatinCompare(domainLabelOf(domain))
  if (domainLabel && domainLabel.length >= 3) {
    const brandMatch = parts.find((part) => {
      const normalizedPart = normalizeForLatinCompare(part)
      return normalizedPart.length >= 3 && (normalizedPart.includes(domainLabel) || domainLabel.includes(normalizedPart))
    })
    if (brandMatch) return brandMatch
  }

  // "FINAL REGRESSION FIX" round, item 1 - a <title> is not always "Brand |
  // tagline" (brand first); it is JUST as often a CMS default "Page
  // Description – Site Name" (brand LAST, e.g. Entekhab Group's real
  // "سایت تولید قطعات پلاستیک – گروه صنعتی انتخاب"). Instead of always
  // guessing the first segment, filter out segments that read like a
  // generic page/product description and prefer whichever segment(s)
  // remain - if that leaves exactly one candidate, it is almost certainly
  // the real site name, regardless of position.
  const plausibleParts = parts.filter((part) => isPlausibleOrganizationName(part))
  if (plausibleParts.length === 1) return plausibleParts[0]

  const first = parts[0]
  return first.length >= 2 && first.length <= 80 ? first : null
}

// The LIVE-WEBSITE identity upgrade - pure decision logic over already-
// fetched signals (see websiteEnrichment.js's fetchIdentitySignals() for the
// actual network call; this function never fetches anything itself, which
// is what keeps it deterministic and unit-testable with plain fixture
// objects). `baseline` is this candidate's resolveIdentity() result -
// returned unchanged as the final fallback when nothing on the live page
// confirms anything new (a fetch failure/inconclusive page is NEVER treated
// as worse than not having fetched at all).
export function resolveVerifiedIdentity({ domain, signals, baseline }) {
  const { jsonLdOrganizationName, ogSiteName, titleText, aboutText, contactText } = signals || {}

  // "FINAL REGRESSION FIX" round, item 1 - an implausible/generic name at
  // ANY tier is never accepted as final; it falls through to the NEXT
  // priority tier instead of stopping here, so a sloppy/generic JSON-LD or
  // og:site_name value can still be rescued by a cleaner signal further
  // down (and, failing all of them, by the invariant check in
  // discoveryPipeline.js as the last-resort safety net).
  if (jsonLdOrganizationName && isPlausibleOrganizationName(jsonLdOrganizationName)) {
    return { resolvedName: jsonLdOrganizationName, source: IDENTITY_SOURCES.JSONLD_ORGANIZATION, status: IDENTITY_STATUS.VERIFIED }
  }
  if (ogSiteName && isPlausibleOrganizationName(ogSiteName)) {
    return { resolvedName: ogSiteName, source: IDENTITY_SOURCES.OG_SITE_NAME, status: IDENTITY_STATUS.VERIFIED }
  }
  const homepageBrand = extractHomepageBrand(titleText, domain)
  if (homepageBrand && isPlausibleOrganizationName(homepageBrand)) {
    return { resolvedName: homepageBrand, source: IDENTITY_SOURCES.HOMEPAGE_BRAND, status: IDENTITY_STATUS.PROBABLE }
  }
  const aboutSelfId = aboutText ? resolveCompanySelfIdentity(aboutText) : null
  if (aboutSelfId && isPlausibleOrganizationName(aboutSelfId)) {
    return { resolvedName: aboutSelfId, source: IDENTITY_SOURCES.ABOUT_PAGE, status: IDENTITY_STATUS.PROBABLE }
  }
  const contactSelfId = contactText ? resolveCompanySelfIdentity(contactText) : null
  if (contactSelfId && isPlausibleOrganizationName(contactSelfId)) {
    return { resolvedName: contactSelfId, source: IDENTITY_SOURCES.CONTACT_PAGE, status: IDENTITY_STATUS.PROBABLE }
  }
  if (baseline?.resolvedName) return baseline
  return { resolvedName: null, source: IDENTITY_SOURCES.UNRESOLVED, status: IDENTITY_STATUS.UNRESOLVED }
}
