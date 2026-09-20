import { followUpState } from '../utils/leadFollowUp.js'
import { generateAllCandidates } from './ruleDefinitions.js'

// ---------------------------------------------------------------------------
// Pure reconciliation planning - given a snapshot of current business data,
// current automation_rules/settings, and current non-terminal
// automation_tasks, decide exactly what should change. No Supabase calls
// live here; taskService.js applies whatever this returns. Safe to call
// repeatedly with the same input and get the same plan (idempotent), which
// is what makes "run reconciliation 10 times, get zero duplicate tasks" true
// by construction rather than by accident.
// ---------------------------------------------------------------------------

const NON_TERMINAL_STATUSES = new Set(['pending', 'ready', 'waiting_approval', 'snoozed', 'failed'])

export function isNonTerminalStatus(status) {
  return NON_TERMINAL_STATUSES.has(status)
}

// ---- invalidation: does an EXISTING task's underlying record still justify it? ----

function leadInvalidation(task, lead) {
  if (!lead) return { outcome: 'cancel', reason: 'سرنخ مرتبط دیگر یافت نمی‌شود.' }
  if (lead.do_not_contact) return { outcome: 'cancel', reason: 'این سرنخ اکنون عدم تماس دارد.' }
  if (lead.status === 'converted') return { outcome: 'complete', reason: 'سرنخ به مشتری تبدیل شد.' }
  if (lead.status === 'lost') return { outcome: 'cancel', reason: 'سرنخ از دست رفته اعلام شد.' }
  return null // still eligible in general - caller checks the task-type-specific condition
}

function checkLeadFollowupTask(task, lead, expectedState, now) {
  const base = leadInvalidation(task, lead)
  if (base) return base
  if (!lead.next_follow_up_at || lead.next_follow_up_at !== task.due_at) {
    return { outcome: 'cancel', reason: 'پیگیری به زمان جدیدی منتقل شد.' }
  }
  // The date the task was created for is still the lead's current
  // next_follow_up_at, but time may have moved it from "امروز" into
  // "عقب‌افتاده" (or, in principle, the reverse if the clock were wrong) -
  // either way the task's OWN type no longer matches the live state, so it
  // closes; the generation pass creates the correctly-typed replacement.
  const liveState = followUpState(lead.next_follow_up_at, now)
  if (liveState !== expectedState) {
    return { outcome: 'cancel', reason: 'وضعیت پیگیری این سرنخ تغییر کرد.' }
  }
  return null
}

function orderInvalidation(task, order, { completedStatuses, cancelledStatuses, stillValidStatus }) {
  if (!order) return { outcome: 'cancel', reason: 'سفارش مرتبط دیگر یافت نمی‌شود.' }
  if (order.status === stillValidStatus) return null
  if (completedStatuses.includes(order.status)) return { outcome: 'complete', reason: 'سفارش به مرحله بعد پیش رفت.' }
  if (cancelledStatuses.includes(order.status)) return { outcome: 'cancel', reason: 'سفارش رد یا لغو شد.' }
  return { outcome: 'cancel', reason: 'وضعیت سفارش تغییر کرد.' }
}

function invoiceInvalidation(task, invoice) {
  if (!invoice) return { outcome: 'cancel', reason: 'فاکتور مرتبط دیگر یافت نمی‌شود.' }
  if (invoice.status === 'cancelled') return { outcome: 'cancel', reason: 'فاکتور لغو شد.' }
  if (invoice.remainingRial <= 0) return { outcome: 'complete', reason: 'فاکتور تسویه شد.' }
  return null
}

// Returns { outcome: 'cancel'|'complete', reason } to close the task, or
// null (still valid) - optionally with { newPriority } when the task stays
// valid but its priority should be refreshed (age-based escalation).
function evaluateTaskInvalidity(task, data, now) {
  switch (task.task_type) {
    case 'lead_followup_due': {
      const lead = data.leadsById.get(task.lead_id)
      return checkLeadFollowupTask(task, lead, 'today', now)
    }
    case 'lead_followup_overdue': {
      const lead = data.leadsById.get(task.lead_id)
      const closed = checkLeadFollowupTask(task, lead, 'overdue', now)
      if (closed) return closed
      const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(lead.next_follow_up_at).getTime()) / 86400000))
      const rule = data.rulesByType.get('lead_followup_overdue')
      if (!rule) return null
      const newPriority = Math.max(1, Math.round(rule.priority - Math.min(daysOverdue, 15) * (15 / 15)))
      return newPriority !== task.priority ? { newPriority } : null
    }
    case 'lead_first_contact': {
      const lead = data.leadsById.get(task.lead_id)
      const base = leadInvalidation(task, lead)
      if (base) return base
      if (lead.last_contact_at) return { outcome: 'complete', reason: 'اولین تماس با این سرنخ ثبت شد.' }
      if (lead.status !== 'new') return { outcome: 'complete', reason: 'وضعیت این سرنخ پیش رفت.' }
      return null
    }
    case 'prospect_data_incomplete': {
      const lead = data.leadsById.get(task.lead_id)
      const base = leadInvalidation(task, lead)
      if (base) return base
      if (lead.mobile || lead.phone || lead.email) return { outcome: 'complete', reason: 'اطلاعات تماس این سرنخ تکمیل شد.' }
      return null
    }
    case 'order_pending_review':
      return orderInvalidation(task, data.ordersById.get(task.order_id), {
        stillValidStatus: 'pending_review',
        completedStatuses: ['quoted', 'customer_approved', 'admin_approved', 'delivered'],
        cancelledStatuses: ['rejected', 'cancelled'],
      })
    case 'order_customer_approved':
      return orderInvalidation(task, data.ordersById.get(task.order_id), {
        stillValidStatus: 'customer_approved',
        completedStatuses: ['admin_approved', 'delivered'],
        cancelledStatuses: ['rejected', 'cancelled'],
      })
    case 'order_ready_for_delivery':
      return orderInvalidation(task, data.ordersById.get(task.order_id), {
        stillValidStatus: 'ready_for_delivery',
        completedStatuses: ['delivered'],
        cancelledStatuses: ['rejected', 'cancelled'],
      })
    case 'quote_waiting_customer':
      return orderInvalidation(task, data.ordersById.get(task.order_id), {
        stillValidStatus: 'quoted',
        completedStatuses: ['customer_approved', 'admin_approved', 'delivered'],
        cancelledStatuses: ['rejected', 'cancelled'],
      })
    case 'invoice_due_soon':
      return invoiceInvalidation(task, data.invoicesById.get(task.invoice_id))
    case 'invoice_overdue': {
      const invoice = data.invoicesById.get(task.invoice_id)
      const closed = invoiceInvalidation(task, invoice)
      if (closed) return closed
      const daysOverdue = Math.max(
        1,
        Math.floor((now.getTime() - new Date(`${invoice.due_date}T00:00:00+03:30`).getTime()) / 86400000),
      )
      const rule = data.rulesByType.get('invoice_overdue')
      if (!rule) return null
      const newPriority = Math.max(1, Math.round(rule.priority - Math.min(daysOverdue, 20) * (20 / 20)))
      return newPriority !== task.priority ? { newPriority } : null
    }
    case 'smart_message_review': {
      const suggestion = data.suggestionsById.get(task.message_suggestion_id)
      if (!suggestion) return { outcome: 'cancel', reason: 'پیشنهاد پیام مرتبط دیگر یافت نمی‌شود.' }
      if (suggestion.status === 'acted') return { outcome: 'complete', reason: 'اقدام روی این پیشنهاد انجام شد.' }
      if (suggestion.status === 'dismissed' || suggestion.status === 'expired') {
        return { outcome: 'cancel', reason: 'این پیشنهاد دیگر معتبر نیست.' }
      }
      return null
    }
    default:
      return null
  }
}

function buildTaskInsertPayload(candidate, rule, now) {
  const availableAt = new Date(now.getTime() + (rule.delay_minutes || 0) * 60000).toISOString()
  return {
    task_type: candidate.taskType,
    source_type: candidate.sourceType,
    lead_id: candidate.leadId || null,
    company_id: candidate.companyId || null,
    order_id: candidate.orderId || null,
    invoice_id: candidate.invoiceId || null,
    message_suggestion_id: candidate.messageSuggestionId || null,
    dedupe_key: candidate.dedupeKey,
    title: candidate.title,
    reason: candidate.reason,
    context: candidate.context || {},
    priority: candidate.priority,
    autonomy_mode: rule.autonomy_mode,
    due_at: candidate.dueAt || null,
    available_at: availableAt,
    expires_at: null,
    max_attempts: rule.max_attempts,
    status: 'pending',
  }
}

function promotedStatus(task) {
  return task.autonomy_mode === 'approval' ? 'waiting_approval' : 'ready'
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

export function computeReconciliationPlan({ settings, rulesByType, existingTasks, businessData, now }) {
  const toCancel = []
  const toComplete = []
  const toUpdatePriority = []
  const toCreate = []
  const toPromote = []

  const invalidationData = { ...businessData, rulesByType }

  const closedTaskIds = new Set()
  for (const task of existingTasks) {
    const result = evaluateTaskInvalidity(task, invalidationData, now)
    if (!result) continue
    if (result.outcome === 'cancel') {
      toCancel.push({ taskId: task.id, reason: result.reason })
      closedTaskIds.add(task.id)
    } else if (result.outcome === 'complete') {
      toComplete.push({ taskId: task.id, reason: result.reason })
      closedTaskIds.add(task.id)
    } else if (result.newPriority != null) {
      toUpdatePriority.push({ taskId: task.id, newPriority: result.newPriority })
    }
  }

  if (settings.enabled) {
    const survivingDedupeKeys = new Set(
      existingTasks.filter((t) => !closedTaskIds.has(t.id)).map((t) => t.dedupe_key),
    )

    const candidates = generateAllCandidates({ ...businessData, now, rulesByType })
    for (const candidate of candidates) {
      const rule = rulesByType.get(candidate.taskType)
      if (!rule || !rule.enabled) continue
      if (survivingDedupeKeys.has(candidate.dedupeKey)) continue
      toCreate.push(buildTaskInsertPayload(candidate, rule, now))
    }

    for (const task of existingTasks) {
      if (closedTaskIds.has(task.id)) continue
      if (task.status !== 'pending' && task.status !== 'snoozed') continue
      if (!task.available_at || new Date(task.available_at) > now) continue
      toPromote.push({ taskId: task.id, newStatus: promotedStatus(task) })
    }
  }

  return { toCancel, toComplete, toUpdatePriority, toCreate, toPromote }
}
