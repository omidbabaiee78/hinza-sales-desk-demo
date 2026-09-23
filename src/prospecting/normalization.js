import { normalizeDigits } from '../utils/leadImport/digits.js'
import { extractIranianContactNumbers } from '../utils/leadImport/contactNumbers.js'
import { toE164Iran } from '../utils/phone.js'

// ---------------------------------------------------------------------------
// Phase 23 - entity normalization. The ONE place company-name/contact
// normalization for the prospecting engine lives, so dedup, evidence
// extraction and display all use the exact same canonical forms.
// Deliberately reuses the existing Iranian phone/digit normalizers
// (utils/phone.js, utils/leadImport/*) rather than a second parallel
// implementation.
// ---------------------------------------------------------------------------

const ARABIC_TO_PERSIAN = { ي: 'ی', ك: 'ک', ة: 'ه', ۀ: 'ه', ٱ: 'ا', أ: 'ا', إ: 'ا', ؤ: 'و', ئ: 'ی' }
const ARABIC_CHAR_CLASS = /[يكةۀٱأإؤئ]/g
const DIACRITICS_REGEX = /[ً-ٰٟ]/g
const ZWNJ_REGEX = /‌/g
const PARENTHETICAL_REGEX = /\([^)]*\)/g

// Legal-form boilerplate only (never a business-descriptive word like
// "تولیدی"/"صنایع"/"بازرگانی" - those carry real evidence/industry meaning
// and must survive into canonical_name and business_description as-is).
//
// Multi-word phrases are removed by plain substring replace; single words
// are removed by exact token match after splitting - NOT by `\b` regex word
// boundaries, which only recognize ASCII [A-Za-z0-9_] as "word characters"
// and therefore never match around Persian/Arabic letters at all (a
// `\bشرکت\b` pattern silently matches nothing, ever).
const LEGAL_FORM_PHRASES = ['سهامی خاص', 'سهامی عام', 'با مسئولیت محدود']
const LEGAL_FORM_WORDS = new Set(['شرکت', 'تعاونی', 'holding', 'group', 'co', 'corp', 'corporation', 'ltd', 'llc', 'inc', 'plc'])

function mapArabicChars(text) {
  return text.replace(ARABIC_CHAR_CLASS, (ch) => ARABIC_TO_PERSIAN[ch] || ch)
}

function baseClean(text) {
  let t = normalizeDigits(String(text ?? ''))
  t = mapArabicChars(t)
  t = t.replace(ZWNJ_REGEX, ' ')
  t = t.replace(DIACRITICS_REGEX, '')
  return t
}

// General-purpose search text normalization (for evidence/keyword matching
// against free text like business_description) - character/digit variants
// only, never strips real words the way normalizedNameKey does.
export function normalizeSearchText(text) {
  return baseClean(text).replace(/\s+/g, ' ').trim().toLowerCase()
}

// Display-facing cleanup only (fixes character variants/spacing) - never
// strips real words, never invents a name.
export function cleanCompanyName(rawName) {
  const t = baseClean(rawName)
    .replace(/\s+/g, ' ')
    .trim()
  return t
}

// Matching-only key - aggressively normalized (legal-form words, parens,
// punctuation, casing all stripped) so "صنایع پلاستیک امید (سهامی خاص)" and
// "صنایع پلاستیک امید" resolve to the same key. Never shown to the admin.
export function normalizedNameKey(rawName) {
  let t = baseClean(rawName)
  t = t.replace(PARENTHETICAL_REGEX, ' ')
  t = t.replace(/[؟?!.,،؛:;"'`ـ()[\]{}\-_/]/g, ' ')
  t = t.toLowerCase()
  for (const phrase of LEGAL_FORM_PHRASES) {
    t = t.split(phrase).join(' ')
  }
  const tokens = t.split(/\s+/).filter(Boolean).filter((tok) => !LEGAL_FORM_WORDS.has(tok))
  return tokens.join(' ')
}

// First valid mobile/landline found in arbitrary contact text - reuses the
// same extraction the lead-import pipeline already relies on, never a
// second regex set for "the same kind of Iranian phone number."
export function extractContactNumbers(text) {
  const { mobiles, landlines } = extractIranianContactNumbers(text)
  return {
    mobile: mobiles[0]?.display || null,
    phone: landlines[0]?.display || null,
    mobileKey: mobiles[0] ? toE164Iran(mobiles[0].key) : null,
    phoneKey: landlines[0]?.key || null,
  }
}

// Extracts a bare domain from a website/email value for matching -
// "https://www.example.com/fa" and "info@example.com" both key to
// "example.com". Returns null for anything that isn't a real host.
export function extractDomain(value) {
  if (!value) return null
  const text = String(value).trim()
  const emailMatch = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(text)
  if (emailMatch) return emailMatch[1].toLowerCase().replace(/^www\./, '')
  const urlMatch = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i.exec(text)
  return urlMatch ? urlMatch[1].toLowerCase() : null
}

export function normalizeEmail(value) {
  if (!value) return null
  const text = String(value).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null
}
