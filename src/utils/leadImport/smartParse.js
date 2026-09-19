import { CANONICAL_LEAD_FIELDS, resolveLeadColumnKey } from './columnAliases'
import { normalizeCanonicalField, normalizeDigits, normalizeTextField } from './normalize'
import { CONTACT_QUALITY_LABELS, computeContactQuality, computePresentFields } from './buildRows'
import { dedupeContactList, extractIranianContactNumbers, joinContactDisplay } from './contactNumbers'
import { extractEmailFromText, extractWebsiteFromText, matchFallbackPattern, parseLabelValueCell } from './smartExtract'

export { CONTACT_QUALITY_LABELS }

// ---------------------------------------------------------------------------
// Mode detection - decides whether a file looks like a clean table (a
// confident header row, columns as columns) or a messy semi-structured
// export (label/value text packed into cells, or repeated numbered rows -
// see buildSmartRecords below). Never changes standard-table behavior: a
// normal file always detects 'standard'.
// ---------------------------------------------------------------------------

export function detectImportMode(fullGridRows) {
  const headerRow = fullGridRows[0] || []
  const headerCells = headerRow.map((c) => String(c ?? '').trim()).filter(Boolean)
  if (headerCells.length === 0) return { mode: 'smart', matchedHeaderFields: 0, headerMatchRatio: 0, bodyLabelRatio: 0 }

  let matchedHeaderFields = 0
  let labelValueLikeHeaderCells = 0
  for (const cell of headerCells) {
    if (resolveLeadColumnKey(cell)) matchedHeaderFields++
    else if (parseLabelValueCell(cell)) labelValueLikeHeaderCells++
  }
  const headerMatchRatio = matchedHeaderFields / headerCells.length

  // Peek at a few body rows too - a file can have a plausible-looking
  // header row while its data rows still pack "label، value" text into
  // cells (the real-world case this feature targets).
  let labelValueBodyCells = 0
  let totalBodyCells = 0
  for (const row of fullGridRows.slice(1, 6)) {
    for (const cell of row || []) {
      const text = String(cell ?? '').trim()
      if (!text) continue
      totalBodyCells++
      if (parseLabelValueCell(text)) labelValueBodyCells++
    }
  }
  const bodyLabelRatio = totalBodyCells > 0 ? labelValueBodyCells / totalBodyCells : 0

  const standardConfident =
    matchedHeaderFields >= 2 && headerMatchRatio >= 0.4 && labelValueLikeHeaderCells === 0 && bodyLabelRatio < 0.2

  return {
    mode: standardConfident ? 'standard' : 'smart',
    matchedHeaderFields,
    headerMatchRatio,
    bodyLabelRatio,
  }
}

// ---------------------------------------------------------------------------
// Smart semi-structured record reconstruction - shared building blocks.
// ---------------------------------------------------------------------------

export const CONFIDENCE_LABELS = { high: 'بالا', medium: 'متوسط', needs_review: 'نیازمند بررسی' }

// A small, deliberately bounded whitelist - city is only ever split off an
// address when the leading segment exactly matches a known city, never
// guessed. Everything else stays in `address` untouched.
const KNOWN_CITIES = [
  'تهران', 'کرج', 'قزوین', 'اصفهان', 'مشهد', 'شیراز', 'تبریز', 'اهواز', 'قم', 'رشت',
  'کرمانشاه', 'یزد', 'اراک', 'زنجان', 'همدان', 'ساری', 'بندرعباس', 'کرمان', 'اردبیل', 'گرگان',
  'سنندج', 'ارومیه', 'بوشهر', 'یاسوج', 'ایلام', 'بیرجند', 'سمنان', 'خرم آباد', 'شهرکرد', 'زاهدان',
]
const KNOWN_CITY_SET = new Set(KNOWN_CITIES)

function splitCityFromAddress(addressText) {
  const parts = addressText.split(/[،,]/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0 || !KNOWN_CITY_SET.has(parts[0])) return null
  // A location cell that's JUST a city name ("تهران", no further address
  // text) still counts - city is extracted, address is left empty rather
  // than never being split at all.
  if (parts.length === 1) return { city: parts[0], address: null }
  return { city: parts[0], address: parts.slice(1).join('، ') || null }
}

// Safe, whitelist-gated only - never invents a city that isn't on the
// known list, per the "never hallucinate missing city" rule.
function applyCitySplit(fields) {
  if (!fields.address || fields.city) return
  const split = splitCityFromAddress(fields.address)
  if (split) {
    fields.city = split.city
    fields.address = split.address
  }
}

function mergeLeftoverText(fields, text) {
  if (!text) return
  if (!fields.need_note) fields.need_note = text
  else fields.notes = fields.notes ? `${fields.notes} - ${text}` : text
}

function computeConfidence(flags) {
  if (flags.continuationMerge) return 'needs_review'
  if (!flags.hasCompanyName && !flags.hasContactName) return 'needs_review'
  if (!flags.hasCompanyName && flags.hasContactName) return 'medium'
  if (flags.usedFallbackPattern || flags.mergedLeftoverText || flags.crossRowFieldMerge) return 'medium'
  return 'high'
}

function recomputeRecordMeta(record) {
  record.presentFields = computePresentFields(record.fields)
  record.contactInfoIncomplete = !(record.fields.mobile || record.fields.phone || record.fields.email || record.fields.website)
  record.contactQuality = computeContactQuality(record.fields)
  record.confidence = computeConfidence(record.confidenceFlags)
}

function blankFields() {
  const fields = {}
  for (const field of CANONICAL_LEAD_FIELDS) fields[field] = field === 'tags' ? [] : null
  return fields
}

function blankMatchKeys() {
  return { mobile: [], phone: [], email: [], website: [], externalRef: [] }
}

// Splits a row's raw cells into { recognized, leftover } - `recognized` is
// every cell that resolved to a known field (via an explicit label, or,
// failing that, a structural pattern like a phone/email/domain), `leftover`
// is everything else. Shared by the label/value reconstruction and by the
// positional engine's fallback for a row that doesn't fit the sheet's
// dominant shape.
function classifyRowCells(cells) {
  const recognized = []
  const leftover = []
  for (const cellText of cells) {
    const parsed = parseLabelValueCell(cellText) || matchFallbackPattern(cellText)
    if (parsed) recognized.push(parsed)
    else leftover.push(cellText)
  }
  return { recognized, leftover }
}

// mobile/phone accumulate across every recognized cell for that field (a
// row can legitimately list more than one number) - every OTHER field
// keeps "first cell wins", since a row realistically has one company name,
// one email, etc.
function buildFieldsFromRecognizedCells(recognized) {
  const rawByField = {}
  const matchedViaByField = {}
  const multiRaw = { mobile: [], phone: [] }
  let usedFallbackPattern = false

  for (const { field, rawValue, matchedVia } of recognized) {
    if (field === 'mobile' || field === 'phone') {
      multiRaw[field].push(rawValue)
      if (matchedVia === 'pattern') usedFallbackPattern = true
      continue
    }
    if (rawByField[field] !== undefined) continue
    rawByField[field] = rawValue
    matchedViaByField[field] = matchedVia
  }

  const fields = blankFields()
  const matchKeys = blankMatchKeys()
  const errors = []

  for (const contactField of ['mobile', 'phone']) {
    if (multiRaw[contactField].length === 0) continue
    const { value, matchKeys: keys, error } = normalizeCanonicalField(contactField, multiRaw[contactField].join(' ، '))
    fields[contactField] = value
    matchKeys[contactField] = keys
    if (error) errors.push(error)
  }

  for (const field of CANONICAL_LEAD_FIELDS) {
    if (field === 'mobile' || field === 'phone') continue
    if (rawByField[field] === undefined) continue
    const { value, matchKeys: keys, error } = normalizeCanonicalField(field, rawByField[field])
    fields[field] = value
    if (error) errors.push(error)
    if (matchedViaByField[field] === 'pattern') usedFallbackPattern = true
    if (field === 'email') matchKeys.email = keys
    if (field === 'website') matchKeys.website = keys
    if (field === 'external_ref') matchKeys.externalRef = keys
  }

  applyCitySplit(fields)

  return { fields, matchKeys, errors, usedFallbackPattern }
}

function buildRecordFromRow(rowNumber, recognized, leftover, cells) {
  const { fields, matchKeys, errors, usedFallbackPattern } = buildFieldsFromRecognizedCells(recognized)

  const mergedLeftoverText = leftover.length > 0
  if (mergedLeftoverText) mergeLeftoverText(fields, leftover.join(' - '))

  if (!fields.company_name && !fields.contact_name) {
    errors.push('نام شرکت یا نام شخص تماس الزامی است.')
  }

  const record = {
    rowNumber,
    errors,
    contactInfoIncomplete: false,
    contactQuality: null,
    fields,
    presentFields: null,
    matchKeys,
    confidenceFlags: {
      hasCompanyName: Boolean(fields.company_name),
      hasContactName: Boolean(fields.contact_name),
      usedFallbackPattern,
      mergedLeftoverText,
      crossRowFieldMerge: false,
      continuationMerge: false,
    },
    confidence: null,
    rawExcerpt: cells.join(' | ').slice(0, 240),
  }
  recomputeRecordMeta(record)
  return record
}

// Folds a later row's recognized fields into an already-open record (the
// "MULTI-CELL RECORDS" case where a company's fields wrap across several
// rows, not just several columns of one row). mobile/phone ACCUMULATE (a
// number found on a later row is added to, never replaces, one already on
// the record); every other field keeps first-occurrence-wins, so a later
// row never overwrites data the record already has.
function mergeRecognizedIntoRecord(record, recognized, leftover) {
  let addedField = false
  const multiRaw = { mobile: [], phone: [] }

  for (const { field, rawValue, matchedVia } of recognized) {
    if (field === 'mobile' || field === 'phone') {
      multiRaw[field].push(rawValue)
      if (matchedVia === 'pattern') record.confidenceFlags.usedFallbackPattern = true
      addedField = true
      continue
    }
    if (record.presentFields.has(field)) continue
    const { value, matchKeys, error } = normalizeCanonicalField(field, rawValue)
    const isEmpty = value == null || (Array.isArray(value) && value.length === 0)
    if (isEmpty) continue
    record.fields[field] = value
    if (error) record.errors.push(error)
    if (matchedVia === 'pattern') record.confidenceFlags.usedFallbackPattern = true
    if (field === 'email') record.matchKeys.email = matchKeys
    if (field === 'website') record.matchKeys.website = matchKeys
    if (field === 'external_ref') record.matchKeys.externalRef = matchKeys
    addedField = true
  }

  for (const contactField of ['mobile', 'phone']) {
    if (multiRaw[contactField].length === 0) continue
    const existingDisplay = record.fields[contactField]
    const combinedRaw = existingDisplay ? `${existingDisplay} ، ${multiRaw[contactField].join(' ، ')}` : multiRaw[contactField].join(' ، ')
    const { value, matchKeys } = normalizeCanonicalField(contactField, combinedRaw)
    record.fields[contactField] = value
    record.matchKeys[contactField] = matchKeys
  }

  if (leftover.length > 0) {
    mergeLeftoverText(record.fields, leftover.join(' - '))
    record.confidenceFlags.mergedLeftoverText = true
  }
  if (addedField) record.confidenceFlags.crossRowFieldMerge = true
  applyCitySplit(record.fields)
  recomputeRecordMeta(record)
}

// ---------------------------------------------------------------------------
// Non-record row detection - a header ("ردیف | شرکت | محصولات | ...", every
// cell just naming a field with no actual value) or a title/preamble
// sentence ("تبدیل فهرست قبلی به اکسل...") is recognized the SAME way in
// both patterns below: it fits neither the numbered-positional shape nor
// contains any real structural signal (no label match, no phone/email/
// website pattern anywhere in the row) - classifyRowCells finding ZERO
// recognized cells for such a row is exactly that condition, so no separate
// "is this a header word" dictionary is needed beyond the alias lookup
// classifyRowCells already uses.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pattern B: label/value cells (e.g. "شرکت، پاکسان"). company_name/
// contact_name is the record-boundary signal: a row that introduces one
// starts a new record, and every following row (more label cells, a bare
// phone number, wrapped free text) folds into that same open record until a
// blank separator row or the next identity cell.
// ---------------------------------------------------------------------------

function buildLabelValueRecords(fullGridRows) {
  const records = []
  const ignoredRows = []
  let openRecord = null
  let titleCandidate = ''

  fullGridRows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1
    const cells = (row || []).map((c) => String(c ?? '').trim()).filter(Boolean)

    if (cells.length === 0) {
      openRecord = null
      return
    }

    const { recognized, leftover } = classifyRowCells(cells)
    const startsNewRecord = recognized.some((r) => r.field === 'company_name' || r.field === 'contact_name')

    if (recognized.length === 0) {
      if (openRecord) {
        mergeLeftoverText(openRecord.fields, leftover.join(' - '))
        openRecord.confidenceFlags.continuationMerge = true
        recomputeRecordMeta(openRecord)
        return
      }
      // No positional/label signal at all - a header or title/preamble
      // row, never a lead. Tallied separately (never خطا).
      const candidate = leftover.join(' ').trim()
      ignoredRows.push({ rowNumber, rawExcerpt: candidate.slice(0, 240) })
      if (records.length === 0 && candidate.length > titleCandidate.length) titleCandidate = candidate
      return
    }

    if (!startsNewRecord && openRecord) {
      mergeRecognizedIntoRecord(openRecord, recognized, leftover)
      return
    }

    // A fresh identity row, or recognized fields with no open record to
    // attach to - built transparently either way (even a phone-only row
    // with no identity becomes a visible خطا row rather than silently
    // vanishing, so the admin can see exactly what was found).
    const record = buildRecordFromRow(rowNumber, recognized, leftover, cells)
    records.push(record)
    openRecord = record.errors.length === 0 ? record : null
  })

  return { records, titleCandidate, ignoredRows }
}

// ---------------------------------------------------------------------------
// Pattern C: repeated numbered positional records, e.g.
//   "1 | پاکسان | شوینده خانگی و صنعتی، صابون | تهران... | 021... | 021..."
// No label words anywhere - fields are inferred by POSITION, not text.
// ---------------------------------------------------------------------------

// A bare integer and nothing else - "1", "24", "۱۲" (after digit
// normalization) - never a cell that merely contains a number, which would
// wrongly catch things like "کیلومتر 8" or a phone number.
function isBareSequenceNumber(cellText) {
  const digits = normalizeDigits(String(cellText ?? '')).trim()
  return /^\d{1,4}$/.test(digits)
}

// Whole-sheet check (never per-row): does this file look dominated by rows
// shaped like "seq | company | product | location | ...", repeated? Only
// trusts this shape when a healthy majority of multi-cell rows fit it -
// one or two incidental numbered cells elsewhere in a differently-shaped
// file must never flip the whole sheet into positional mode.
function detectPositionalStructure(fullGridRows) {
  const candidateRows = fullGridRows
    .map((row) => (row || []).map((c) => String(c ?? '').trim()).filter(Boolean))
    .filter((cells) => cells.length >= 3)

  if (candidateRows.length === 0) {
    return { isPositional: false, matchingRows: 0, totalCandidateRows: 0 }
  }

  const matching = candidateRows.filter((cells) => isBareSequenceNumber(cells[0]))
  const ratio = matching.length / candidateRows.length
  const isPositional = matching.length >= 5 && ratio >= 0.6

  return { isPositional, matchingRows: matching.length, totalCandidateRows: candidateRows.length }
}

// One numbered row -> one record, fields read by fixed position for the
// first few columns (company, product/need, location) and by CONTENT
// pattern (never position) for everything after that, since phone/email/
// website can appear in any order/column, and a row may list more than one
// phone/mobile number across its trailing cells - ALL of them are kept,
// never just the first.
function buildPositionalRecord(rowNumber, cells) {
  // cells[0] is the admin's own row/sequence number - pure noise, discarded
  // here. It is NOT written to source_row_number: that field keeps its
  // existing, unrelated meaning ("which physical sheet row this lead came
  // from", used for import-batch audit) everywhere else in the pipeline.
  const [, companyCell, productCell, locationCell, ...restCells] = cells

  const fields = blankFields()
  fields.company_name = normalizeTextField(companyCell)
  fields.need_note = normalizeTextField(productCell)

  if (locationCell) {
    fields.address = normalizeTextField(locationCell)
    applyCitySplit(fields)
  }

  const matchKeys = blankMatchKeys()
  const mobiles = []
  const landlines = []
  let email = null
  let website = null
  const extraNotes = []

  // Content-pattern detection here is the DESIGNED mechanism of this whole
  // pattern (not a degraded fallback the way it is in label/value mode), so
  // it deliberately never sets usedFallbackPattern - a cleanly-matching
  // positional row can still reach 'high' confidence. Only genuinely
  // unclassified trailing content (below) counts as uncertainty. Every
  // trailing cell is scanned for BOTH mobile and landline numbers (a cell
  // like "021-33632070، 021-33632071" or two separate phone cells both
  // contribute) rather than stopping at the first number found.
  for (const cellText of restCells) {
    const contacts = extractIranianContactNumbers(cellText)
    let consumed = false
    if (contacts.mobiles.length > 0) {
      mobiles.push(...contacts.mobiles)
      consumed = true
    }
    if (contacts.landlines.length > 0) {
      landlines.push(...contacts.landlines)
      consumed = true
    }
    if (!email) {
      const foundEmail = extractEmailFromText(cellText)
      if (foundEmail) {
        email = foundEmail
        consumed = true
      }
    }
    if (!website) {
      const foundWebsite = extractWebsiteFromText(cellText)
      if (foundWebsite) {
        website = foundWebsite
        consumed = true
      }
    }
    if (!consumed) extraNotes.push(cellText)
  }

  if (mobiles.length > 0) {
    const unique = dedupeContactList(mobiles)
    fields.mobile = joinContactDisplay(unique.map((m) => m.display))
    matchKeys.mobile = unique.map((m) => m.key)
  }
  if (landlines.length > 0) {
    const unique = dedupeContactList(landlines)
    fields.phone = joinContactDisplay(unique.map((l) => l.display))
    matchKeys.phone = unique.map((l) => l.key)
  }
  if (email) {
    const { value, matchKeys: keys } = normalizeCanonicalField('email', email)
    fields.email = value
    matchKeys.email = keys
  }
  if (website) {
    const { value, matchKeys: keys } = normalizeCanonicalField('website', website)
    fields.website = value
    matchKeys.website = keys
  }
  if (extraNotes.length > 0) fields.notes = extraNotes.join(' - ')

  const errors = []
  if (!fields.company_name && !fields.contact_name) {
    errors.push('نام شرکت یا نام شخص تماس الزامی است.')
  }

  const record = {
    rowNumber,
    errors,
    contactInfoIncomplete: false,
    contactQuality: null,
    fields,
    presentFields: null,
    matchKeys,
    confidenceFlags: {
      hasCompanyName: Boolean(fields.company_name),
      hasContactName: Boolean(fields.contact_name),
      usedFallbackPattern: false,
      mergedLeftoverText: extraNotes.length > 0,
      crossRowFieldMerge: false,
      continuationMerge: false,
    },
    confidence: null,
    rawExcerpt: cells.join(' | ').slice(0, 240),
  }
  recomputeRecordMeta(record)
  return record
}

function buildPositionalRecords(fullGridRows) {
  const records = []
  const ignoredRows = []
  let titleCandidate = ''

  fullGridRows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1
    const cells = (row || []).map((c) => String(c ?? '').trim()).filter(Boolean)

    if (cells.length === 0) return

    if (cells.length >= 2 && isBareSequenceNumber(cells[0])) {
      records.push(buildPositionalRecord(rowNumber, cells))
      return
    }

    const { recognized, leftover } = classifyRowCells(cells)

    if (recognized.length === 0) {
      // Doesn't fit the sheet's dominant numbered-row shape AND has no
      // recognizable structure at all (no label, no phone/email/website
      // anywhere in it) - a header row ("ردیف | شرکت | محصولات | ...") or a
      // title/preamble sentence, never a lead. Tallied separately as
      // "نادیده گرفته‌شده", never counted as خطا/نیازمند بررسی/جدید.
      const candidate = cells.join(' ').trim()
      ignoredRows.push({ rowNumber, rawExcerpt: candidate.slice(0, 240) })
      if (records.length === 0 && candidate.length > titleCandidate.length) titleCandidate = candidate
      return
    }

    // Has SOME real structural signal (a label, or a phone/email/website)
    // but didn't fit the dominant numbered shape - possibly a genuine, if
    // malformed, lead. Read generically instead of discarding, always
    // flagged for review, but never failing the other rows that DO fit.
    const record = buildRecordFromRow(rowNumber, recognized, leftover, cells)
    record.confidenceFlags.continuationMerge = true
    recomputeRecordMeta(record)
    records.push(record)
  })

  return { records, titleCandidate, ignoredRows }
}

// ---------------------------------------------------------------------------
// Entry point: a single whole-sheet check picks pattern B or C - never a
// per-row guess, since one export is consistently formatted throughout.
// Every record shares buildNormalizedRows' exact shape, so the rest of the
// pipeline (duplicate engine, batch import, safe update) is unchanged
// regardless of which pattern matched. Returns { records, titleCandidate,
// ignoredRows }.
// ---------------------------------------------------------------------------

export function buildSmartRecords(fullGridRows) {
  const positional = detectPositionalStructure(fullGridRows)
  if (positional.isPositional) {
    return buildPositionalRecords(fullGridRows)
  }
  return buildLabelValueRecords(fullGridRows)
}
