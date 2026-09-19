import { followUpState } from './leadFollowUp'
import { computeDuplicateRiskLeadIds, computeLeadReadiness, computeNextBestAction } from './leadIntelligence'
import { daysBetween } from './crmRules'

// ---------------------------------------------------------------------------
// Phase 16 - Today / Daily Sales Command Center.
//
// This is the ONE place the "what needs my attention right now" priority
// model lives - the page/hook only aggregate raw rows from existing tables
// and hand them to the builders below; nothing here re-derives business
// rules that already exist elsewhere (order/invoice status meaning, lead
// readiness, follow-up due/overdue) - it only REUSES them and adds a single
// operational ranking on top. Never a purchase-probability/AI score - a
// fixed, inspectable tier + deterministic tie-breakers.
// ---------------------------------------------------------------------------

export const TODAY_ACTION_TYPES = {
  LEAD_FOLLOWUP_OVERDUE: 'lead_followup_overdue',
  LEAD_FOLLOWUP_TODAY: 'lead_followup_today',
  LEAD_FIRST_CONTACT: 'lead_first_contact',
  ORDER_ADMIN_ACTION: 'order_admin_action',
  QUOTE_WAITING_CUSTOMER: 'quote_waiting_customer',
  READY_FOR_DELIVERY: 'ready_for_delivery',
  INVOICE_OVERDUE: 'invoice_overdue',
  INVOICE_DUE_SOON: 'invoice_due_soon',
  SMART_MESSAGE_SUGGESTION: 'smart_message_suggestion',
}

export const TODAY_ACTION_TYPE_LABELS = {
  lead_followup_overdue: 'پیگیری سرنخ عقب‌افتاده',
  lead_followup_today: 'پیگیری سرنخ امروز',
  lead_first_contact: 'فرصت تماس اولیه',
  order_admin_action: 'نیاز به اقدام روی سفارش',
  quote_waiting_customer: 'منتظر تأیید مشتری',
  ready_for_delivery: 'آماده تحویل',
  invoice_overdue: 'فاکتور عقب‌افتاده',
  invoice_due_soon: 'فاکتور نزدیک به سررسید',
  smart_message_suggestion: 'پیشنهاد هوشمند پیام',
}

// Lower number = more urgent. Matches the spec's conceptual order exactly,
// with invoice_due_soon (a financial signal, but not yet late) placed right
// after the two hardest deadlines and before quote-waiting.
const TIER = {
  [TODAY_ACTION_TYPES.INVOICE_OVERDUE]: 1,
  [TODAY_ACTION_TYPES.LEAD_FOLLOWUP_OVERDUE]: 2,
  [TODAY_ACTION_TYPES.ORDER_ADMIN_ACTION]: 3,
  [TODAY_ACTION_TYPES.READY_FOR_DELIVERY]: 4,
  [TODAY_ACTION_TYPES.LEAD_FOLLOWUP_TODAY]: 5,
  [TODAY_ACTION_TYPES.INVOICE_DUE_SOON]: 6,
  [TODAY_ACTION_TYPES.QUOTE_WAITING_CUSTOMER]: 7,
  [TODAY_ACTION_TYPES.SMART_MESSAGE_SUGGESTION]: 8,
  [TODAY_ACTION_TYPES.LEAD_FIRST_CONTACT]: 9,
}

export const PRIORITY_BUCKET_LABELS = { urgent: 'فوری', important: 'مهم', normal: 'عادی' }

export function priorityBucketForTier(tier) {
  if (tier <= 2) return 'urgent'
  if (tier <= 6) return 'important'
  return 'normal'
}

const MANUAL_PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

// Deterministic tie-break within a tier: longer-overdue first, then higher
// manual priority, then larger outstanding amount, then older item first
// (FIFO) - never random, never re-derived per render.
export function compareTodayItems(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier
  const ageDiff = (b.ageDays || 0) - (a.ageDays || 0)
  if (ageDiff !== 0) return ageDiff
  const rankDiff = (MANUAL_PRIORITY_RANK[a.manualPriority] ?? 1) - (MANUAL_PRIORITY_RANK[b.manualPriority] ?? 1)
  if (rankDiff !== 0) return rankDiff
  const amountDiff = (b.amount || 0) - (a.amount || 0)
  if (amountDiff !== 0) return amountDiff
  return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
}

function contactLabel(lead) {
  return lead.company_name || lead.contact_name || '—'
}

// ---- Leads --------------------------------------------------------------

// do_not_contact/converted/lost leads never enter any queue - matches the
// existing lead-intelligence rule (leadIntelligence.js's readiness scoring
// already treats them identically; this mirrors that same exclusion).
function isEligibleLead(lead) {
  return !lead.do_not_contact && lead.status !== 'converted' && lead.status !== 'lost'
}

export function buildLeadFollowUpItems(leads, now) {
  const items = []
  for (const lead of leads) {
    if (!isEligibleLead(lead)) continue
    const state = followUpState(lead.next_follow_up_at, now)
    if (state !== 'overdue' && state !== 'today') continue
    const type = state === 'overdue' ? TODAY_ACTION_TYPES.LEAD_FOLLOWUP_OVERDUE : TODAY_ACTION_TYPES.LEAD_FOLLOWUP_TODAY
    const ageDays = state === 'overdue' ? Math.max(1, daysBetween(lead.next_follow_up_at, now) || 1) : 0
    items.push({
      id: `lead-followup-${lead.id}`,
      type,
      tier: TIER[type],
      title: TODAY_ACTION_TYPE_LABELS[type],
      company: contactLabel(lead),
      companyId: null, // a lead isn't linked to the companies table until converted
      context: [lead.city, lead.industry].filter(Boolean).join(' / ') || null,
      reason:
        state === 'overdue'
          ? `${ageDays} روز از سررسید پیگیری این سرنخ گذشته است.`
          : 'پیگیری این سرنخ امروز سررسید شده است.',
      dueAt: lead.next_follow_up_at,
      ageDays,
      manualPriority: lead.priority,
      createdAt: lead.created_at,
      phone: lead.mobile || lead.phone || null,
      refType: 'lead',
      refId: lead.id,
    })
  }
  return items
}

const FIRST_CONTACT_MIN_READINESS = 60
const FIRST_CONTACT_MAX_ITEMS = 8

// A small, capped shortlist only - never every imported lead. Reuses the
// exact same readiness score/reasons, next-best-action, and duplicate-risk
// grouping already computed for the leads list (leadIntelligence.js) - no
// separate scoring invented, and a lead flagged as a probable duplicate is
// never suggested for first contact until that's resolved.
export function buildLeadFirstContactItems(leads, { limit = FIRST_CONTACT_MAX_ITEMS } = {}) {
  const duplicateRiskIds = computeDuplicateRiskLeadIds(leads)
  return leads
    .filter((lead) => isEligibleLead(lead) && lead.status === 'new' && !duplicateRiskIds.has(lead.id))
    .map((lead) => ({ lead, readiness: computeLeadReadiness(lead) }))
    .filter(({ readiness }) => readiness.score >= FIRST_CONTACT_MIN_READINESS)
    .sort((a, b) => b.readiness.score - a.readiness.score)
    .slice(0, limit)
    .map(({ lead, readiness }) => ({
      id: `lead-first-contact-${lead.id}`,
      type: TODAY_ACTION_TYPES.LEAD_FIRST_CONTACT,
      tier: TIER[TODAY_ACTION_TYPES.LEAD_FIRST_CONTACT],
      title: TODAY_ACTION_TYPE_LABELS[TODAY_ACTION_TYPES.LEAD_FIRST_CONTACT],
      company: contactLabel(lead),
      companyId: null,
      context: [lead.city, lead.industry].filter(Boolean).join(' / ') || null,
      reason: readiness.reasons[0] || 'آمادگی پیگیری بالا',
      dueAt: null,
      ageDays: 0,
      manualPriority: lead.priority,
      createdAt: lead.created_at,
      phone: lead.mobile || lead.phone || null,
      refType: 'lead',
      refId: lead.id,
      readinessScore: readiness.score,
      nextBestAction: computeNextBestAction(lead),
    }))
}

// ---- Orders ---------------------------------------------------------------

const ORDER_STATUS_TYPE = {
  pending_review: TODAY_ACTION_TYPES.ORDER_ADMIN_ACTION,
  customer_approved: TODAY_ACTION_TYPES.ORDER_ADMIN_ACTION,
  quoted: TODAY_ACTION_TYPES.QUOTE_WAITING_CUSTOMER,
  ready_for_delivery: TODAY_ACTION_TYPES.READY_FOR_DELIVERY,
}

const ORDER_STATUS_REASON = {
  pending_review: 'این سفارش منتظر اعلام قیمت شماست.',
  customer_approved: 'مشتری سفارش را تأیید کرده و منتظر تأیید نهایی شماست.',
  quoted: 'قیمت اعلام شده و سفارش منتظر تأیید مشتری است.',
  ready_for_delivery: 'سفارش آماده تحویل است و هماهنگی نیاز دارد.',
}

// Only the statuses where the ADMIN (or a customer response the admin is
// waiting on) genuinely has something to do - never delivered/rejected/
// cancelled, which are settled and carry no active work.
export const TODAY_ORDER_STATUSES = Object.keys(ORDER_STATUS_TYPE)

export function buildOrderItems(orders, companiesById, now) {
  return orders
    .filter((order) => ORDER_STATUS_TYPE[order.status])
    .map((order) => {
      const type = ORDER_STATUS_TYPE[order.status]
      const ageDays = Math.max(0, daysBetween(order.created_at, now) || 0)
      return {
        id: `order-${order.id}`,
        type,
        tier: TIER[type],
        title: TODAY_ACTION_TYPE_LABELS[type],
        company: companiesById.get(order.company_id)?.name || '—',
        companyId: order.company_id,
        context: `سفارش ${order.order_number ?? order.id}`,
        reason: ORDER_STATUS_REASON[order.status] || '',
        dueAt: null,
        ageDays,
        manualPriority: null,
        createdAt: order.created_at,
        refType: 'order',
        refId: order.id,
      }
    })
}

// ---- Invoices ---------------------------------------------------------------

const INVOICE_DUE_SOON_WINDOW_DAYS = 3

// Only unpaid/partially-paid invoices with a real outstanding balance and a
// due_date reach here - a paid or cancelled invoice never appears, and an
// invoice with no due_date has nothing to be overdue/due-soon against.
export function buildInvoiceItems(invoicesWithRemaining, companiesById, now) {
  const items = []
  for (const invoice of invoicesWithRemaining) {
    if (!invoice.due_date || invoice.remainingRial <= 0) continue
    const daysUntilDue = -1 * (daysBetween(invoice.due_date, now) ?? 0)
    let type = null
    let ageDays = 0
    let reason = ''
    if (daysUntilDue < 0) {
      type = TODAY_ACTION_TYPES.INVOICE_OVERDUE
      ageDays = Math.abs(daysUntilDue)
      reason = `${ageDays} روز از سررسید این فاکتور گذشته است.`
    } else if (daysUntilDue <= INVOICE_DUE_SOON_WINDOW_DAYS) {
      type = TODAY_ACTION_TYPES.INVOICE_DUE_SOON
      reason =
        daysUntilDue === 0
          ? 'سررسید این فاکتور امروز است.'
          : `${daysUntilDue} روز تا سررسید این فاکتور باقی مانده است.`
    }
    if (!type) continue

    items.push({
      id: `invoice-${invoice.id}`,
      type,
      tier: TIER[type],
      title: TODAY_ACTION_TYPE_LABELS[type],
      company: companiesById.get(invoice.company_id)?.name || '—',
      companyId: invoice.company_id,
      context: `فاکتور ${invoice.invoice_number ?? invoice.id}`,
      reason,
      dueAt: invoice.due_date,
      ageDays,
      manualPriority: null,
      amount: invoice.remainingRial,
      createdAt: invoice.due_date,
      refType: 'invoice',
      refId: invoice.id,
    })
  }
  return items
}

// ---- Messaging Brain suggestions -------------------------------------------

const ACTIONABLE_SUGGESTION_STATUSES = new Set(['pending', 'approved', 'edited'])

// Only ever reads crm_message_suggestions rows the existing engine already
// produced (via useSmartSuggestions) - never a second scoring pass.
export function buildMessagingItems(rows, activeSnoozeSignatures, snoozeSignatureFn, companiesById) {
  return rows
    .filter((row) => ACTIONABLE_SUGGESTION_STATUSES.has(row.status))
    .filter((row) => !activeSnoozeSignatures.has(snoozeSignatureFn(row.reason_key, row.order_id, row.invoice_id)))
    .map((row) => ({
      id: `suggestion-${row.id}`,
      type: TODAY_ACTION_TYPES.SMART_MESSAGE_SUGGESTION,
      tier: TIER[TODAY_ACTION_TYPES.SMART_MESSAGE_SUGGESTION],
      title: TODAY_ACTION_TYPE_LABELS[TODAY_ACTION_TYPES.SMART_MESSAGE_SUGGESTION],
      company: companiesById.get(row.company_id)?.name || 'مشتری نامشخص',
      companyId: row.company_id,
      context: (row.message_draft || '').slice(0, 90),
      reason: row.explanation || '',
      dueAt: null,
      ageDays: 0,
      manualPriority: row.priority <= 20 ? 'high' : row.priority <= 40 ? 'medium' : 'low',
      createdAt: row.created_at,
      refType: 'suggestion',
      refId: row.id,
      suggestion: row,
    }))
}

// ---------------------------------------------------------------------------
// Grouping - same company with 2+ items collapses into one card instead of
// several visually repetitive ones. Nothing is hidden: every item is still
// listed, just nested under one company header. A lead (no companyId until
// converted) is never grouped - it always stands alone.
// ---------------------------------------------------------------------------

export function groupTodayItems(items) {
  const byCompany = new Map()
  const standalone = []

  for (const item of items) {
    if (!item.companyId) {
      standalone.push(item)
      continue
    }
    const bucket = byCompany.get(item.companyId) || []
    bucket.push(item)
    byCompany.set(item.companyId, bucket)
  }

  const groups = []
  for (const [companyId, groupItems] of byCompany) {
    if (groupItems.length === 1) {
      standalone.push(groupItems[0])
      continue
    }
    const sorted = [...groupItems].sort(compareTodayItems)
    groups.push({
      kind: 'group',
      companyId,
      company: sorted[0].company,
      items: sorted,
      tier: Math.min(...sorted.map((i) => i.tier)),
      ageDays: Math.max(...sorted.map((i) => i.ageDays || 0)),
      manualPriority: null,
      amount: sorted.reduce((sum, i) => sum + (i.amount || 0), 0),
      createdAt: sorted[0].createdAt,
    })
  }

  const standaloneEntries = standalone.map((item) => ({ kind: 'item', ...item }))
  return [...groups, ...standaloneEntries].sort(compareTodayItems)
}
