import { normalizeSearchText } from './normalization.js'
import { hasTokenPhrase } from './textMatching.js'

// ---------------------------------------------------------------------------
// Phase 23D - Smart Qualification 2.0/2.1: deterministic RESULT/ENTITY TYPE
// classification. Purely rule-based (known-domain lists + URL-path patterns
// + Persian keyword matching) - explicitly NOT an LLM call, per spec. A page
// ABOUT ten manufacturers (a directory, a "بهترین تولیدکنندگان..." listicle,
// a social post, a video, a marketplace ad) is a fundamentally different
// thing from ONE company's own website, no matter how many manufacturing
// keywords it happens to echo back.
//
// Phase 23D.1 hardening: the production dry-run of 2.0 showed a domain
// simply not being on the (short) known-platform blocklist was being
// treated as proof of "direct_company" - which is exactly backwards (a page
// having its own domain is not, by itself, evidence it's a company's own
// site: general classifieds/B2B-directory/portal sites like istgah.com or
// bazarekeshavarzi.com have their own domains too). 2.1 widens the negative
// signal net considerably (more known intermediary domains, URL PATH
// patterns, more Persian title/snippet patterns) so "direct_company" is
// reached only once nothing suspicious was found, not merely "a domain
// exists" - see the 23D.1 report for the specific false positives this
// fixes (istgah.com, my.abyartajhiz.ir, bazarekeshavarzi.com).
//
// Shared by:
//   - sourceAdapters/serperSearch.js - avoids treating a listicle/directory
//     page's TITLE as if it were a company name (spec item 7).
//   - evidenceEngine.js - turns the classification into auditable evidence
//     (direct_company_site / non_company_content), which qualification.js
//     then reads back via matchedEntityType(). Per 23D.1 item 3, ENTITY
//     TYPE is decided here entirely independently of manufacturing
//     relevance - evidenceEngine.js/qualification.js layer the "is this
//     industry-relevant" question on top separately, never as part of this
//     classification itself.
//
// Phase 23D-FINAL: all keyword/phrase matching switched from substring to
// exact word/phrase-boundary matching (textMatching.js) - a false positive
// here is uniquely costly since it hard-caps a candidate at manual_review
// forever. Section K also added: retail/commerce wording ("قیمت و خرید")
// no longer marks a page marketplace/directory when it also self-
// identifies as a producer.
// ---------------------------------------------------------------------------

export const ENTITY_TYPES = {
  DIRECT_COMPANY: 'direct_company',
  DIRECTORY_OR_LIST: 'directory_or_list',
  ARTICLE: 'article',
  MARKETPLACE: 'marketplace',
  SOCIAL: 'social',
  VIDEO: 'video',
  UNKNOWN: 'unknown',
}

export const ENTITY_TYPE_LABELS_FA = {
  direct_company: 'وب‌سایت مستقیم شرکت',
  directory_or_list: 'صفحه فهرستی/دایرکتوری',
  article: 'مقاله یا محتوای معرفی',
  marketplace: 'آگهی در یک مارکت‌پلیس',
  social: 'صفحه شبکه اجتماعی',
  video: 'صفحه ویدیویی',
  unknown: 'نامشخص',
}

// Known third-party platforms - checked FIRST and authoritatively: a video
// hosted on Aparat is a video regardless of what its own title says, never
// re-classified as an "article" just because the title also happens to use
// listicle wording. Widened in 23D.1 with the specific Iranian
// classifieds/B2B-directory sites the production dry-run surfaced as false
// positives.
const VIDEO_DOMAINS = ['aparat.com', 'youtube.com', 'youtu.be']
const SOCIAL_DOMAINS = ['instagram.com', 'facebook.com', 'twitter.com', 'x.com', 't.me', 'telegram.me', 'linkedin.com', 'pinterest.com', 'wa.me']
const MARKETPLACE_DOMAINS = [
  'divar.ir',
  'sheypoor.com',
  'digikala.com',
  'alibaba.com',
  'trustpass.alibaba.com',
  'basalam.com',
  'iranika.com',
  'torob.com',
  // 23D.1 - general Iranian classifieds/B2B-needs marketplaces, each with
  // their own domain but never themselves a manufacturer.
  'istgah.com',
  'niazerooz.com',
  'bazarekeshavarzi.com',
]
const DIRECTORY_DOMAINS = [
  'emalls.ir',
  // 23D.1 - Iranian B2B/industry directory and exhibition-listing sites.
  'iran-tejarat.com',
  'foodkeys.com',
  'wikiplast.ir',
  'namayeshgahha.ir',
]

// Listicle/roundup-article phrasing - "لیست ۱۰ تولیدکننده...", "بهترین
// تولیدکنندگان..." - a page ABOUT MULTIPLE companies, never a company
// itself. Requires co-occurrence with an ENTITY_WORD (see below) so an
// unrelated "بهترین" (e.g. "بهترین کیفیت محصولات ما") on a real company's
// own page doesn't misfire.
//
// "FINAL REGRESSION FIX" round, item 2/3 - "معرفی" (introduce/present) was
// REMOVED from this list. Unlike the other words here, "معرفی" is
// structurally AMBIGUOUS: a real company routinely uses it to introduce
// ITSELF ("معرفی کارخانه تولید قطعات پلاستیکی خودرو - پارت لوکس"), not just
// a third party introducing MULTIPLE companies ("معرفی معروف‌ترین
// کارگاه‌های تزریق پلاستیک در ایران"). The distinguishing signal is
// PLURALITY/superlative, not the bare word "معرفی" itself - see
// AMBIGUOUS_INTRO_WORDS/PLURAL_ENTITY_WORDS below, checked as a SEPARATE,
// narrower co-occurrence rule.
const LISTICLE_MARKER_WORDS = ['لیست', 'بهترین', 'برترین', 'رتبه بندی', 'راهنمای خرید', 'راهنما', 'مقایسه', 'کارخانه های']
const DIRECTORY_MARKER_WORDS = ['فهرست', 'دایرکتوری', 'کاتالوگ', 'دسته بندی']
// "معرفی" alone only counts as a listicle/article marker when it
// co-occurs with a PLURAL entity word - "معرفی شرکت‌ها"/"معرفی
// کارگاه‌های..."/"معرفی تولیدکنندگان..." is unambiguously about MULTIPLE
// companies; "معرفی کارخانه" (singular) is exactly as likely to be a
// company introducing itself.
const AMBIGUOUS_INTRO_WORDS = ['معرفی']
// 'تولید کنندگان' (with a space) is how many listicle titles write it -
// «لیست تولید کنندگان ورق پلی کربنات» was read as a company site.
const PLURAL_ENTITY_WORDS = ['شرکت ها', 'شرکت های', 'شرکتها', 'تولیدکنندگان', 'تولید کنندگان', 'کارخانه ها', 'کارخانجات', 'کارگاه ها', 'کارگاه های']
// 23D-FINAL.1, section 4 (my.abyartajhiz.ir / hadiplastic.ir false
// positives): "کارگاه" (workshop) was missing entirely - hadiplastic.ir's
// "معرفی معروف‌ترین کارگاه‌های تزریق پلاستیک در ایران" never matched any
// ENTITY_WORD before, so the LISTICLE_MARKER_WORDS+ENTITY_WORDS
// co-occurrence check silently never fired despite "معرفی" being present.
// "شرکت های" (with the correct ی-based plural marker, not "شرکت ها") was
// also simply the wrong spelling - a real Persian plural is "شرکت‌های".
const ENTITY_WORDS = [
  'تولیدکننده',
  'تولیدکنندگان',
  'تولید کنندگان',
  'شرکت ها',
  'شرکت های',
  'شرکتها',
  'کارخانه',
  'کارخانه ها',
  'کارخانجات',
  'کارگاه',
  'کارگاه ها',
  'کارگاه های',
  'برند',
]

// 23D.1 - standalone strong phrases that don't need an ENTITY_WORD alongside
// them: each is, on its own, rarely how a real manufacturer describes its
// OWN homepage/about page, and is exactly the kind of phrasing the spec
// calls out ("بانک اطلاعات", "قیمت و خرید", "مقاله").
const STANDALONE_DIRECTORY_PHRASES = ['بانک اطلاعات']
// "شرکت های تولید کننده" ("companies that manufacture...") is, unlike the
// plain ENTITY_WORDS above, ALREADY self-sufficient on its own - it always
// describes MULTIPLE companies, never a single company's own self-
// description (the co-occurrence requirement was actually working against
// it: none of "تولیدکننده"/"شرکت ها" match "تولید کننده"/"شرکت های" as
// separate tokens due to the space/plural-marker differences, so this
// phrase silently never fired as a LISTICLE_MARKER_WORD before). Kept OUT
// of STANDALONE_DIRECTORY_PHRASES/the production-self-id guard below on
// purpose - that guard exists for phrases like "بانک اطلاعات" that are
// ambiguous without it, but THIS phrase's own "تولید کننده" half would
// always satisfy that guard and defeat it.
const UNGUARDED_DIRECTORY_PHRASES = ['شرکت های تولید کننده']
// «نمایشگاه و بازار مجازی ایران» (namabazaar.com) - an online B2B market,
// not a company.
const STANDALONE_MARKETPLACE_PHRASES = ['قیمت و خرید', 'قیمت و فروش', 'خرید و فروش', 'بازار مجازی', 'نمایشگاه مجازی']
const STANDALONE_ARTICLE_PHRASES = ['مقاله']

// Section K - retail/commerce wording ("قیمت و خرید" etc.) must not brand a
// genuine manufacturer's own page as a marketplace/directory just because
// manufacturers legitimately sell their own products too. Only treated as a
// negative signal when the SAME text carries no explicit production self-
// identification ("تولیدکننده"/"سازنده") - a real processor's homepage
// practically always says one of these somewhere; a pure listing/portal
// page practically never does.
const PRODUCTION_SELF_ID_WORDS = ['تولیدکننده', 'تولید کننده', 'سازنده']

// 23D.1 item 1 - URL PATH patterns. A page's own URL structure is often a
// stronger, more reliable non-company signal than its title text (a blog
// CMS almost always puts posts under /blog/, /article/, /news/, /tag/,
// /category/, ... regardless of what that specific post's title says).
// Deliberately does NOT flag a bare /product/ or /products/ segment - a
// real manufacturer's own product catalog page is a POSITIVE signal (see
// item 2), not a negative one; only an explicit multi-vendor-style
// "product-listing" segment is flagged.
// 23D-FINAL.1, section 4 (hadiplastic.ir/view/articleid/95): the old
// pattern required the segment to be EXACTLY "article" - a CMS route like
// "/view/articleid/95" (segment "articleid", not "article") silently never
// matched. "article"/"catalogue"/"listing"-family words are prefix-matched
// now (still anchored at a "/" boundary on the left) - deliberately NOT
// extended to the short, common-English-prefix words below ("ad", "tag",
// "faq", "post") where prefix-matching would risk matching unrelated
// segments like "/administration/" or "/address/".
const ARTICLE_PATH_PATTERNS = [/\/(articles?|blog|news|magazine|mag)[a-z]*(\/|$)/i, /\/posts?(\/|$)/]
const DIRECTORY_PATH_PATTERNS = [
  /\/(categor(?:y|ies)|topics?)[a-z]*(\/|$)/i,
  /\/(listings?|directory|catalog(?:ue)?)[a-z]*(\/|$)/i,
  /\/tags?(\/|$)/,
  /\/faqs?(\/|$)/,
  /\/(product-list|products-list|product-listing|products-listing)[a-z]*(\/|$)/i,
]
const MARKETPLACE_PATH_PATTERNS = [/\/(ads?|advert|classifieds?)(\/|$)/, /\/(marketplace|bazaar)[a-z]*(\/|$)/i]

function pathnameOf(url) {
  if (!url) return ''
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return ''
  }
}

function matchesAny(path, patterns) {
  return patterns.some((re) => re.test(path))
}

// Section B - exact word/phrase-boundary matching (see textMatching.js),
// never substring: an unrelated word that happens to CONTAIN one of these
// phrases as a fragment must never trip the classifier.
function hasAny(text, words) {
  return words.some((w) => hasTokenPhrase(text, w))
}

function domainMatches(domain, list) {
  if (!domain) return false
  return list.some((d) => domain === d || domain.endsWith(`.${d}`))
}

// { domain, title, snippet, url } - plain text/host fields, not a full
// candidate row, so both the adapter (before a candidate object exists) and
// evidenceEngine.js (after normalize()) can call it the same way. `url` is
// the actual result link (candidate.source_url/website) - used only for its
// PATH, never fetched.
export function classifyEntityType({ domain, title, snippet, url } = {}) {
  if (domainMatches(domain, VIDEO_DOMAINS)) return ENTITY_TYPES.VIDEO
  if (domainMatches(domain, SOCIAL_DOMAINS)) return ENTITY_TYPES.SOCIAL
  if (domainMatches(domain, MARKETPLACE_DOMAINS)) return ENTITY_TYPES.MARKETPLACE
  if (domainMatches(domain, DIRECTORY_DOMAINS)) return ENTITY_TYPES.DIRECTORY_OR_LIST

  const path = pathnameOf(url)
  if (path) {
    if (matchesAny(path, MARKETPLACE_PATH_PATTERNS)) return ENTITY_TYPES.MARKETPLACE
    if (matchesAny(path, DIRECTORY_PATH_PATTERNS)) return ENTITY_TYPES.DIRECTORY_OR_LIST
    if (matchesAny(path, ARTICLE_PATH_PATTERNS)) return ENTITY_TYPES.ARTICLE
  }

  const text = normalizeSearchText(`${title || ''} ${snippet || ''}`)
  const hasProductionSelfId = hasAny(text, PRODUCTION_SELF_ID_WORDS)
  // Section K: "قیمت و خرید"/"بانک اطلاعات" only count as a marketplace/
  // directory signal when the page does NOT also self-identify as a
  // producer/maker - a real manufacturer selling its own products keeps its
  // direct_company identity.
  if (hasAny(text, STANDALONE_MARKETPLACE_PHRASES) && !hasProductionSelfId) return ENTITY_TYPES.MARKETPLACE
  if (hasAny(text, STANDALONE_DIRECTORY_PHRASES) && !hasProductionSelfId) return ENTITY_TYPES.DIRECTORY_OR_LIST
  if (hasAny(text, UNGUARDED_DIRECTORY_PHRASES)) return ENTITY_TYPES.DIRECTORY_OR_LIST
  if (hasAny(text, STANDALONE_ARTICLE_PHRASES)) return ENTITY_TYPES.ARTICLE
  if (hasAny(text, LISTICLE_MARKER_WORDS) && hasAny(text, ENTITY_WORDS)) return ENTITY_TYPES.ARTICLE
  if (hasAny(text, AMBIGUOUS_INTRO_WORDS) && hasAny(text, PLURAL_ENTITY_WORDS)) return ENTITY_TYPES.ARTICLE
  if (hasAny(text, DIRECTORY_MARKER_WORDS) && hasAny(text, ENTITY_WORDS)) return ENTITY_TYPES.DIRECTORY_OR_LIST

  // No red flag found in the domain, URL path, or title/snippet text. A
  // domain that isn't a known aggregator/social/video/directory platform,
  // whose URL path doesn't look like a listing/article, and whose
  // title/snippet doesn't read like a roundup - only THEN is it treated as
  // the result's own site (see the 23D.1 header note: a domain existing is
  // no longer, by itself, sufficient - it must also clear every one of the
  // negative checks above).
  if (domain) return ENTITY_TYPES.DIRECT_COMPANY
  return ENTITY_TYPES.UNKNOWN
}

export function isNonCompanyEntityType(entityType) {
  return (
    entityType === ENTITY_TYPES.DIRECTORY_OR_LIST ||
    entityType === ENTITY_TYPES.ARTICLE ||
    entityType === ENTITY_TYPES.MARKETPLACE ||
    entityType === ENTITY_TYPES.SOCIAL ||
    entityType === ENTITY_TYPES.VIDEO
  )
}

// Used by serperSearch.js to keep a listicle/directory page's own headline
// from being presented as if it were a company's name (spec item 7) -
// exported separately so the adapter doesn't need to re-derive the same
// domain-vs-text logic classifyEntityType already encapsulates.
export function looksLikeNonCompanyTitle({ domain, title, snippet, url }) {
  return isNonCompanyEntityType(classifyEntityType({ domain, title, snippet, url }))
}
