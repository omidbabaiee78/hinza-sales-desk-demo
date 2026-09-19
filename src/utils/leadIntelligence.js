import { isValidIranMobile } from './phone'
import { followUpState } from './leadFollowUp'
import { normalizeCompanyName } from './leadDuplicates'
import { splitContactDisplay } from './leadImport/contactNumbers'

// ---------------------------------------------------------------------------
// Deterministic, explainable "readiness to work" scoring - NOT a purchase
// prediction and NOT AI/ML. Every point added or subtracted here has a fixed,
// inspectable reason string, and the same lead always produces the same
// score/reasons. This is the single place lead-scoring rules live.
// ---------------------------------------------------------------------------

function hasText(value) {
  return Boolean(value && String(value).trim())
}

// A lead's mobile field may hold more than one number (bulk import can join
// several as "021-...، 021-..."); only the first is checked here - this is
// a robustness fix for that field shape, not a scoring rule change (a lead
// either has a usable mobile or it doesn't, regardless of how many it has).
function firstMobile(lead) {
  return splitContactDisplay(lead.mobile)[0] || lead.mobile
}

function contactRoutes(lead) {
  return {
    hasMobile: isValidIranMobile(firstMobile(lead)),
    hasPhone: hasText(lead.phone),
    hasEmail: hasText(lead.email),
    hasWebsite: hasText(lead.website),
  }
}

// Whether a lead has no way to be reached at all - used both by the score
// and by the "اطلاعات ناقص" smart segment, so the two stay in sync.
export function hasNoContactRoute(lead) {
  const { hasMobile, hasPhone, hasEmail, hasWebsite } = contactRoutes(lead)
  return !hasMobile && !hasPhone && !hasEmail && !hasWebsite
}

const RECENT_CONTACT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const PIPELINE_MOMENTUM_STATUSES = new Set(['interested', 'sample_review', 'quoted', 'negotiating'])

function recentlyContacted(lead) {
  if (!lead.last_contact_at) return false
  const contactedAt = new Date(lead.last_contact_at).getTime()
  if (Number.isNaN(contactedAt)) return false
  return Date.now() - contactedAt <= RECENT_CONTACT_WINDOW_MS
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)))
}

// Returns { score: 0-100, reasons: string[] } (2-4 short reasons, most
// important first). converted/lost/do_not_contact leads are never scored as
// active opportunities - they always come back as 0 with a single reason.
export function computeLeadReadiness(lead) {
  if (lead.do_not_contact) {
    return { score: 0, reasons: ['این سرنخ عدم تماس دارد'] }
  }
  if (lead.status === 'converted') {
    return { score: 0, reasons: ['این سرنخ به مشتری تبدیل شده است'] }
  }
  if (lead.status === 'lost') {
    return { score: 0, reasons: ['این سرنخ از دست رفته است'] }
  }

  const { hasMobile, hasPhone, hasEmail, hasWebsite } = contactRoutes(lead)
  const hasProducts = (lead.products || []).length > 0
  const fu = followUpState(lead.next_follow_up_at)

  let score = 0
  // candidate reasons: [priority, points(informational only), text]
  const candidates = []

  if (fu === 'today') {
    score += 18
    candidates.push([100, 'پیگیری امروز سررسید شده است'])
  } else if (fu === 'overdue') {
    score += 15
    candidates.push([95, 'پیگیری عقب‌افتاده دارد'])
  } else if (fu === 'upcoming') {
    score += 5
  }

  if (hasNoContactRoute(lead)) {
    score -= 20
    candidates.push([90, 'هیچ راه تماسی ثبت نشده است'])
  } else if (!hasMobile && !hasPhone) {
    candidates.push([78, 'شماره تماس ندارد'])
  }

  if (hasMobile) {
    score += 15
    candidates.push([80, 'موبایل معتبر دارد'])
  } else if (hasPhone) {
    score += 8
    candidates.push([76, 'شماره تلفن ثابت دارد'])
  }

  if (hasEmail) score += 5
  if (hasWebsite) score += 3

  if (lead.company_name) score += 8
  if (lead.contact_name) {
    score += 6
    candidates.push([60, 'شخص تماس ثبت شده است'])
  } else {
    candidates.push([58, 'نام شخص تماس ثبت نشده است'])
  }
  if (lead.city) score += 3
  if (lead.industry) score += 3

  if (hasProducts) {
    score += 12
    candidates.push([75, 'محصول موردنیاز مشخص است'])
  } else if (hasText(lead.need_note)) {
    score += 8
    candidates.push([73, 'نیاز محصول به صورت یادداشت مشخص است'])
  } else {
    candidates.push([70, 'محصول موردنیاز مشخص نیست'])
  }

  if (recentlyContacted(lead)) {
    score += 5
    candidates.push([55, 'اخیراً با این سرنخ تماس گرفته شده است'])
  }

  if (PIPELINE_MOMENTUM_STATUSES.has(lead.status)) {
    score += 10
  } else if (lead.status === 'contacted') {
    score += 5
  }

  if (hasWebsite && !hasMobile && !hasPhone) {
    candidates.push([35, 'فقط وب‌سایت ثبت شده است'])
  }

  candidates.sort((a, b) => b[0] - a[0])
  const reasons = candidates.slice(0, 4).map(([, text]) => text)

  return { score: clampScore(score), reasons }
}

// Which channels currently *appear* usable based on the data on file - this
// only reflects data completeness, never that a provider is connected or
// that a message can actually be sent (no channel is integrated in this
// phase).
export function computeContactChannelReadiness(lead) {
  const { hasMobile, hasPhone, hasEmail } = contactRoutes(lead)
  return {
    whatsapp: hasMobile,
    sms: hasMobile,
    bale: hasMobile,
    phone: hasMobile || hasPhone,
    email: hasEmail,
  }
}

const NEXT_ACTIONS = {
  NO_CONTACT: 'عدم اقدام — عدم تماس',
  EXISTING_CUSTOMER: 'عدم اقدام — مشتری موجود',
  LOST: 'عدم اقدام — از دست رفته',
  COMPLETE_CONTACT: 'تکمیل اطلاعات تماس',
  FOLLOW_UP_TODAY: 'پیگیری امروز',
  INITIAL_CALL: 'تماس اولیه',
  NEEDS_ASSESSMENT: 'نیازسنجی محصول',
  PRICE_FOLLOW_UP: 'پیگیری قیمت',
  SET_FOLLOW_UP: 'ثبت زمان پیگیری',
  CHECK_WEBSITE: 'بررسی وب‌سایت',
}

// A fixed decision list, evaluated top to bottom - the same lead always
// produces the same suggested action. No LLM, no probability estimate.
export function computeNextBestAction(lead) {
  if (lead.do_not_contact) return NEXT_ACTIONS.NO_CONTACT
  if (lead.status === 'converted') return NEXT_ACTIONS.EXISTING_CUSTOMER
  if (lead.status === 'lost') return NEXT_ACTIONS.LOST

  const { hasMobile, hasPhone, hasEmail, hasWebsite } = contactRoutes(lead)
  if (!hasMobile && !hasPhone && !hasEmail && !hasWebsite) return NEXT_ACTIONS.COMPLETE_CONTACT

  const fu = followUpState(lead.next_follow_up_at)
  if (fu === 'overdue' || fu === 'today') return NEXT_ACTIONS.FOLLOW_UP_TODAY

  if (lead.status === 'new') return NEXT_ACTIONS.INITIAL_CALL

  const hasProducts = (lead.products || []).length > 0
  if (!hasProducts && !hasText(lead.need_note)) return NEXT_ACTIONS.NEEDS_ASSESSMENT

  if (!lead.next_follow_up_at) return NEXT_ACTIONS.SET_FOLLOW_UP

  if (lead.status === 'quoted' || lead.status === 'negotiating') return NEXT_ACTIONS.PRICE_FOLLOW_UP

  if (hasWebsite && !hasMobile && !hasPhone && !hasEmail) return NEXT_ACTIONS.CHECK_WEBSITE

  return NEXT_ACTIONS.PRICE_FOLLOW_UP
}

// ---------------------------------------------------------------------------
// Smart sort - never surfaces do_not_contact/converted/lost leads above
// active work, regardless of how "ready" they numerically score.
// ---------------------------------------------------------------------------

function smartSortBucket(lead) {
  if (lead.do_not_contact || lead.status === 'converted' || lead.status === 'lost') return 5
  const fu = followUpState(lead.next_follow_up_at)
  if (fu === 'overdue') return 0
  if (fu === 'today') return 1
  if (computeLeadReadiness(lead).score >= 70) return 2
  if (lead.priority === 'high') return 3
  return 4
}

export function smartSortCompare(a, b) {
  const bucketDiff = smartSortBucket(a) - smartSortBucket(b)
  if (bucketDiff !== 0) return bucketDiff
  const scoreDiff = computeLeadReadiness(b).score - computeLeadReadiness(a).score
  if (scoreDiff !== 0) return scoreDiff
  return new Date(a.created_at || 0) - new Date(b.created_at || 0)
}

// ---------------------------------------------------------------------------
// Duplicate-risk grouping for the existing lead list (distinct from the
// import-time duplicate engine) - O(n) via key maps, never O(n^2).
// ---------------------------------------------------------------------------

function normalizedKeyParts(lead) {
  const keys = []
  // A mobile/phone field may hold several numbers (see firstMobile above) -
  // every one of them participates in this grouping, not just the first.
  for (const part of splitContactDisplay(lead.mobile)) {
    if (isValidIranMobile(part)) keys.push(`m:${part.replace(/\D/g, '')}`)
  }
  for (const part of splitContactDisplay(lead.phone)) {
    if (hasText(part)) keys.push(`p:${part.replace(/\D/g, '')}`)
  }
  if (hasText(lead.email)) keys.push(`e:${String(lead.email).trim().toLowerCase()}`)
  const name = normalizeCompanyName(lead.company_name)
  if (name.length >= 4) keys.push(`c:${name}`)
  return keys
}

// Returns a Set of lead ids that share a strong identifying key (mobile,
// phone, email or normalized company name) with at least one other lead.
export function computeDuplicateRiskLeadIds(leads) {
  const groups = new Map()
  for (const lead of leads) {
    for (const key of normalizedKeyParts(lead)) {
      const bucket = groups.get(key) || []
      bucket.push(lead.id)
      groups.set(key, bucket)
    }
  }
  const riskyIds = new Set()
  for (const bucket of groups.values()) {
    if (bucket.length > 1) bucket.forEach((id) => riskyIds.add(id))
  }
  return riskyIds
}

// ---------------------------------------------------------------------------
// Smart segments - fast daily-work quick filters, each a pure predicate over
// a lead (plus the pre-computed duplicate-risk id set for the one segment
// that needs cross-lead context).
// ---------------------------------------------------------------------------

export const LEAD_SMART_SEGMENTS = [
  {
    key: 'ready_to_call',
    label: 'آماده تماس',
    test: (lead) =>
      !lead.do_not_contact &&
      lead.status !== 'converted' &&
      lead.status !== 'lost' &&
      computeLeadReadiness(lead).score >= 70,
  },
  {
    key: 'due_today',
    label: 'پیگیری امروز',
    test: (lead) => followUpState(lead.next_follow_up_at) === 'today',
  },
  {
    key: 'overdue',
    label: 'پیگیری عقب‌افتاده',
    test: (lead) => followUpState(lead.next_follow_up_at) === 'overdue',
  },
  {
    key: 'incomplete_contact',
    label: 'اطلاعات ناقص',
    test: (lead) => hasNoContactRoute(lead),
  },
  {
    key: 'no_product',
    label: 'بدون محصول مشخص',
    test: (lead) => (lead.products || []).length === 0 && !hasText(lead.need_note),
  },
  {
    key: 'duplicate_risk',
    label: 'تکراری‌های احتمالی',
    test: (lead, ctx) => Boolean(ctx?.duplicateRiskIds?.has(lead.id)),
  },
  {
    key: 'high_priority',
    label: 'اولویت بالا',
    test: (lead) => lead.priority === 'high',
  },
  {
    key: 'do_not_contact',
    label: 'بدون تماس مجاز',
    test: (lead) => Boolean(lead.do_not_contact),
  },
  {
    key: 'newly_imported',
    label: 'واردشده جدید',
    test: (lead) => Boolean(lead.import_batch_id) && lead.status === 'new',
  },
]
