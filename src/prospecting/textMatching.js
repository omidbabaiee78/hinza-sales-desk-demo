import { normalizeSearchText } from './normalization.js'

// ---------------------------------------------------------------------------
// Phase 23D-FINAL, section B - a boundary/context-aware keyword matcher.
//
// The naive `text.includes(keyword)` used everywhere in this engine is
// unsafe for Persian: short, semantically loaded words are frequently a
// literal SUBSTRING of a completely different, unrelated word.
// "پزشک" (doctor) is a substring of "پزشکی" (medical/medicine) - a company
// describing "محصولات پلاستیکی پزشکی" (medical plastic products - a real,
// valuable manufacturing vertical) was being misread as mentioning a
// DOCTOR. The same pattern applies to "جراح"/"جراحی" (surgeon/surgery) and
// would recur for any future short negative-signal word.
//
// This module provides token/phrase-boundary matching: text is split into
// words on whitespace/punctuation, and a keyword only matches when its own
// words appear as an exact, contiguous, WHOLE-WORD sequence in that token
// stream - never as an accidental substring inside a longer, different
// word.
//
// Used for anything that can cause a DOWNGRADE or REJECTION (negative
// signals, non-buyer-organization signals, entity-type marker phrases) -
// a false trigger there actively suppresses a real prospect. POSITIVE
// signals (industryTaxonomy.js's TARGET_INDUSTRIES/MANUFACTURING_INDICATOR_
// TERMS/GENERIC_POLYMER_TERMS) deliberately keep the looser substring
// matcher (industryTaxonomy.js's own findMatchingKeywords) - a missed
// inflected form there (e.g. "نایلونی" not matching "نایلون") only ever
// costs a slightly lower score, never a rejection, so recall is preferred
// over precision on that side. See the Phase 23D-FINAL report's "false
// positive costs review time, false negative loses a real customer"
// principle for why the two sides of this asymmetry are each intentional.
// ---------------------------------------------------------------------------

const TOKEN_SPLIT_REGEX = /[\s،؛,.!?()«»"'\-_/\\|٫٬:]+/

export function tokenize(text) {
  return normalizeSearchText(text).split(TOKEN_SPLIT_REGEX).filter(Boolean)
}

function tokenSequenceAt(tokens, index, keywordTokens) {
  for (let j = 0; j < keywordTokens.length; j += 1) {
    if (tokens[index + j] !== keywordTokens[j]) return false
  }
  return true
}

function containsTokenPhrase(tokens, keywordTokens) {
  if (keywordTokens.length === 0) return false
  for (let i = 0; i <= tokens.length - keywordTokens.length; i += 1) {
    if (tokenSequenceAt(tokens, i, keywordTokens)) return true
  }
  return false
}

// Precision-oriented replacement for industryTaxonomy.js's
// findMatchingKeywords() - same call shape (text, keywords[]) -> matched
// keywords[], but exact word/phrase-boundary matching instead of substring.
export function findMatchingKeywordsStrict(text, keywords) {
  const tokens = tokenize(text)
  return keywords.filter((kw) => containsTokenPhrase(tokens, tokenize(kw)))
}

export function hasTokenPhrase(text, keyword) {
  return containsTokenPhrase(tokenize(text), tokenize(keyword))
}

// ---------------------------------------------------------------------------
// Phase 23D-FINAL, section G (originally in sourceAdapters/serperSearch.js) -
// a company almost always self-identifies SOMEWHERE in its own text - "X،
// تولیدکننده Y" (the company's own "X, maker of Y" self-description) or
// "شرکت X". Moved here in Phase 23D-FINAL.1 so BOTH the search-result title/
// snippet (serperSearch.js's normalize()) and a fetched first-party About/
// Contact page's own text (websiteEnrichment.js's identity verification, see
// identityResolution.js) run the exact same extraction, one place, instead
// of two independently-maintained copies.
// ---------------------------------------------------------------------------
const COMPANY_SELF_ID_PATTERNS = [
  // "X، تولیدکننده/تولید کننده/سازنده Y" - X = the actual brand name.
  // Deliberately NO trailing \b - it is ASCII-only ([A-Za-z0-9_]) and
  // silently never matches around Persian/Arabic letters at all.
  /^([^,،|:–—-]{2,60}?)[,،]\s*(?:تولیدکننده|تولید کننده|سازنده)/,
  // "شرکت [تولیدی] X" appearing anywhere in the combined text - the WHOLE
  // phrase including "شرکت" itself is kept (only normalizedNameKey strips
  // generic legal-form words, for matching purposes only, never a display
  // name).
  /(شرکت\s+(?:تولیدی\s+)?[^\s,،|:–—-][^,،|:–—-]{1,40})/,
]

export function resolveCompanySelfIdentity(text) {
  const combined = text || ''
  for (const pattern of COMPANY_SELF_ID_PATTERNS) {
    const match = combined.match(pattern)
    const name = match?.[1]?.trim()
    if (name && name.length >= 2 && name.length <= 60) return name
  }
  return null
}
