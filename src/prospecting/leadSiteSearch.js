import { fetchPageSafely } from './websiteEnrichment.js'
import { classifyEntityType, isNonCompanyEntityType } from './entityClassification.js'
import { extractDomain, normalizeSearchText } from './normalization.js'
import { distinctiveNameWords, siteIdentityText, resolveOfficialWebsite, lookupCompanyEmail, LOOKUP_LIMITS } from '../outreach/emailDiscovery.js'

// ---------------------------------------------------------------------------
// Finding the official website of a lead whose recorded "website" is not
// the company's own - production data: member lists (a chamber-of-commerce
// PDF), a news article, an industry-statistics page. The email lookup
// rightly refuses those pages, so these leads could never get an address.
//
// One web search for the company's exact name; a result is taken as the
// company's site only when that site's OWN identity markers (<title>,
// og:site_name, JSON-LD name) contain EVERY distinctive word of the name,
// as whole words. Names with fewer than two distinctive words are not
// searched - one word is too easy to find on an unrelated site. Social,
// directory, marketplace and article pages are never accepted. The email
// then comes from the normal lookup on that site. Nothing is guessed.
// ---------------------------------------------------------------------------

export const LEAD_SITE_SEARCH_STATUSES = new Set(['no_website', 'not_official_website', 'identity_mismatch'])
const MAX_RESULTS_CHECKED = 4

function identityHasAllWords(html, words) {
  const tokens = new Set(siteIdentityText(html).split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  return words.every((w) => tokens.has(w))
}

// -> { status, email, sourceUrl, site, reason }. Never throws for a site
// problem; a search failure propagates so the caller can count it.
export async function findLeadEmailViaSearch({ companyName, search, fetchPage = (url) => fetchPageSafely(url, LOOKUP_LIMITS) }) {
  const words = distinctiveNameWords(companyName)
  if (words.length < 2) return { status: 'name_too_generic', email: null, sourceUrl: null, site: null }

  const results = await search(`"${normalizeSearchText(companyName)}"`)
  const seenHosts = new Set()
  for (const item of results.slice(0, MAX_RESULTS_CHECKED)) {
    const site = resolveOfficialWebsite([item?.link])
    if (!site.ok || seenHosts.has(site.host)) continue
    seenHosts.add(site.host)
    const entityType = classifyEntityType({ domain: extractDomain(item.link), title: item.title, snippet: item.snippet, url: item.link })
    if (isNonCompanyEntityType(entityType)) continue
    const home = await fetchPage(site.homepage)
    if (!home.ok || !identityHasAllWords(home.text, words)) continue
    const lookup = await lookupCompanyEmail({ websites: [site.homepage], companyName, fetchPage, collectPhones: true })
    return { status: lookup.status, email: lookup.email, sourceUrl: lookup.sourceUrl, site: site.homepage, reason: lookup.reason, mobiles: lookup.mobiles, landlines: lookup.landlines }
  }
  return { status: 'official_site_not_found', email: null, sourceUrl: null, site: null }
}
