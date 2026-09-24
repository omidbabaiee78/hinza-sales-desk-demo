import { fetchPageSafely, decodeHtmlEntities } from '../prospecting/websiteEnrichment.js'
import { normalizeEmail, normalizeSearchText } from '../prospecting/normalization.js'
import { classifyEntityType, isNonCompanyEntityType } from '../prospecting/entityClassification.js'
import { hasUsableText } from './shared.js'

// ---------------------------------------------------------------------------
// Automatic public email lookup for a lead that has no email.
//
// Looks ONLY at the company's own official website (the lead's website, or
// its discovery candidate's): the homepage, the lead's own page on it and
// at most two same-site contact pages (or /contact-us/, /contact/ when the
// site links none). The site must be this company's:
//   - a discovered lead whose discovery candidate was found ON this site -
//     the site is where the lead came from, so it is the lead (its "name"
//     is often just that page's title), or
//   - the site identifies itself as the company (its <title>, og:site_name
//     or JSON-LD name contains a distinctive word of the company name).
// A news article, directory entry or another firm's site linked as a
// manual lead's "website" fails this and is never used. Then the address:
//   - on the site's own domain (info@acme.ir on acme.ir) - preferred, or
//   - published on the site under a RELATED name - free-mail or another
//     domain sharing a 4+ letter part with the site's (info@psgharn.co on
//     gharn.ir, golshad@gmail.com on igolshad.ir). An unrelated domain
//     (e.g. the web designer's) is never accepted.
// Social networks, directories, marketplaces and documents are never
// searched. Nothing is guessed or constructed - only an address literally
// published on the site.
// ---------------------------------------------------------------------------

export const EMAIL_LOOKUP_REASONS = {
  found: 'ایمیل در وب‌سایت رسمی شرکت پیدا شد',
  no_website: 'وب‌سایت رسمی برای این سرنخ ثبت نشده است',
  not_official_website: 'وب‌سایت ثبت‌شده سایت خود شرکت نیست (شبکه اجتماعی، دایرکتوری یا فایل)',
  fetch_failed: 'وب‌سایت در دسترس نبود',
  no_email_on_site: 'در وب‌سایت شرکت ایمیلی منتشر نشده است',
  only_other_domain: 'فقط ایمیل عمومی یا با دامنه دیگر پیدا شد؛ خودکار پذیرفته نشد',
  identity_mismatch: 'وب‌سایت خود را با نام این شرکت معرفی نمی‌کند (ممکن است سایت خبری، دایرکتوری یا شرکت دیگری باشد)؛ خودکار پذیرفته نشد',
}

// Words too generic to prove a site belongs to a specific company.
const GENERIC_NAME_WORDS = new Set(
  [
    'شرکت', 'گروه', 'صنعتی', 'صنایع', 'تولید', 'تولیدی', 'کننده', 'تولیدکننده', 'کارخانه', 'کارخانجات', 'مجتمع', 'بازرگانی',
    'شیمی', 'شیمیایی', 'پلاستیک', 'پلاستیکی', 'پلیمر', 'پلیمری', 'پلی', 'اتیلن', 'سهامی', 'خاص', 'عام', 'ایران', 'ایرانیان',
    'تهران', 'فیلم', 'لوله', 'اتصالات', 'قطعات', 'بهداشتی', 'سفارشی', 'محصولات', 'مواد', 'نوین', 'پارس', 'صنعت',
    'company', 'group', 'co', 'industrial', 'industries', 'plastic', 'chemical', 'ltd', 'inc',
  ].map((w) => normalizeSearchText(w)),
)

function distinctiveNameWords(companyName) {
  return normalizeSearchText(companyName || '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w))
}

function siteIdentityText(html) {
  const parts = []
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html || '')
  if (title) parts.push(title[1])
  for (const re of [/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i]) {
    const m = re.exec(html || '')
    if (m) parts.push(m[1])
  }
  for (const m of (html || '').matchAll(/"@type"\s*:\s*"(?:Organization|Corporation|LocalBusiness|Manufacturer)"[\s\S]{0,400}?"name"\s*:\s*"([^"]+)"/gi)) parts.push(m[1])
  return normalizeSearchText(decodeHtmlEntities(parts.join(' ')))
}

// True when the site's own identity markers contain a distinctive word of
// the company name.
export function siteMatchesCompany(html, companyName) {
  const words = distinctiveNameWords(companyName)
  if (words.length === 0) return false
  const identity = siteIdentityText(html)
  return words.some((w) => identity.includes(w))
}

const NOT_OFFICIAL_HOSTS = [
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  't.me',
  'telegram.me',
  'wa.me',
  'whatsapp.com',
  'youtube.com',
  'aparat.com',
  'google.com',
  'goo.gl',
  'openstreetmap.org',
  'wikipedia.org',
  'wikimapia.org',
  'neshan.org',
  'balad.ir',
  'divar.ir',
  'sheypoor.com',
  'torob.com',
  'digikala.com',
  'basalam.com',
  'emalls.ir',
  'yellowpages.ir',
  'iranyellowpages.net',
  'irantolid.com',
  'eghtesadnews.com',
  'bing.com',
]

const DOCUMENT_PATH = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif)(\?|#|$)/i
const IGNORED_LOCAL_PARTS = /^(no-?reply|donotreply|webmaster|hostmaster|postmaster|abuse|privacy|wordpress|example|test|your|email|name|user|yourfriendmail)$/i
// "www.acme@gmail.com" - a website address typed into an email; it does
// not exist, so it is treated as malformed rather than "fixed".
const MALFORMED_LOCAL_PART = /^www\./i
const FALLBACK_CONTACT_PATHS = ['/contact-us/', '/contact/']
const PREFERRED_LOCAL_PARTS = ['sales', 'info', 'contact', 'office', 'marketing', 'commercial']
const CONTACT_LINK = /contact|تماس/i
const EMAIL_IN_TEXT = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/gi
const LOOKUP_LIMITS = { timeoutMs: 6000, maxBytes: 300000 }

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function sameSite(domain, host) {
  return domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`)
}

// The lead's official homepage, or a reason why there is none.
export function resolveOfficialWebsite(candidates) {
  let sawUnofficial = false
  for (const raw of candidates) {
    if (!hasUsableText(raw)) continue
    const text = String(raw).trim()
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`
    const host = hostOf(url)
    if (!host || !host.includes('.')) continue
    if (DOCUMENT_PATH.test(url) || NOT_OFFICIAL_HOSTS.some((h) => sameSite(host, h))) {
      sawUnofficial = true
      continue
    }
    const origin = new URL(url).origin
    return { ok: true, host, homepage: `${origin}/`, pages: [...new Set([`${origin}/`, url])] }
  }
  return { ok: false, status: sawUnofficial ? 'not_official_website' : 'no_website' }
}

export function extractEmails(html) {
  let text = decodeHtmlEntities(html || '')
  try {
    text = decodeURIComponent(text)
  } catch {
    // malformed %-sequences - keep the entity-decoded text
  }
  const found = []
  for (const match of text.match(EMAIL_IN_TEXT) || []) {
    const email = normalizeEmail(match.replace(/\.+$/, ''))
    if (!email || /\.(png|jpe?g|gif|webp|svg|css|js)$/.test(email)) continue
    if (!found.includes(email)) found.push(email)
  }
  return found
}

function contactLinks(html, baseUrl, host) {
  const links = []
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi
  let match
  while ((match = re.exec(html || '')) && links.length < 2) {
    let href = match[1]
    try {
      href = decodeURIComponent(href)
    } catch {
      // keep raw
    }
    if (!CONTACT_LINK.test(href) && !CONTACT_LINK.test(match[2])) continue
    try {
      const url = new URL(match[1], baseUrl)
      const linkHost = url.hostname.toLowerCase().replace(/^www\./, '')
      if (/^https?:$/.test(url.protocol) && sameSite(linkHost, host) && !links.includes(url.href)) links.push(url.href)
    } catch {
      // unparseable
    }
  }
  return links
}

function lettersOnly(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// True when a and b share a run of at least 4 letters/digits
// ("psgharn" / "gharn", "denizgroup" / "denizshimi").
function sharesNamePart(a, b, min = 4) {
  const x = lettersOnly(a)
  const y = lettersOnly(b)
  for (let i = 0; i + min <= x.length; i += 1) if (y.includes(x.slice(i, i + min))) return true
  return false
}

// "gharn" for gharn.ir, "aris" for aris.com.co.
function siteLabel(host) {
  const labels = host.split('.')
  const i = labels.length > 2 && /^(co|com|org|net|ac|gov)$/.test(labels[labels.length - 2]) ? labels.length - 3 : labels.length - 2
  return labels[Math.max(i, 0)]
}

function preferredOf(list) {
  for (const preferred of PREFERRED_LOCAL_PARTS) {
    const hit = list.find((e) => e.split('@')[0] === preferred)
    if (hit) return hit
  }
  return list[0] || null
}

// The site's own-domain address first; otherwise one under a related name
// (see the header). null when only unrelated addresses are published.
export function pickCompanyEmail(emails, host) {
  const usable = emails.filter((e) => {
    const local = e.split('@')[0]
    return !IGNORED_LOCAL_PARTS.test(local) && !MALFORMED_LOCAL_PART.test(local)
  })
  const own = usable.filter((e) => sameSite(e.split('@')[1], host))
  if (own.length > 0) return preferredOf(own)
  const label = siteLabel(host)
  return preferredOf(usable.filter((e) => {
    const [local, domain] = e.split('@')
    return sharesNamePart(label, local) || sharesNamePart(label, domain.split('.')[0])
  }))
}

// -> { status, email, sourceUrl, reason, pagesFetched }. Never throws.
// discoveredOn: the website the lead's discovery candidate was found on
// (null for a manual lead) - see the header.
export async function lookupCompanyEmail({ websites, companyName, discoveredOn = null, fetchPage = (url) => fetchPageSafely(url, LOOKUP_LIMITS) }) {
  const site = resolveOfficialWebsite(websites)
  if (!site.ok) return { status: site.status, email: null, sourceUrl: null, reason: EMAIL_LOOKUP_REASONS[site.status], pagesFetched: 0 }
  const result = (status, extra = {}) => ({ status, email: null, sourceUrl: null, reason: EMAIL_LOOKUP_REASONS[status], ...extra })

  const discovered = hasUsableText(discoveredOn) ? resolveOfficialWebsite([discoveredOn]) : null
  const siteIsTheLead = Boolean(discovered?.ok && sameSite(discovered.host, site.host))
  const queue = [...site.pages]
  const visited = new Set()
  let triedFallback = false
  let pagesFetched = 0
  let anyOk = false
  let lastFailure = null
  let sawOtherEmail = false

  while (pagesFetched < 5) {
    if (queue.length === 0) {
      // Nothing left and nothing found: try the usual contact paths once.
      if (triedFallback || !anyOk) break
      triedFallback = true
      queue.push(...FALLBACK_CONTACT_PATHS.map((path) => new URL(path, site.homepage).href).filter((link) => !visited.has(link)))
      continue
    }
    const url = queue.shift()
    if (visited.has(url)) continue
    visited.add(url)
    const page = await fetchPage(url)
    pagesFetched += 1
    if (!page.ok) {
      lastFailure = page.reason
      continue
    }
    if (!anyOk) {
      // The first page that loads decides whose site this is.
      const title = /<title[^>]*>([^<]+)<\/title>/i.exec(page.text)?.[1] || ''
      if (isNonCompanyEntityType(classifyEntityType({ domain: site.host, title, url }))) return result('not_official_website', { pagesFetched })
      if (!siteIsTheLead && !siteMatchesCompany(page.text, companyName)) return result('identity_mismatch', { pagesFetched })
    }
    anyOk = true
    const emails = extractEmails(page.text)
    const email = pickCompanyEmail(emails, site.host)
    if (email) return { status: 'found', email, sourceUrl: url, reason: EMAIL_LOOKUP_REASONS.found, pagesFetched }
    if (emails.length > 0) sawOtherEmail = true
    for (const link of contactLinks(page.text, url, site.host)) if (!visited.has(link)) queue.push(link)
  }

  if (!anyOk) {
    return { status: 'fetch_failed', email: null, sourceUrl: null, reason: `${EMAIL_LOOKUP_REASONS.fetch_failed}${lastFailure ? ` (${lastFailure})` : ''}`, pagesFetched }
  }
  const status = sawOtherEmail ? 'only_other_domain' : 'no_email_on_site'
  return { status, email: null, sourceUrl: null, reason: EMAIL_LOOKUP_REASONS[status], pagesFetched }
}

// Which leads the next batch checks: no email, not do_not_contact, not
// converted/lost, never looked up first (newest leads first), then a
// transient failure after 1 day, anything else after 30 days.
export function leadsDueForEmailLookup(leads, now = new Date(), batchSize = 8) {
  const DAY = 24 * 60 * 60 * 1000
  const due = leads.filter((l) => {
    if (hasUsableText(l.email) || l.do_not_contact || l.status === 'converted' || l.status === 'lost') return false
    if (!l.email_lookup_at) return true
    const age = now.getTime() - new Date(l.email_lookup_at).getTime()
    return l.email_lookup_status === 'fetch_failed' ? age >= DAY : age >= 30 * DAY
  })
  due.sort((a, b) => {
    if (!a.email_lookup_at !== !b.email_lookup_at) return a.email_lookup_at ? 1 : -1
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
  return due.slice(0, batchSize)
}
