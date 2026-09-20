import { isValidIranMobile, toE164Iran } from '../phone.js'
import { normalizeDigits } from './digits.js'

// ---------------------------------------------------------------------------
// Centralized Iranian contact-number extraction - the ONE place phone/mobile
// regexes live for the import pipeline (standard table + both smart-mode
// patterns) and for the duplicate engine's key derivation. Never duplicated
// per-file; every caller imports from here.
//
// A "display" value is what the admin sees (readable, leading zero intact,
// original grouping/dashes kept where reasonably possible). A "key" is the
// canonical form used ONLY for duplicate comparison - never shown.
// ---------------------------------------------------------------------------

// Digits + every separator called out in the spec: - – — / \ , ، space ( )
const SEPARATOR_CLASS = '0-9\\-\\u2013\\u2014/\\\\,\\u060C()\\s'
const CONTACT_BLOB_REGEX = new RegExp(`[${SEPARATOR_CLASS}]{6,}`, 'g')
const HARD_SPLIT_REGEX = /[,،]/ // comma / Persian comma - always a boundary between distinct numbers
const RANGE_REGEX = /(0\d{2,3}[-\s]?\d{6,8})\s*تا\s*(\d{1,4})/g

function digitsOnly(text) {
  return String(text ?? '').replace(/\D/g, '')
}

// Restores a leading zero a numeric Excel cell may have dropped, ONLY when
// doing so makes the digits fit a recognizable Iranian mobile/landline
// shape - never prepended to an arbitrary number.
function withLeadingZeroRestored(digits) {
  if (digits.startsWith('0')) return digits
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}` // 98912... (12) -> 0912...
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}` // 912... (10) -> 0912...
  // A landline missing its leading zero (e.g. Excel stored "2144667800" as
  // a plain number). Only recovered for a length that, once the zero is
  // added, lands in a normal 10-11 digit Iranian landline - never for
  // short/ambiguous numbers (row numbers, postal codes, product codes).
  if (/^[1-8]\d{8,9}$/.test(digits)) return `0${digits}`
  return digits
}

export function classifyContactNumber(rawText) {
  const digits = withLeadingZeroRestored(digitsOnly(normalizeDigits(rawText)))
  if (isValidIranMobile(digits)) return 'mobile'
  if (digits.length >= 7 && digits.length <= 12 && digits.startsWith('0')) return 'landline'
  return null
}

// Canonical mobile key - 09xxxxxxxxx, 989xxxxxxxxx, +989xxxxxxxxx and
// 00989xxxxxxxxx all normalize to the exact same key.
export function normalizeMobileForComparison(rawText) {
  const digits = withLeadingZeroRestored(digitsOnly(normalizeDigits(rawText)))
  return isValidIranMobile(digits) ? toE164Iran(digits) : ''
}

// Canonical landline key - digits only, leading zero restored when safe.
export function normalizeLandlineForComparison(rawText) {
  const digits = withLeadingZeroRestored(digitsOnly(normalizeDigits(rawText)))
  if (isValidIranMobile(digits)) return '' // a mobile, not a landline
  return digits.length >= 7 && digits.length <= 12 && digits.startsWith('0') ? digits : ''
}

// Readable display form - leading zero restored when the source was a
// numeric Excel cell that dropped it, original dash grouping kept
// otherwise. Mobile numbers always group as 0XXX-XXXXXXX (4+7, the fixed
// Iranian mobile shape); a recovered landline is left as a plain digit
// string rather than guessing where its (variable-length) area code ends.
function formatDisplay(rawText, type) {
  const trimmed = String(rawText ?? '').trim()
  const digits = digitsOnly(normalizeDigits(trimmed))
  const restored = withLeadingZeroRestored(digits)
  if (restored === digits) return normalizeDigits(trimmed).trim() // nothing recovered, keep as typed
  if (type === 'mobile' && restored.length === 11) return `${restored.slice(0, 4)}-${restored.slice(4)}`
  return restored
}

function formatLandlineFromDigits(digits, referenceDisplay) {
  if (referenceDisplay) {
    const dashIndex = referenceDisplay.indexOf('-')
    if (dashIndex > 0) {
      const prefixLen = digitsOnly(referenceDisplay.slice(0, dashIndex)).length
      if (prefixLen > 0 && prefixLen < digits.length) {
        return `${digits.slice(0, prefixLen)}-${digits.slice(prefixLen)}`
      }
    }
  }
  return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits
}

// "021-44922581 تا 83" -> 021-44922581/82/83, but ONLY when the shorthand
// suffix unambiguously continues the base number's own tail digits and the
// resulting run is small. Anything less clear falls back to just the base
// number, never an invented range - "never hallucinate telephone numbers."
function expandRangeShorthand(text) {
  const matches = []
  const consumedSpans = []
  let match
  RANGE_REGEX.lastIndex = 0
  while ((match = RANGE_REGEX.exec(text)) !== null) {
    consumedSpans.push([match.index, match.index + match[0].length])
    const base = match[1]
    const suffix = match[2]
    const baseDigits = digitsOnly(base)
    const prefixLen = baseDigits.length - suffix.length

    if (prefixLen > 0) {
      const basePrefix = baseDigits.slice(0, prefixLen)
      const baseTail = Number(baseDigits.slice(prefixLen))
      const suffixNum = Number(suffix)
      if (!Number.isNaN(baseTail) && !Number.isNaN(suffixNum) && suffixNum > baseTail && suffixNum - baseTail <= 9) {
        for (let n = baseTail; n <= suffixNum; n++) {
          const digits = basePrefix + String(n).padStart(suffix.length, '0')
          if (classifyContactNumber(digits) === 'landline') {
            matches.push({ type: 'landline', display: formatLandlineFromDigits(digits, base), key: digits })
          }
        }
        continue
      }
    }

    // Low confidence - keep only the base number, exactly as written,
    // instead of guessing what the shorthand meant.
    if (classifyContactNumber(baseDigits) === 'landline') {
      matches.push({ type: 'landline', display: base.trim(), key: baseDigits })
    }
  }
  return { matches, consumedSpans }
}

function removeSpans(text, spans) {
  if (spans.length === 0) return text
  let result = ''
  let cursor = 0
  for (const [start, end] of spans) {
    result += text.slice(cursor, start)
    cursor = end
  }
  result += text.slice(cursor)
  return result
}

// If one un-split blob is two numbers typed with just a space between them
// (no comma) - e.g. "02133632070 02133632071" - digit count alone can't
// distinguish that from one long garbage run, so this ONLY fires for a
// total that's exactly two standard Iranian numbers concatenated (10 or 11
// digits each) and only tries cuts at those exact lengths. This avoids the
// off-by-one risk of a looser split (which could otherwise produce a
// truncated, wrong number on one side while the other still "validates").
function trySplitOverlongBlob(blob) {
  const digits = digitsOnly(blob)
  if (digits.length < 20 || digits.length > 22) return null
  for (const cut of [10, 11]) {
    if (cut >= digits.length) continue
    const left = digits.slice(0, cut)
    const right = digits.slice(cut)
    if ((right.length === 10 || right.length === 11) && classifyContactNumber(left) && classifyContactNumber(right)) {
      return [left, right]
    }
  }
  return null
}

// Scans arbitrary text (one cell, or several cells joined together) for
// EVERY Iranian mobile/landline number it contains - never just the first
// one - handling embedded labels ("دفتر: 026-...", "همراه 0912..."), mixed
// separators, and the "X تا Y" range shorthand. Returns deduplicated
// { mobiles: [{display key}], landlines: [{display key}] }.
export function extractIranianContactNumbers(text) {
  const source = normalizeDigits(String(text ?? ''))
  const mobiles = new Map()
  const landlines = new Map()

  function add(type, display, key) {
    if (!key) return
    const map = type === 'mobile' ? mobiles : landlines
    if (!map.has(key)) map.set(key, display.trim())
  }

  const { matches: rangeMatches, consumedSpans } = expandRangeShorthand(source)
  for (const m of rangeMatches) add(m.type, m.display, m.key)

  const remaining = removeSpans(source, consumedSpans)
  const blobs = remaining.match(CONTACT_BLOB_REGEX) || []

  for (const rawBlob of blobs) {
    const subBlobs = rawBlob.split(HARD_SPLIT_REGEX).map((s) => s.trim()).filter(Boolean)
    for (const subBlob of subBlobs) {
      const split = trySplitOverlongBlob(subBlob)
      const candidates = split || [subBlob]
      for (const candidate of candidates) {
        const type = classifyContactNumber(candidate)
        if (!type) continue
        if (type === 'mobile') {
          add('mobile', formatDisplay(candidate, 'mobile'), normalizeMobileForComparison(candidate))
        } else {
          add('landline', formatDisplay(candidate, 'landline'), normalizeLandlineForComparison(candidate))
        }
      }
    }
  }

  return {
    mobiles: [...mobiles.entries()].map(([key, display]) => ({ display, key })),
    landlines: [...landlines.entries()].map(([key, display]) => ({ display, key })),
  }
}

const DISPLAY_JOINER = '، '

export function joinContactDisplay(values) {
  return values.filter(Boolean).join(DISPLAY_JOINER)
}

// Merges several { display, key } lists (e.g. numbers found in different
// cells of the same row) into one, deduplicated by key - the same number
// showing up in two cells must not be listed twice.
export function dedupeContactList(list) {
  const map = new Map()
  for (const item of list) {
    if (item.key && !map.has(item.key)) map.set(item.key, item.display)
  }
  return [...map.entries()].map(([key, display]) => ({ key, display }))
}

// Inverse of joinContactDisplay - splits a stored/display field (which may
// hold one or several numbers) back into individual raw components, for
// deriving per-number duplicate keys from an EXISTING lead's mobile/phone
// column. Falls back to comma/Persian-comma splitting for values that
// weren't written by this pipeline.
export function splitContactDisplay(value) {
  if (!value) return []
  return String(value)
    .split(/[،,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
