import { fetchPageSafely, decodeHtmlEntities } from '../prospecting/websiteEnrichment.js'
import { normalizeEmail, normalizeSearchText } from '../prospecting/normalization.js'
import { classifyEntityType, isNonCompanyEntityType } from '../prospecting/entityClassification.js'
import { hasUsableText } from './shared.js'
import { normalizeDigits } from '../utils/leadImport/digits.js'

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

export function distinctiveNameWords(companyName) {
  return normalizeSearchText(companyName || '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w))
}

export function siteIdentityText(html) {
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
const FALLBACK_CONTACT_PATHS = ['/contact-us/', '/contact/', '/about-us/', '/about/']
const PREFERRED_LOCAL_PARTS = ['sales', 'info', 'contact', 'office', 'marketing', 'commercial']
// «تماس با ما», «ارتباط با ما», «درباره ما» - many Iranian sites publish
// the address only on the about page, or label the contact link «ارتباط».
const CONTACT_LINK = /contact|about|تماس|ارتباط|درباره/i
const CONTACT_FIRST = /contact|تماس|ارتباط/i
const MAX_CONTACT_LINKS = 3
const MAX_PAGES = 6
// Bounded to RFC lengths: an unbounded local part makes the scan quadratic
// on long unbroken runs (base64 images, minified code) in big pages.
const EMAIL_IN_TEXT = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9][a-z0-9.-]{0,252}\.[a-z]{2,24}/gi
// Page builders put the footer (where the address usually is) after
// several hundred KB of inline CSS/JS, so the byte cap must be generous.
export const LOOKUP_LIMITS = { timeoutMs: 12000, maxBytes: 1000000 }

// Cloudflare "email protection": the address is XOR-encoded in
// data-cfemail="..." or /cdn-cgi/l/email-protection#... - decoded exactly,
// never guessed.
function decodeCloudflareEmail(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return ''
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  return out
}

// "info[at]acme.ir", "sales (at) acme (dot) ir" -> the literal address the
// site publishes. Only bracketed forms: a bare " at " is ordinary English.
function deobfuscate(text) {
  return text
    .replace(/\s*[[({]\s*(?:at|@)\s*[\])}]\s*/gi, '@')
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, '.')
}

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
  const cloudflare = [...(html || '').matchAll(/(?:data-cfemail=["']|email-protection#)([0-9a-f]{6,})/gi)].map((m) => decodeCloudflareEmail(m[1]))
  let text = deobfuscate(`${decodeHtmlEntities(html || '')} ${cloudflare.join(' ')}`)
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

// Same-site contact pages, «تماس/ارتباط/contact» links before «درباره/about».
function contactLinks(html, baseUrl, host) {
  const contact = []
  const about = []
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi
  let match
  while ((match = re.exec(html || '')) && contact.length < MAX_CONTACT_LINKS) {
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
      if (!/^https?:$/.test(url.protocol) || !sameSite(linkHost, host)) continue
      const list = CONTACT_FIRST.test(href) || CONTACT_FIRST.test(match[2]) ? contact : about
      if (!contact.includes(url.href) && !about.includes(url.href)) list.push(url.href)
    } catch {
      // unparseable
    }
  }
  return [...contact, ...about].slice(0, MAX_CONTACT_LINKS)
}

function lettersOnly(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Industry words many unrelated companies share - a match on one of these
// alone says nothing about two names being the same company
// (pakchemical.com vs sales@pishrochem.com share only "chem").
const GENERIC_NAME_PARTS = /(chemical|chemi|chem|shimi|plastic|plast|polymer|poly|pack|group|industrial|industry|sanat|baspar|pars|iran|cable|pipe|film|trading|company|info|sales|mail)/g

// True when a and b share a run of at least 4 letters/digits outside
// those generic words ("psgharn" / "gharn", "denizgroup" / "denizshimi").
function sharesNamePart(a, b, min = 4) {
  const x = lettersOnly(a).replace(GENERIC_NAME_PARTS, ' ')
  const y = lettersOnly(b).replace(GENERIC_NAME_PARTS, ' ')
  for (let i = 0; i + min <= x.length; i += 1) {
    const part = x.slice(i, i + min)
    if (!part.includes(' ') && y.includes(part)) return true
  }
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

// ---------------------------------------------------------------------------
// Phone numbers a company publishes on its OWN site (same pages, same
// identity rules as the email lookup). Stricter than the spreadsheet parser
// in utils/leadImport/contactNumbers.js, because a web page is full of
// prices, codes and dates:
//   - tel: links and WhatsApp links (wa.me/…, api.whatsapp.com/send?phone=)
//   - a strictly-shaped mobile (0/+98/0098 + 9xx xxx xxxx) in visible text
//   - a landline (0 + 2-digit area + 8 digits) only right after a phone
//     label (تلفن، تماس، phone...), never after فکس/نمابر/fax
// Numbers in a web-designer credit («طراحی سایت: ...», "designed by") are
// skipped. Nothing is completed or guessed - only numbers literally on the
// page, with the page URL kept as their source.
// ---------------------------------------------------------------------------

const PHONE_LABEL = /(تلفن|تلفکس|تماس|همراه|موبایل|شماره|واتس\s*اپ|phone|tel|mobile|call|whatsapp)/i
const FAX_LABEL = /(فکس|نمابر|fax)/i
const DESIGNER_CREDIT = /(طراحی\s*(?:و\s*(?:توسعه|پشتیبانی)\s*)?(?:سایت|وب|وبسایت)|طراحی\s*و\s*توسعه|design(?:ed)?\s*by|powered\s*by|developed\s*by)/i
const MAX_NUMBERS = 3

function localDigits(raw) {
  const digits = normalizeDigits(String(raw)).replace(/\D/g, '')
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`
  if (digits.startsWith('98')) return `0${digits.slice(2)}`
  return digits
}

function mobileKey(raw) {
  const local = localDigits(raw)
  return /^09\d{9}$/.test(local) ? local : null
}

function landlineKey(raw) {
  const local = localDigits(raw)
  return /^0[1-8]\d{9}$/.test(local) ? local : null
}

function visibleText(html) {
  const stripped = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return normalizeDigits(decodeHtmlEntities(stripped)).replace(/\s+/g, ' ')
}

// -> { mobiles: ['09xxxxxxxxx'], landlines: ['0xxxxxxxxxx'] }
export function extractPhones(html) {
  const source = String(html || '')
  const mobiles = new Set()
  const landlines = new Set()
  const creditBefore = (text, index) => DESIGNER_CREDIT.test(text.slice(Math.max(0, index - 160), index))

  for (const m of source.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    if (creditBefore(source, m.index)) continue
    const mobile = mobileKey(m[1])
    if (mobile) mobiles.add(mobile)
    else {
      const landline = landlineKey(m[1])
      if (landline) landlines.add(landline)
    }
  }
  for (const m of source.matchAll(/(?:wa\.me\/|whatsapp\.com\/send\/?\?phone=)\+?(\d{10,14})/gi)) {
    if (creditBefore(source, m.index)) continue
    const mobile = mobileKey(m[1])
    if (mobile) mobiles.add(mobile)
  }

  const text = visibleText(source)
  for (const m of text.matchAll(/(?<![\d+])(?:\+98|0098|0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g)) {
    const before = text.slice(Math.max(0, m.index - 30), m.index)
    if (FAX_LABEL.test(before) || creditBefore(text, m.index)) continue
    const mobile = mobileKey(m[0])
    if (mobile) mobiles.add(mobile)
  }
  for (const m of text.matchAll(/(?<![\d+])(?:\+98\s?|0098\s?|0)\(?([1-8]\d)\)?[\s-]*(\d{4})[\s-]?(\d{4})(?!\d)/g)) {
    const before = text.slice(Math.max(0, m.index - 30), m.index)
    if (!PHONE_LABEL.test(before) || FAX_LABEL.test(before) || creditBefore(text, m.index)) continue
    const landline = landlineKey(m[0])
    if (landline) landlines.add(landline)
  }
  return { mobiles: [...mobiles].slice(0, MAX_NUMBERS), landlines: [...landlines].slice(0, MAX_NUMBERS) }
}

// -> { status, email, sourceUrl, reason, pagesFetched }. Never throws.
// discoveredOn: the website the lead's discovery candidate was found on
// (null for a manual lead) - see the header.
// collectPhones: also gather the numbers the site publishes (extractPhones);
// the crawl then continues past a found email until a number is found too,
// and the result adds mobiles/landlines: [{ number, sourceUrl }]. Off by
// default, so the email pipeline's own lookup behaves exactly as before.
export async function lookupCompanyEmail({ websites, companyName, discoveredOn = null, fetchPage = (url) => fetchPageSafely(url, LOOKUP_LIMITS), collectPhones = false }) {
  const mobiles = new Map()
  const landlines = new Map()
  const listOf = (map) => [...map].map(([number, sourceUrl]) => ({ number, sourceUrl }))
  const withPhones = (r) => (collectPhones ? { ...r, mobiles: listOf(mobiles), landlines: listOf(landlines) } : r)
  const site = resolveOfficialWebsite(websites)
  if (!site.ok) return withPhones({ status: site.status, email: null, sourceUrl: null, reason: EMAIL_LOOKUP_REASONS[site.status], pagesFetched: 0 })
  const result = (status, extra = {}) => withPhones({ status, email: null, sourceUrl: null, reason: EMAIL_LOOKUP_REASONS[status], ...extra })
  let found = null

  const discovered = hasUsableText(discoveredOn) ? resolveOfficialWebsite([discoveredOn]) : null
  const siteIsTheLead = Boolean(discovered?.ok && sameSite(discovered.host, site.host))
  const queue = [...site.pages]
  const visited = new Set()
  let triedFallback = false
  let pagesFetched = 0
  let anyOk = false
  let lastFailure = null
  let sawOtherEmail = false

  while (pagesFetched < MAX_PAGES) {
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
    if (collectPhones) {
      const phones = extractPhones(page.text)
      for (const n of phones.mobiles) if (!mobiles.has(n)) mobiles.set(n, url)
      for (const n of phones.landlines) if (!landlines.has(n)) landlines.set(n, url)
    }
    const emails = found ? [] : extractEmails(page.text)
    const email = found ? null : pickCompanyEmail(emails, site.host)
    if (email) found = { status: 'found', email, sourceUrl: url, reason: EMAIL_LOOKUP_REASONS.found }
    if (found && (!collectPhones || mobiles.size + landlines.size > 0)) return withPhones({ ...found, pagesFetched })
    if (emails.length > 0) sawOtherEmail = true
    for (const link of contactLinks(page.text, url, site.host)) if (!visited.has(link)) queue.push(link)
  }

  if (found) return withPhones({ ...found, pagesFetched })
  if (!anyOk) {
    return withPhones({ status: 'fetch_failed', email: null, sourceUrl: null, reason: `${EMAIL_LOOKUP_REASONS.fetch_failed}${lastFailure ? ` (${lastFailure})` : ''}`, pagesFetched })
  }
  const status = sawOtherEmail ? 'only_other_domain' : 'no_email_on_site'
  return withPhones({ status, email: null, sourceUrl: null, reason: EMAIL_LOOKUP_REASONS[status], pagesFetched })
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
