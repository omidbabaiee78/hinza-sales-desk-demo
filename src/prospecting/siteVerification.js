import { fetchPageSafely, identitySignalsFromHtml } from './websiteEnrichment.js'
import { extractEvidence, matchedEntityType, matchedBuyerFit, matchedIdentity, matchedHasStrongNegative, replaceIdentityEvidence } from './evidenceEngine.js'
import { isNonCompanyEntityType } from './entityClassification.js'
import { scoreCandidate } from './scoringEngine.js'
import { qualifyCandidate } from './qualification.js'
import { isPromotableIdentity, isPlausibleOrganizationName, resolveVerifiedIdentity, IDENTITY_SOURCES } from './identityResolution.js'
import { normalizedNameKey, normalizeSearchText } from './normalization.js'
import { lookupCompanyEmail, LOOKUP_LIMITS, visibleText } from '../outreach/emailDiscovery.js'

// ---------------------------------------------------------------------------
// Reading a discovered company's OWN website before deciding on it.
//
// A search result is judged by default on Google's two-line title + snippet
// alone, which for most real manufacturers is too little text to score -
// production data showed them stuck at 42 (qualify bar 45) and never
// identity-verified, so they sat in manual_review with nobody reviewing
// them. This step loads the candidate's homepage and contact/about pages
// (the same pages, limits and address rules as the lead email lookup in
// outreach/emailDiscovery.js - one crawl serves both), then:
//   1. re-runs the SAME evidence/qualification engine with the site's own
//      title and description added to the snippet - which also catches the
//      disguised ones (a news site, a shop, a machinery vendor) that the
//      snippet alone called a company;
//   2. resolves the company's name from the site itself (JSON-LD,
//      og:site_name, homepage title - identityResolution.js), so the lead
//      is named after the company rather than a product page title;
//   3. takes any business email the site itself publishes.
// It promotes when the normal auto-promote rule passes OR when the site
// confirms the facts that make it a prospect: a direct company site, a
// polymer-product manufacturer (buyer fit "high": industry keyword +
// production language), no strong negative signal, and a real company
// name read from its own site. No score threshold and no human approval.
// Nothing is guessed: every value comes from pages the company published.
// ---------------------------------------------------------------------------

function originOf(url) {
  try {
    return `${new URL(url).origin}/`
  } catch {
    return null
  }
}

// A homepage title is often "Brand تولید کننده X و Y - Brand" - keep the
// brand: the part before a separator, then before a trailing activity
// phrase. Never adds anything that isn't in the site's own text.
export function tidyCompanyName(name) {
  // "Welcome To Tak Cable Works Co." -> "Tak Cable Works Co.";
  // "X. با بیش از پنجاه سال تجربه..." -> "X" (a sentence, not a name).
  const first = String(name || '')
    .replace(/^\s*welcome\s+to\s+/i, '')
    .split(/\s*[|،:]\s*|\s+[,–—-]\s+|\.\s+/)[0]
    .trim()
  const brand = first.split(/\s(?:تولید\s*کننده|تولیدکننده|تولید و|فروش|عرضه|واردکننده|نمایندگی)\s/)[0].trim()
  return brand.length >= 2 ? brand : first
}

function sharesPart(a, b, min = 4) {
  const x = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const y = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  for (let i = 0; i + min <= x.length; i += 1) if (y.includes(x.slice(i, i + min))) return true
  return false
}

export function isForeignLatinName(name, domain) {
  if (!name || /[^\x20-\x7e]/.test(name) || !domain) return false
  const label = domain.replace(/^www\./, '').split('.')[0]
  return !sharesPart(name, label) && !sharesPart(label, name)
}

const IRAN_SIGNAL = /[؀-ۿ]|\biran\b/i
// Production data: «ماشین های پلاستیک بادی پارس», «ارائه دهنده انواع
// دستگاه بسته بندی», "APS machine" - machine builders/sellers name the
// machines in their own title; a processor does not.
// Title only: a processor's DESCRIPTION may well mention its machines
// («با ۵ خط تولید»), and «قالب سازی و تزریق» is an injection moulder.
const MACHINERY_SELF_DESCRIPTION = /(ماشین|دستگاه|machine|machinery)/i
// «ثبت شغل» and similar business-registration / listing sites.
const LISTING_SELF_DESCRIPTION = /(ثبت شغل|ثبت مشاغل|ثبت کسب و کار|ثبت رایگان|دایرکتوری|راهنمای مشاغل)/
// «فروش انواع پلی اتیلن صنعتی» - a raw-polymer seller neither makes nor
// uses polymer products.
const RAW_MATERIAL_TRADER = /(فروش|عرضه|واردات|وارد کننده|پخش|بازرگانی)\s+(انواع\s+)?(مواد اولیه|گرانول|پلی اتیلن|پلی پروپیلن|پلیمر|پی وی سی|pvc)/i

// What the company's own homepage says about itself - never the search
// snippet, which can describe a company a portal merely lists:
//   - page type from its title/description (not an article, directory,
//     marketplace, social or video page),
//   - polymer evidence somewhere in its title, description or visible
//     homepage text (a portal's homepage is about news/ads, not polymer
//     products; a manufacturer's names its products),
//   - an Iranian signal: .ir domain, Persian text, or a mention of Iran.
export function siteOwnSignals({ candidate, signals, homepageText = '' }) {
  const title = [signals.jsonLdOrganizationName, signals.ogSiteName, signals.titleText].filter(Boolean).join(' ')
  const head = { ...candidate, raw_name: title, canonical_name: signals.ogSiteName || signals.titleText || '', business_description: signals.description || '', raw_data: null, source_url: candidate.website }
  const pageEvidence = extractEvidence(head)
  const bodyEvidence = extractEvidence({ ...head, business_description: [signals.description, homepageText].filter(Boolean).join(' ') })
  const text = [title, signals.description, homepageText].filter(Boolean).join(' ')
  const reasons = []
  if (isNonCompanyEntityType(matchedEntityType(pageEvidence))) reasons.push('site_not_company')
  if (!hasIndustryEvidence(pageEvidence) && !hasIndustryEvidence(bodyEvidence)) reasons.push('no_polymer_signal_on_site')
  if (!/\.ir$/i.test(candidate.domain || '') && !IRAN_SIGNAL.test(text)) reasons.push('not_iranian')
  // What the site says it IS, from its own name/title/description only (a
  // manufacturer's body text may well mention its machines or materials):
  const selfDescription = normalizeSearchText([title, signals.description].filter(Boolean).join(' '))
  if (MACHINERY_SELF_DESCRIPTION.test(normalizeSearchText(title))) reasons.push('machinery_seller')
  if (LISTING_SELF_DESCRIPTION.test(selfDescription)) reasons.push('listing_site')
  if (RAW_MATERIAL_TRADER.test(selfDescription)) reasons.push('raw_material_trader')
  return { ok: reasons.length === 0, reasons }
}

function hasIndustryEvidence(evidence) {
  return evidence.some(
    (e) => e.evidenceType === 'industry_keyword' || e.evidenceType === 'generic_manufacturing_signal' || e.evidenceType === 'structured_industrial_signal',
  )
}

// A usable company name for the lead: a plausible organization name the
// company's own site (or its search result) gives - never a product/page
// title (isPlausibleOrganizationName) and never a bare domain label.
const NO_NAME_SOURCES = new Set([IDENTITY_SOURCES.DOMAIN_FALLBACK, IDENTITY_SOURCES.NOT_APPLICABLE, IDENTITY_SOURCES.UNRESOLVED])

// The name must come from the site's OWN markers (isPromotableIdentity:
// JSON-LD, og:site_name, homepage title, about/contact page) - a name
// taken from a search snippet can belong to a company a portal merely
// lists (shahr24.com / parscenter.com listing «حباب باران»), and the
// site's contacts would then be attached to the wrong company.
export function hasUsableCompanyName(identity) {
  const name = identity?.resolvedName
  return (
    Boolean(name) &&
    !NO_NAME_SOURCES.has(identity.source) &&
    isPromotableIdentity(identity) &&
    isPlausibleOrganizationName(name) &&
    !/\.(com|ir|net|org|co|info|biz)\b/i.test(name)
  )
}

// Registration rule: a REASONABLE signal that this is a real company that
// makes or uses polymer products - no score threshold, no perfect product
// match, no email required (a lead without contacts stays registered and
// enrichment keeps looking). Required: its own company site (not an
// article, directory, marketplace, social or video page), some polymer
// evidence (buyer fit high = production wording, or medium = industry
// evidence without it), no strong negative signal, and a real company name.
// Still never registered: competitors (masterbatch/pigment producers, buyer
// fit low), machinery makers, associations, research/medical bodies (not
// a buyer).
export function isReasonableProspect(evidence) {
  const buyerFit = matchedBuyerFit(evidence)
  return (
    matchedEntityType(evidence) === 'direct_company' &&
    (buyerFit === 'high' || buyerFit === 'medium') &&
    !matchedHasStrongNegative(evidence) &&
    hasIndustryEvidence(evidence) &&
    hasUsableCompanyName(matchedIdentity(evidence))
  )
}

// Kept for callers/tests of the earlier, stricter rule.
export function isSiteConfirmedBuyer(evidence) {
  return isReasonableProspect(evidence) && matchedBuyerFit(evidence) === 'high' && isPromotableIdentity(matchedIdentity(evidence))
}

// Candidates the site step never needs to load: a page the snippet already
// shows is an article/directory/marketplace/social/video page.
export function snippetSaysNotCompany(candidate) {
  return isNonCompanyEntityType(matchedEntityType(extractEvidence(candidate)))
}

// -> { ok, status, candidate (enriched fields), evidence, scores,
//      qualification, promotable, email, emailSourceUrl, emailStatus,
//      emailReason }. Never throws for a site problem.
export async function verifyCandidateSite({ candidate, settings, fetchPage = (url) => fetchPageSafely(url, LOOKUP_LIMITS) }) {
  const homepage = originOf(candidate.website)
  if (!homepage) return { ok: false, status: 'no_website' }

  const cache = new Map()
  const cachedFetch = (url) => {
    if (!cache.has(url)) cache.set(url, fetchPage(url))
    return cache.get(url)
  }

  const lookup = await lookupCompanyEmail({
    websites: [candidate.website],
    companyName: candidate.canonical_name,
    discoveredOn: candidate.website,
    collectPhones: true,
    fetchPage: cachedFetch,
  })
  const emailFields = {
    email: lookup.status === 'found' ? lookup.email : null,
    emailSourceUrl: lookup.sourceUrl || null,
    emailStatus: lookup.status,
    emailReason: lookup.reason,
    mobiles: lookup.mobiles || [],
    landlines: lookup.landlines || [],
  }
  if (lookup.status === 'not_official_website') return { ok: false, status: 'not_company', ...emailFields }

  const home = await cachedFetch(homepage)
  if (!home.ok) return { ok: false, status: 'fetch_failed', ...emailFields }

  const signals = identitySignalsFromHtml(home.text)
  // Theme placeholders: rashaplast.ir's JSON-LD and og:site_name both say
  // "recook". A Latin-only name sharing nothing with the domain is not
  // this company's name - fall through to the next marker (the title).
  for (const key of ['jsonLdOrganizationName', 'ogSiteName']) {
    if (isForeignLatinName(signals[key], candidate.domain)) signals[key] = null
  }
  const siteText = [signals.titleText, signals.description].filter(Boolean).join(' — ')
  let enriched = { ...candidate, business_description: [candidate.business_description, siteText].filter(Boolean).join(' — ') }
  let evidence = extractEvidence(enriched)
  const baseline = matchedIdentity(evidence)
  const identity = resolveVerifiedIdentity({ domain: candidate.domain, signals, baseline })
  if (identity !== baseline) evidence = replaceIdentityEvidence(evidence, identity)
  if (hasUsableCompanyName(identity)) {
    const name = tidyCompanyName(identity.resolvedName)
    enriched = { ...enriched, canonical_name: name, normalized_name_key: normalizedNameKey(name) }
  }
  if (emailFields.email && !enriched.email) enriched = { ...enriched, email: emailFields.email }
  // Numbers the site itself publishes fill empty fields only (never a
  // snippet number the search result already gave).
  let phoneSourceUrl = null
  if (!enriched.mobile && emailFields.mobiles.length > 0) {
    enriched = { ...enriched, mobile: emailFields.mobiles.slice(0, 2).map((m) => m.number).join('، ') }
    phoneSourceUrl = emailFields.mobiles[0].sourceUrl
  }
  if (!enriched.phone && emailFields.landlines.length > 0) {
    enriched = { ...enriched, phone: emailFields.landlines.slice(0, 2).map((l) => l.number).join('، ') }
    phoneSourceUrl = phoneSourceUrl || emailFields.landlines[0].sourceUrl
  }

  const scores = scoreCandidate(enriched, evidence)
  const qualification = qualifyCandidate({ candidate: enriched, evidence, scores, settings })
  // Whatever rule qualifies it, the SITE ITSELF must look like an Iranian
  // company working with polymer products - not a portal, classifieds or
  // news site that happened to list one, and not a foreign supplier.
  const siteOwn = siteOwnSignals({ candidate, signals, homepageText: visibleText(home.text).slice(0, 8000) })
  const promotable = siteOwn.ok && ((qualification.status === 'qualified' && qualification.autoPromotable) || isReasonableProspect(evidence))
  return { ok: true, status: 'checked', candidate: enriched, evidence, scores, qualification, promotable, siteOwn, phoneSourceUrl, ...emailFields }
}
