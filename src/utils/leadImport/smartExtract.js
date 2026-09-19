import { ALIAS_ENTRIES_BY_LENGTH } from './columnAliases'
import { extractIranianContactNumbers } from './contactNumbers'

// A cell like "شرکت، پاکسان" or "تلفن ثابت درج‌شده، 021-64566..." splits at
// the FIRST of these - order matters only for readability, the regex tries
// them all at once and takes the earliest match.
const LABEL_SEPARATOR_REGEX = /[،,:\-–]/

// Whether `label` (already trimmed) identifies one of our known fields -
// exact match, or `label` starts with a known alias FOLLOWED BY A WORD
// BOUNDARY (a space) - covers real-world suffixes like "تلفن ثابت درج‌شده"
// starting with the alias "تلفن ثابت درج‌شده"/"تلفن ثابت", while never
// letting a short alias like "شهر" match inside an unrelated word such as
// "شهرک صنعتی" (a plain character-prefix check would wrongly fire there).
// Aliases are tried longest-first so "تلفن همراه" (mobile) is preferred
// over the shorter "تلفن" (phone) when both would otherwise match.
function matchAliasField(label) {
  const normalized = label.trim().toLowerCase()
  if (!normalized) return null
  for (const [alias, field] of ALIAS_ENTRIES_BY_LENGTH) {
    if (normalized === alias || normalized.startsWith(`${alias} `)) return field
  }
  return null
}

// Splits a single cell's text into { field, rawValue } when its leading
// text is a recognized field label - e.g. "محصولات، شوینده خانگی و صنعتی"
// -> { field: 'need_note', rawValue: 'شوینده خانگی و صنعتی' }. Returns null
// (never a guess) when no known label is found at the start of the cell.
export function parseLabelValueCell(cellText) {
  const text = String(cellText ?? '').trim()
  if (!text) return null
  const separatorMatch = text.match(LABEL_SEPARATOR_REGEX)
  if (!separatorMatch) return null

  const label = text.slice(0, separatorMatch.index)
  const field = matchAliasField(label)
  if (!field) return null

  const rawValue = text.slice(separatorMatch.index + 1).trim()
  if (!rawValue) return null
  return { field, rawValue, matchedVia: 'label' }
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export function extractEmailFromText(text) {
  const match = String(text ?? '').match(EMAIL_REGEX)
  return match ? match[0] : null
}

// Bare domain, with or without protocol/www - deliberately requires a
// letters-only TLD of 2+ chars so it never fires on things like "8."
const WEBSITE_REGEX = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?(?:\/[^\s,،]*)?/

export function extractWebsiteFromText(text) {
  if (EMAIL_REGEX.test(text)) return null // an email already claims this cell
  const match = String(text ?? '').match(WEBSITE_REGEX)
  return match ? match[0] : null
}

// No label found - last resort, structural-pattern-only recognition for a
// SINGLE cell with no label prefix. Phone/mobile detection itself is fully
// centralized in contactNumbers.js's extractIranianContactNumbers (blob-
// aware, so it correctly finds a number embedded in surrounding descriptive
// text like "کارخانه ... تلفن 021-64566..." rather than naively stripping
// every digit out of the whole sentence). This just asks "does this cell
// contain ANY recognizable number, and which kind" - rawValue is the whole
// cell text, which normalizeCanonicalField re-scans to actually extract
// it (and every OTHER number the cell might contain - never just the
// first). Tried in a fixed order so a cell is never double-classified.
// Every match here downgrades the resulting record's parse confidence.
export function matchFallbackPattern(cellText) {
  const text = String(cellText ?? '').trim()
  if (!text) return null

  const { mobiles, landlines } = extractIranianContactNumbers(text)
  if (mobiles.length > 0) return { field: 'mobile', rawValue: text, matchedVia: 'pattern' }

  const email = extractEmailFromText(text)
  if (email) return { field: 'email', rawValue: email, matchedVia: 'pattern' }

  const website = extractWebsiteFromText(text)
  if (website) return { field: 'website', rawValue: website, matchedVia: 'pattern' }

  if (landlines.length > 0) return { field: 'phone', rawValue: text, matchedVia: 'pattern' }

  return null
}
