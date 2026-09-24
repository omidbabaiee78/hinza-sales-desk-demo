import { fetchPageSafely, identitySignalsFromHtml } from './websiteEnrichment.js'
import { extractEvidence, matchedEntityType, matchedBuyerFit, matchedIdentity, matchedHasStrongNegative, replaceIdentityEvidence } from './evidenceEngine.js'
import { isNonCompanyEntityType } from './entityClassification.js'
import { scoreCandidate } from './scoringEngine.js'
import { qualifyCandidate } from './qualification.js'
import { isPromotableIdentity, resolveVerifiedIdentity } from './identityResolution.js'
import { normalizedNameKey } from './normalization.js'
import { lookupCompanyEmail, LOOKUP_LIMITS } from '../outreach/emailDiscovery.js'

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
  const first = String(name || '').split(/\s*[|،:]\s*|\s+[,–—-]\s+/)[0].trim()
  const brand = first.split(/\s(?:تولید\s*کننده|تولیدکننده|تولید و|فروش|عرضه|واردکننده|نمایندگی)\s/)[0].trim()
  return brand.length >= 2 ? brand : first
}

function hasIndustryEvidence(evidence) {
  return evidence.some(
    (e) => e.evidenceType === 'industry_keyword' || e.evidenceType === 'generic_manufacturing_signal' || e.evidenceType === 'structured_industrial_signal',
  )
}

// The site-confirmed prospect rule described in the header.
export function isSiteConfirmedBuyer(evidence) {
  return (
    matchedEntityType(evidence) === 'direct_company' &&
    matchedBuyerFit(evidence) === 'high' &&
    !matchedHasStrongNegative(evidence) &&
    hasIndustryEvidence(evidence) &&
    isPromotableIdentity(matchedIdentity(evidence))
  )
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
    fetchPage: cachedFetch,
  })
  const emailFields = {
    email: lookup.status === 'found' ? lookup.email : null,
    emailSourceUrl: lookup.sourceUrl || null,
    emailStatus: lookup.status,
    emailReason: lookup.reason,
  }
  if (lookup.status === 'not_official_website') return { ok: false, status: 'not_company', ...emailFields }

  const home = await cachedFetch(homepage)
  if (!home.ok) return { ok: false, status: 'fetch_failed', ...emailFields }

  const signals = identitySignalsFromHtml(home.text)
  const siteText = [signals.titleText, signals.description].filter(Boolean).join(' — ')
  let enriched = { ...candidate, business_description: [candidate.business_description, siteText].filter(Boolean).join(' — ') }
  let evidence = extractEvidence(enriched)
  const baseline = matchedIdentity(evidence)
  const identity = resolveVerifiedIdentity({ domain: candidate.domain, signals, baseline })
  if (identity !== baseline) evidence = replaceIdentityEvidence(evidence, identity)
  if (isPromotableIdentity(identity)) {
    const name = tidyCompanyName(identity.resolvedName)
    enriched = { ...enriched, canonical_name: name, normalized_name_key: normalizedNameKey(name) }
  }
  if (emailFields.email && !enriched.email) enriched = { ...enriched, email: emailFields.email }

  const scores = scoreCandidate(enriched, evidence)
  const qualification = qualifyCandidate({ candidate: enriched, evidence, scores, settings })
  const promotable = (qualification.status === 'qualified' && qualification.autoPromotable) || isSiteConfirmedBuyer(evidence)
  return { ok: true, status: 'checked', candidate: enriched, evidence, scores, qualification, promotable, ...emailFields }
}
