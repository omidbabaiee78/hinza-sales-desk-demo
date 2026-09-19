import { companyNamesLikelyMatch, normalizeCompanyName } from '../leadDuplicates'
import { normalizeLandlineForComparison, normalizeMobileForComparison, splitContactDisplay } from './contactNumbers'

// Classification buckets, exactly matching the phase-15B spec's six
// outcomes. Never auto-merges an ambiguous row - classification only ever
// picks a *recommended* action, which the admin can override per row.
export const CLASSIFICATIONS = {
  NEW: 'new',
  DUPLICATE_LEAD: 'duplicate_lead',
  POSSIBLE_DUPLICATE: 'possible_duplicate',
  EXISTING_CUSTOMER: 'existing_customer',
  NEEDS_REVIEW: 'needs_review',
  ERROR: 'error',
}

export const CLASSIFICATION_LABELS = {
  new: 'جدید',
  duplicate_lead: 'تکراری با سرنخ',
  possible_duplicate: 'احتمالاً تکراری',
  existing_customer: 'مشتری موجود',
  needs_review: 'نیازمند بررسی',
  error: 'خطا',
}

export const ROW_ACTIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  SKIP: 'skip',
}

export const ROW_ACTION_LABELS = {
  create: 'ردیف جدید بساز',
  update: 'بروزرسانی سرنخ موجود',
  skip: 'ردیف را رد کن',
}

// existingLeads' mobile/phone columns are plain TEXT and may hold more than
// one number (a previous multi-number import writes them joined with "، ")
// - splitContactDisplay + the canonical normalizers turn that back into
// individual comparison keys, so EVERY number a lead has on file
// participates in matching, not just whichever happened to be first.
function buildLeadKeyMaps(existingLeads) {
  const byMobile = new Map()
  const byPhone = new Map()
  const byEmail = new Map()
  const byWebsite = new Map()
  const byExternalRef = new Map()

  function add(map, key, lead) {
    if (!key) return
    const bucket = map.get(key) || []
    bucket.push(lead)
    map.set(key, bucket)
  }

  for (const lead of existingLeads) {
    for (const part of splitContactDisplay(lead.mobile)) {
      const key = normalizeMobileForComparison(part)
      if (key) add(byMobile, key, lead)
    }
    for (const part of splitContactDisplay(lead.phone)) {
      const key = normalizeLandlineForComparison(part)
      if (key) add(byPhone, key, lead)
    }
    if (lead.email) add(byEmail, lead.email.trim().toLowerCase(), lead)
    if (lead.website) {
      const domain = lead.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase()
      add(byWebsite, domain, lead)
    }
    if (lead.external_ref) add(byExternalRef, lead.external_ref.trim().toLowerCase(), lead)
  }

  return { byMobile, byPhone, byEmail, byWebsite, byExternalRef }
}

// A company's single `phone` column may be a mobile or a landline (and,
// same as leads, may hold several numbers) - each split part is indexed
// under whichever key type it actually is.
function buildCompanyPhoneMap(existingCompanies) {
  const byPhone = new Map()
  for (const company of existingCompanies) {
    for (const part of splitContactDisplay(company.phone)) {
      const key = normalizeMobileForComparison(part) || normalizeLandlineForComparison(part)
      if (!key) continue
      const bucket = byPhone.get(key) || []
      bucket.push(company)
      byPhone.set(key, bucket)
    }
  }
  return byPhone
}

// matchKeys.mobile/phone/email/website/externalRef are each ARRAYS (a row
// can legitimately have more than one mobile/landline) - every key
// participates, so a match on ANY one of a lead's numbers counts as strong.
function findStrongLeadMatches(matchKeys, leadMaps) {
  const found = new Map() // id -> lead
  const tryAdd = (map, key) => {
    if (!key) return
    for (const lead of map.get(key) || []) found.set(lead.id, lead)
  }
  for (const key of matchKeys.mobile || []) tryAdd(leadMaps.byMobile, key)
  for (const key of matchKeys.phone || []) tryAdd(leadMaps.byPhone, key)
  for (const key of matchKeys.email || []) tryAdd(leadMaps.byEmail, key)
  for (const key of matchKeys.website || []) tryAdd(leadMaps.byWebsite, key)
  for (const key of matchKeys.externalRef || []) tryAdd(leadMaps.byExternalRef, key)
  return [...found.values()]
}

function findStrongCompanyMatches(matchKeys, companyPhoneByKey) {
  const found = new Map()
  for (const key of [...(matchKeys.mobile || []), ...(matchKeys.phone || [])]) {
    if (!key) continue
    for (const company of companyPhoneByKey.get(key) || []) found.set(company.id, company)
  }
  return [...found.values()]
}

function findFuzzyNameMatch(companyName, existingLeads, existingCompanies) {
  if (!companyName) return null
  const lead = existingLeads.find((l) => companyNamesLikelyMatch(companyName, l.company_name))
  if (lead) return { type: 'lead', record: lead }
  const company = existingCompanies.find((c) => companyNamesLikelyMatch(companyName, c.name))
  if (company) return { type: 'company', record: company }
  return null
}

function classifySingleRow(row, existingLeads, existingCompanies, leadMaps, companyPhoneByKey) {
  if (row.errors.length > 0) {
    return {
      classification: CLASSIFICATIONS.ERROR,
      matchLabel: '',
      matchedLeadId: null,
      matchedLeadStatus: null,
      matchedCompanyId: null,
      defaultAction: ROW_ACTIONS.SKIP,
      availableActions: [ROW_ACTIONS.SKIP],
    }
  }

  const strongLeadMatches = findStrongLeadMatches(row.matchKeys, leadMaps)
  const strongCompanyMatches = findStrongCompanyMatches(row.matchKeys, companyPhoneByKey)

  if (strongLeadMatches.length > 0 && strongCompanyMatches.length > 0) {
    return {
      classification: CLASSIFICATIONS.NEEDS_REVIEW,
      matchLabel: `این ردیف هم با سرنخ «${strongLeadMatches[0].company_name || strongLeadMatches[0].contact_name}» و هم با مشتری «${strongCompanyMatches[0].name}» مطابقت دارد.`,
      matchedLeadId: strongLeadMatches[0].id,
      matchedLeadStatus: strongLeadMatches[0].status,
      matchedCompanyId: strongCompanyMatches[0].id,
      defaultAction: ROW_ACTIONS.SKIP,
      availableActions: [ROW_ACTIONS.SKIP, ROW_ACTIONS.CREATE, ROW_ACTIONS.UPDATE],
    }
  }

  if (strongLeadMatches.length > 0) {
    const convertedMatch = strongLeadMatches.find((l) => l.status === 'converted')
    if (convertedMatch) {
      return {
        classification: CLASSIFICATIONS.EXISTING_CUSTOMER,
        matchLabel: `این ردیف احتمالاً با مشتری موجود «${convertedMatch.company_name || convertedMatch.contact_name}» یکسان است (از طریق سرنخ تبدیل‌شده).`,
        matchedLeadId: convertedMatch.id,
        matchedLeadStatus: convertedMatch.status,
        matchedCompanyId: convertedMatch.converted_company_id || null,
        defaultAction: ROW_ACTIONS.SKIP,
        availableActions: [ROW_ACTIONS.SKIP, ROW_ACTIONS.CREATE],
      }
    }
    const match = strongLeadMatches[0]
    const isTerminalLost = match.status === 'lost'
    return {
      classification: CLASSIFICATIONS.DUPLICATE_LEAD,
      matchLabel: `این ردیف احتمالاً با سرنخ «${match.company_name || match.contact_name || '—'}» یکسان است.`,
      matchedLeadId: match.id,
      matchedLeadStatus: match.status,
      matchedCompanyId: null,
      defaultAction: isTerminalLost ? ROW_ACTIONS.SKIP : ROW_ACTIONS.UPDATE,
      availableActions: [ROW_ACTIONS.UPDATE, ROW_ACTIONS.SKIP, ROW_ACTIONS.CREATE],
    }
  }

  if (strongCompanyMatches.length > 0) {
    const match = strongCompanyMatches[0]
    return {
      classification: CLASSIFICATIONS.EXISTING_CUSTOMER,
      matchLabel: `این ردیف احتمالاً با مشتری موجود «${match.name}» یکسان است.`,
      matchedLeadId: null,
      matchedLeadStatus: null,
      matchedCompanyId: match.id,
      defaultAction: ROW_ACTIONS.SKIP,
      availableActions: [ROW_ACTIONS.SKIP, ROW_ACTIONS.CREATE],
    }
  }

  const fuzzy = findFuzzyNameMatch(row.fields.company_name, existingLeads, existingCompanies)
  if (fuzzy?.type === 'lead') {
    return {
      classification: CLASSIFICATIONS.POSSIBLE_DUPLICATE,
      matchLabel: `این ردیف احتمالاً با سرنخ «${fuzzy.record.company_name || fuzzy.record.contact_name}» یکسان است.`,
      matchedLeadId: fuzzy.record.id,
      matchedLeadStatus: fuzzy.record.status,
      matchedCompanyId: null,
      defaultAction: ROW_ACTIONS.SKIP,
      availableActions: [ROW_ACTIONS.SKIP, ROW_ACTIONS.CREATE, ROW_ACTIONS.UPDATE],
    }
  }
  if (fuzzy?.type === 'company') {
    return {
      classification: CLASSIFICATIONS.POSSIBLE_DUPLICATE,
      matchLabel: `این ردیف احتمالاً با مشتری موجود «${fuzzy.record.name}» یکسان است.`,
      matchedLeadId: null,
      matchedLeadStatus: null,
      matchedCompanyId: fuzzy.record.id,
      defaultAction: ROW_ACTIONS.SKIP,
      availableActions: [ROW_ACTIONS.SKIP, ROW_ACTIONS.CREATE],
    }
  }

  return {
    classification: CLASSIFICATIONS.NEW,
    matchLabel: '',
    matchedLeadId: null,
    matchedLeadStatus: null,
    matchedCompanyId: null,
    defaultAction: ROW_ACTIONS.CREATE,
    availableActions: [ROW_ACTIONS.CREATE, ROW_ACTIONS.SKIP],
  }
}

// Same-file duplicate grouping - uses just the FIRST key of each array
// (matching against existing leads/companies above is where every number
// must participate; this lighter same-file heuristic only needs one
// reliable signal per row to group on).
function intraFileKey(row) {
  const k = row.matchKeys
  if (k.mobile?.[0]) return `m:${k.mobile[0]}`
  if (k.phone?.[0]) return `p:${k.phone[0]}`
  if (k.email?.[0]) return `e:${k.email[0]}`
  if (k.website?.[0]) return `w:${k.website[0]}`
  if (k.externalRef?.[0]) return `x:${k.externalRef[0]}`
  const name = normalizeCompanyName(row.fields.company_name)
  return name.length >= 4 ? `c:${name}` : null
}

// Main entry point: classifies every normalized row against existing
// sales_leads + companies (both fetched once, in bulk, by the caller - O(n)
// map lookups here, never a query per row) and then against each other
// (same-file duplicates), producing one classified row per input row.
//
// existingLeads/existingCompanies are trusted to already be arrays (per
// fetchLeadsForDuplicateCheck/fetchExistingCompaniesForDuplicateCheck's
// contract), but this is the one place every caller funnels through, so it
// never assumes that - a caller mistake (wrong key name, a still-loading
// hook, a future refactor) degrades to "no existing records to compare
// against" instead of throwing a raw, unreadable JS error. This is a
// type-safety net only: a real Supabase failure must still be thrown by the
// fetcher itself, never silently absorbed here.
export function classifyLeadImportRows(normalizedRows, { existingLeads, existingCompanies } = {}) {
  const safeExistingLeads = Array.isArray(existingLeads) ? existingLeads : []
  const safeExistingCompanies = Array.isArray(existingCompanies) ? existingCompanies : []

  const leadMaps = buildLeadKeyMaps(safeExistingLeads)
  const companyPhoneByKey = buildCompanyPhoneMap(safeExistingCompanies)

  const classified = normalizedRows.map((row) => ({
    ...row,
    action: null, // set below (default) or overridden by the admin in the UI
    ...classifySingleRow(row, safeExistingLeads, safeExistingCompanies, leadMaps, companyPhoneByKey),
  }))

  const seenKeys = new Map()
  for (const row of classified) {
    if (row.classification === CLASSIFICATIONS.ERROR) continue
    const key = intraFileKey(row)
    if (!key) continue
    const firstRowNumber = seenKeys.get(key)
    if (firstRowNumber == null) {
      seenKeys.set(key, row.rowNumber)
      continue
    }
    row.classification = CLASSIFICATIONS.NEEDS_REVIEW
    row.matchLabel = `این ردیف با ردیف ${firstRowNumber} در همین فایل مشابه به نظر می‌رسد.`
    row.defaultAction = ROW_ACTIONS.SKIP
    row.availableActions = [ROW_ACTIONS.SKIP, ROW_ACTIONS.CREATE]
  }

  for (const row of classified) {
    row.action = row.defaultAction
  }

  return classified
}

export function summarizeLeadImportRows(rows) {
  const summary = { total: rows.length }
  for (const key of Object.values(CLASSIFICATIONS)) {
    summary[key] = rows.filter((r) => r.classification === key).length
  }
  return summary
}
