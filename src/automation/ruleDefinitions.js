import { followUpState } from '../utils/leadFollowUp.js'
import { hasNoContactRoute, computeDuplicateRiskLeadIds } from '../utils/leadIntelligence.js'
import { resolveTransitionTimestamp, hoursSince } from '../messagingRules/orderEventResolver.js'

// ---------------------------------------------------------------------------
// Phase 17 - Automation & Task Engine rule definitions.
//
// Pure functions only - no Supabase calls, no React, no side effects. Every
// evaluator here answers exactly one question: "does this business record
// currently require this task_type?" (generation) or "does this existing
// task's underlying record still justify it?" (invalidation). The
// reconciler (reconciler.js) is the only caller; it owns fetching data in
// and writing the resulting plan out.
//
// automation_rules.priority is the rule's BASE priority (lower = more
// urgent, same convention as messagingRules.PRIORITY). A handful of rules
// sensibly escalate priority with age - that adjustment lives here, next to
// the rule it belongs to, never in the UI.
// ---------------------------------------------------------------------------

const QUOTE_WAITING_MIN_HOURS = 18

function agedPriority(basePriority, days, capDays, maxReduction) {
  const reduction = Math.min(Math.max(days, 0), capDays) * (maxReduction / capDays)
  return Math.max(1, Math.round(basePriority - reduction))
}

// ---------------------------------------------------------------------------
// LEADS
// ---------------------------------------------------------------------------

function leadEligibleForContactTasks(lead) {
  return !lead.do_not_contact && lead.status !== 'converted' && lead.status !== 'lost'
}

export function evaluateLeadFollowupDue({ lead, now, rule }) {
  if (!leadEligibleForContactTasks(lead)) return null
  if (!lead.next_follow_up_at) return null
  if (followUpState(lead.next_follow_up_at, now) !== 'today') return null
  return {
    taskType: 'lead_followup_due',
    dedupeKey: `lead_followup_due:${lead.id}:${lead.next_follow_up_at}`,
    sourceType: 'lead',
    leadId: lead.id,
    title: 'پیگیری سرنخ برای امروز',
    reason: 'پیگیری این سرنخ امروز سررسید شده است.',
    context: { companyName: lead.company_name, contactName: lead.contact_name, nextFollowUpAt: lead.next_follow_up_at },
    priority: rule.priority,
    dueAt: lead.next_follow_up_at,
  }
}

export function evaluateLeadFollowupOverdue({ lead, now, rule }) {
  if (!leadEligibleForContactTasks(lead)) return null
  if (!lead.next_follow_up_at) return null
  if (followUpState(lead.next_follow_up_at, now) !== 'overdue') return null
  const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(lead.next_follow_up_at).getTime()) / 86400000))
  return {
    taskType: 'lead_followup_overdue',
    dedupeKey: `lead_followup_overdue:${lead.id}:${lead.next_follow_up_at}`,
    sourceType: 'lead',
    leadId: lead.id,
    title: 'پیگیری سرنخ عقب‌افتاده',
    reason: `${daysOverdue} روز از سررسید پیگیری این سرنخ گذشته است.`,
    context: { companyName: lead.company_name, contactName: lead.contact_name, nextFollowUpAt: lead.next_follow_up_at, daysOverdue },
    priority: agedPriority(rule.priority, daysOverdue, 15, 15),
    dueAt: lead.next_follow_up_at,
  }
}

export function evaluateLeadFirstContact({ lead, now, rule, duplicateRiskIds }) {
  if (lead.status !== 'new') return null
  if (!leadEligibleForContactTasks(lead)) return null
  if (lead.last_contact_at) return null
  if (!lead.mobile && !lead.phone && !lead.email) return null
  if (duplicateRiskIds.has(lead.id)) return null
  return {
    taskType: 'lead_first_contact',
    dedupeKey: `lead_first_contact:${lead.id}`,
    sourceType: 'lead',
    leadId: lead.id,
    title: 'فرصت تماس اولیه',
    reason: 'این سرنخ تازه ثبت شده و هنوز اولین تماس با آن برقرار نشده است.',
    context: { companyName: lead.company_name, contactName: lead.contact_name },
    priority: rule.priority,
    dueAt: null,
    createdAt: now.toISOString(),
  }
}

export function evaluateProspectDataIncomplete({ lead, rule }) {
  if (!leadEligibleForContactTasks(lead)) return null
  if (!lead.company_name) return null // only genuinely worth completing when there's a real company to work
  if (!hasNoContactRoute(lead)) return null // any real contact route present -> not "incomplete" for this purpose
  return {
    taskType: 'prospect_data_incomplete',
    dedupeKey: `prospect_data_incomplete:${lead.id}`,
    sourceType: 'lead',
    leadId: lead.id,
    title: 'تکمیل اطلاعات تماس سرنخ',
    reason: 'این سرنخ هیچ راه تماسی (موبایل، تلفن یا ایمیل) ثبت‌شده ندارد.',
    context: { companyName: lead.company_name },
    priority: rule.priority,
    dueAt: null,
  }
}

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------

export function evaluateOrderPendingReview({ order, rule }) {
  if (order.status !== 'pending_review') return null
  return {
    taskType: 'order_pending_review',
    dedupeKey: `order_pending_review:${order.id}`,
    sourceType: 'order',
    orderId: order.id,
    title: 'نیاز به اعلام قیمت',
    reason: 'این سفارش منتظر اعلام قیمت شماست.',
    context: { orderNumber: order.order_number ?? order.id },
    priority: rule.priority,
    dueAt: null,
  }
}

export function evaluateOrderCustomerApproved({ order, rule }) {
  if (order.status !== 'customer_approved') return null
  return {
    taskType: 'order_customer_approved',
    dedupeKey: `order_customer_approved:${order.id}`,
    sourceType: 'order',
    orderId: order.id,
    title: 'نیاز به تأیید سفارش',
    reason: 'مشتری سفارش را تأیید کرده و منتظر تأیید نهایی شماست.',
    context: { orderNumber: order.order_number ?? order.id },
    priority: rule.priority,
    dueAt: null,
  }
}

export function evaluateOrderReadyForDelivery({ order, rule }) {
  if (order.status !== 'ready_for_delivery') return null
  return {
    taskType: 'order_ready_for_delivery',
    dedupeKey: `order_ready_for_delivery:${order.id}`,
    sourceType: 'order',
    orderId: order.id,
    title: 'هماهنگی تحویل سفارش',
    reason: 'سفارش آماده تحویل است و هماهنگی نیاز دارد.',
    context: { orderNumber: order.order_number ?? order.id },
    priority: rule.priority,
    dueAt: null,
  }
}

// Reuses the SAME compatibility resolver messagingRules already relies on -
// supports both canonical (status_changed + metadata->>'to') and legacy
// (event_type = 'quoted') order_events rows, never a second timing model.
export function evaluateQuoteWaitingCustomer({ order, quotedSinceMap, now, rule }) {
  if (order.status !== 'quoted') return null
  const { timestamp } = resolveTransitionTimestamp({
    orderId: order.id,
    eventsByStatusMap: quotedSinceMap,
    fallbackIso: order.created_at,
  })
  if (!timestamp) return null
  const hours = hoursSince(timestamp, now)
  if (hours == null || hours < QUOTE_WAITING_MIN_HOURS) return null
  return {
    taskType: 'quote_waiting_customer',
    dedupeKey: `quote_waiting_customer:${order.id}:1`,
    sourceType: 'order',
    orderId: order.id,
    title: 'منتظر تأیید مشتری',
    reason: `قیمت سفارش ${order.order_number ?? order.id} حدود ${Math.round(hours)} ساعت پیش اعلام شده و هنوز تأیید مشتری ثبت نشده است.`,
    context: { orderNumber: order.order_number ?? order.id, hoursSinceQuoted: Math.round(hours) },
    priority: rule.priority,
    dueAt: null,
  }
}

// ---------------------------------------------------------------------------
// INVOICES - always the REAL outstanding balance (total - payments), never
// invoice.status alone.
// ---------------------------------------------------------------------------

export function evaluateInvoiceDueSoon({ invoice, remainingRial, now, rule }) {
  if (!invoice.due_date || remainingRial <= 0) return null
  const daysUntilDue = Math.ceil((new Date(`${invoice.due_date}T00:00:00+03:30`).getTime() - now.getTime()) / 86400000)
  if (daysUntilDue < 0 || daysUntilDue > 2) return null
  return {
    taskType: 'invoice_due_soon',
    dedupeKey: `invoice_due_soon:${invoice.id}`,
    sourceType: 'invoice',
    invoiceId: invoice.id,
    title: 'فاکتور نزدیک به سررسید',
    reason:
      daysUntilDue === 0
        ? 'سررسید این فاکتور امروز است.'
        : `${daysUntilDue} روز تا سررسید این فاکتور باقی مانده است.`,
    context: { invoiceNumber: invoice.invoice_number ?? invoice.id, remainingRial, daysUntilDue },
    priority: rule.priority,
    dueAt: invoice.due_date,
  }
}

export function evaluateInvoiceOverdue({ invoice, remainingRial, now, rule }) {
  if (!invoice.due_date || remainingRial <= 0) return null
  const daysOverdue = Math.floor((now.getTime() - new Date(`${invoice.due_date}T00:00:00+03:30`).getTime()) / 86400000)
  if (daysOverdue < 1) return null
  return {
    taskType: 'invoice_overdue',
    dedupeKey: `invoice_overdue:${invoice.id}`,
    sourceType: 'invoice',
    invoiceId: invoice.id,
    title: 'فاکتور عقب‌افتاده',
    reason: `${daysOverdue} روز از سررسید این فاکتور گذشته و همچنان مانده پرداخت دارد.`,
    context: { invoiceNumber: invoice.invoice_number ?? invoice.id, remainingRial, daysOverdue },
    priority: agedPriority(rule.priority, daysOverdue, 20, 20),
    dueAt: invoice.due_date,
  }
}

// ---------------------------------------------------------------------------
// MESSAGING BRAIN - crm_message_suggestions is the decision source; this
// only wraps an already-actionable suggestion in a task, never a new draft.
// ---------------------------------------------------------------------------

const ACTIONABLE_SUGGESTION_STATUSES = new Set(['pending', 'approved', 'edited'])

export function evaluateSmartMessageReview({ suggestion, isSnoozed, rule }) {
  if (!ACTIONABLE_SUGGESTION_STATUSES.has(suggestion.status)) return null
  if (isSnoozed) return null
  return {
    taskType: 'smart_message_review',
    dedupeKey: `smart_message_review:${suggestion.id}`,
    sourceType: 'crm_message',
    messageSuggestionId: suggestion.id,
    title: 'پیشنهاد هوشمند پیام',
    reason: suggestion.explanation || 'یک پیشنهاد پیام هوشمند در انتظار بررسی است.',
    context: { reasonKey: suggestion.reason_key, messagePreview: (suggestion.message_draft || '').slice(0, 90) },
    priority: rule.priority,
    dueAt: null,
  }
}

// ---------------------------------------------------------------------------
// Runs every generation rule for a given business-data snapshot. `rulesByType`
// gates BOTH whether a rule runs at all (disabled rules never generate) - the
// reconciler still separately re-checks this for safety.
// ---------------------------------------------------------------------------

export function generateAllCandidates({ leads, orders, invoicesWithRemaining, quotedSinceMap, suggestions, isSuggestionSnoozed, now, rulesByType }) {
  const candidates = []
  const duplicateRiskIds = computeDuplicateRiskLeadIds(leads)

  function run(taskType, evaluator, arg) {
    const rule = rulesByType.get(taskType)
    if (!rule || !rule.enabled) return
    const candidate = evaluator({ ...arg, now, rule })
    if (candidate) candidates.push(candidate)
  }

  for (const lead of leads) {
    run('lead_followup_due', evaluateLeadFollowupDue, { lead })
    run('lead_followup_overdue', evaluateLeadFollowupOverdue, { lead })
    run('lead_first_contact', (args) => evaluateLeadFirstContact({ ...args, duplicateRiskIds }), { lead })
    run('prospect_data_incomplete', evaluateProspectDataIncomplete, { lead })
  }

  for (const order of orders) {
    run('order_pending_review', evaluateOrderPendingReview, { order })
    run('order_customer_approved', evaluateOrderCustomerApproved, { order })
    run('order_ready_for_delivery', evaluateOrderReadyForDelivery, { order })
    run('quote_waiting_customer', evaluateQuoteWaitingCustomer, { order, quotedSinceMap })
  }

  for (const invoice of invoicesWithRemaining) {
    run('invoice_due_soon', evaluateInvoiceDueSoon, { invoice, remainingRial: invoice.remainingRial })
    run('invoice_overdue', evaluateInvoiceOverdue, { invoice, remainingRial: invoice.remainingRial })
  }

  for (const suggestion of suggestions) {
    run('smart_message_review', evaluateSmartMessageReview, { suggestion, isSnoozed: isSuggestionSnoozed(suggestion) })
  }

  return candidates
}
