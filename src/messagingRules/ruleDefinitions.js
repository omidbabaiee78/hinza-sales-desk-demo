import { resolveTransitionTimestamp, hoursSince } from './orderEventResolver'
import { isInvoiceOpen } from '../utils/invoice'

// Lower number = more urgent. Centralized and tunable in one place, per
// reason_key + stage - never scattered through UI/components.
export const PRIORITY = {
  ready_for_delivery: 10,
  invoice_overdue: { 1: 25, 2: 20, 3: 15 },
  quoted_waiting_customer: { 1: 35, 2: 30 },
  order_confirmed: 45,
  invoice_due_soon: 50,
  delivered_followup: 60,
}

// How long a still-`pending` suggestion may sit unacted before the
// reconcile pass expires it anyway (the invalidation backstop).
export const STALE_AFTER_HOURS = {
  quoted_waiting_customer: 24 * 7,
  ready_for_delivery: 24 * 3,
  order_confirmed: 24 * 7,
  delivered_followup: 24 * 5,
  invoice_due_soon: 24 * 5,
  invoice_overdue: 24 * 10,
}

export const MAX_STAGE = {
  quoted_waiting_customer: 2,
  ready_for_delivery: 1,
  order_confirmed: 1,
  delivered_followup: 1,
  invoice_due_soon: 1,
  invoice_overdue: 3,
}

export const GLOBAL_COOLDOWN_HOURS = 24
// The only rule allowed to bypass the 24h "one proactive message per
// company" cooldown - a delivery to coordinate is genuinely time-boxed.
export const BYPASSES_GLOBAL_COOLDOWN = new Set(['ready_for_delivery'])

function stageDone(priorStages, stage) {
  return priorStages.has(stage)
}

// ---- 1. quoted_waiting_customer ---------------------------------------

export function evaluateQuotedWaitingCustomer({ order, quotedSinceMap, now, priorStages, stage1RecommendedAt, hasMeaningfulContactSince }) {
  if (order.status !== 'quoted') return null

  const { timestamp, reliable } = resolveTransitionTimestamp({
    orderId: order.id,
    eventsByStatusMap: quotedSinceMap,
    fallbackIso: order.created_at,
  })
  if (!timestamp) return null
  const hoursSinceQuoted = hoursSince(timestamp, now)

  if (!stageDone(priorStages, 1)) {
    if (hoursSinceQuoted < 18) return null
    if (hasMeaningfulContactSince(timestamp)) return null
    return {
      stage: 1,
      reliableTiming: reliable,
      priority: PRIORITY.quoted_waiting_customer[1],
      confidence: reliable ? 'medium' : 'manual_review',
      explanation: `قیمت سفارش ${order.order_number ?? order.id} حدود ${Math.round(hoursSinceQuoted)} ساعت پیش اعلام شده و هنوز تأیید مشتری ثبت نشده است.`,
      messageContext: { stage: 1 },
    }
  }

  if (!stageDone(priorStages, 2) && stage1RecommendedAt) {
    const hoursSinceStage1 = hoursSince(stage1RecommendedAt, now)
    if (hoursSinceStage1 == null || hoursSinceStage1 < 48) return null
    if (hasMeaningfulContactSince(stage1RecommendedAt)) return null
    return {
      stage: 2,
      reliableTiming: reliable,
      priority: PRIORITY.quoted_waiting_customer[2],
      confidence: 'medium',
      explanation: `قیمت سفارش ${order.order_number ?? order.id} حدود ${Math.round(hoursSinceQuoted)} ساعت پیش اعلام شده و پس از یادآوری اول هم همچنان تأیید نشده است.`,
      messageContext: { stage: 2 },
    }
  }

  return null
}

// ---- 2. ready_for_delivery ---------------------------------------------

export function evaluateReadyForDelivery({ order, readySinceMap, now, hasPhone }) {
  if (order.status !== 'ready_for_delivery') return null
  const { timestamp, reliable } = resolveTransitionTimestamp({
    orderId: order.id,
    eventsByStatusMap: readySinceMap,
    fallbackIso: order.created_at,
  })
  const hours = hoursSince(timestamp, now)
  return {
    stage: 1,
    reliableTiming: reliable,
    priority: PRIORITY.ready_for_delivery,
    confidence: reliable && hasPhone ? 'high' : 'manual_review',
    explanation: `سفارش ${order.order_number ?? order.id} آماده تحویل شده${hours != null ? ` (حدود ${Math.round(hours)} ساعت پیش)` : ''} و هنوز ارتباطی برای هماهنگی ثبت نشده است.`,
    messageContext: { stage: 1 },
  }
}

// ---- 3. order_confirmed --------------------------------------------------

export function evaluateOrderConfirmed({ order, approvedSinceMap, now, hasMeaningfulContactSince }) {
  if (order.status !== 'admin_approved') return null
  const { timestamp, reliable } = resolveTransitionTimestamp({
    orderId: order.id,
    eventsByStatusMap: approvedSinceMap,
    fallbackIso: null, // no reliable fallback for "newly changed" - skip rather than guess
  })
  if (!timestamp) return null
  const hours = hoursSince(timestamp, now)
  if (hours == null || hours > 48) return null // only "newly" changed
  if (hasMeaningfulContactSince(timestamp)) return null

  return {
    stage: 1,
    reliableTiming: reliable,
    priority: PRIORITY.order_confirmed,
    confidence: 'high',
    explanation: `سفارش ${order.order_number ?? order.id} حدود ${Math.round(hours)} ساعت پیش تأیید شده و هنوز اطلاع‌رسانی به مشتری ثبت نشده است.`,
    messageContext: { stage: 1 },
  }
}

// ---- 4. delivered_followup ------------------------------------------------

export function evaluateDeliveredFollowup({ order, deliveredSinceMap, now }) {
  if (order.status !== 'delivered') return null
  const { timestamp, reliable } = resolveTransitionTimestamp({
    orderId: order.id,
    eventsByStatusMap: deliveredSinceMap,
    fallbackIso: order.created_at,
  })
  const hours = hoursSince(timestamp, now)
  if (hours == null || hours < 24 || hours > 96) return null

  return {
    stage: 1,
    reliableTiming: reliable,
    priority: PRIORITY.delivered_followup,
    confidence: 'medium',
    explanation: `سفارش ${order.order_number ?? order.id} حدود ${Math.round(hours)} ساعت پیش تحویل داده شده؛ فرصت مناسبی برای یک پیگیری کوتاه رضایت مشتری است.`,
    messageContext: { stage: 1 },
  }
}

// ---- 5. invoice_due_soon ---------------------------------------------------

export function evaluateInvoiceDueSoon({ invoice, remainingRial, now }) {
  if (!invoice.due_date || remainingRial <= 0) return null
  const dueDate = new Date(`${invoice.due_date}T00:00:00`)
  const daysUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (daysUntilDue < 1 || daysUntilDue > 2) return null

  return {
    stage: 1,
    reliableTiming: true,
    priority: PRIORITY.invoice_due_soon,
    confidence: 'medium',
    explanation: `فاکتور ${invoice.invoice_number ?? invoice.id} حدود ${Math.round(daysUntilDue)} روز دیگر سررسید می‌شود و همچنان مانده پرداخت دارد.`,
    messageContext: { stage: 1 },
  }
}

// ---- 6. invoice_overdue -----------------------------------------------------

export function evaluateInvoiceOverdue({ invoice, remainingRial, now, priorStages }) {
  if (!invoice.due_date || remainingRial <= 0) return null
  const dueDate = new Date(`${invoice.due_date}T00:00:00`)
  const daysOverdue = (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
  if (daysOverdue < 1) return null

  const stage = stageDone(priorStages, 3)
    ? null
    : stageDone(priorStages, 2) && daysOverdue >= 14
      ? 3
      : stageDone(priorStages, 1) && !stageDone(priorStages, 2) && daysOverdue >= 7
        ? 2
        : !stageDone(priorStages, 1) && daysOverdue >= 1
          ? 1
          : null
  if (!stage) return null

  const largeAmount = remainingRial >= 500_000_000 // tunable threshold, deliberately not hidden
  return {
    stage,
    reliableTiming: true,
    priority: PRIORITY.invoice_overdue[stage],
    confidence: stage === 3 || largeAmount ? 'manual_review' : 'high',
    explanation: `فاکتور ${invoice.invoice_number ?? invoice.id} حدود ${Math.round(daysOverdue)} روز از سررسید گذشته و همچنان مانده پرداخت دارد.`,
    messageContext: { stage },
  }
}

// ---- invalidation (used by the reconcile pass) -----------------------------

// True if a still-`pending` suggestion's underlying condition no longer
// holds - the order/invoice moved on, or vanished. The reconcile pass turns
// this into status='expired', never a delete (keeps audit history).
export function shouldInvalidate(suggestion, { order, invoice }) {
  switch (suggestion.reason_key) {
    case 'quoted_waiting_customer':
      return !order || order.status !== 'quoted'
    case 'ready_for_delivery':
      return !order || order.status !== 'ready_for_delivery'
    case 'order_confirmed':
      return !order || order.status !== 'admin_approved'
    case 'delivered_followup':
      return !order || order.status !== 'delivered'
    case 'invoice_due_soon':
    case 'invoice_overdue':
      return !invoice || !isInvoiceOpen(invoice.status)
    default:
      return false
  }
}
