import { summarizeOrderProducts } from './productIntelligence'

const DAY_MS = 24 * 60 * 60 * 1000
const QUOTE_FOLLOWUP_THRESHOLD_DAYS = 2
const NEW_CUSTOMER_WINDOW_DAYS = 30
const DELIVERED_FOLLOWUP_MIN_DAYS = 3
const DELIVERED_FOLLOWUP_MAX_DAYS = 7

// Larger buckets first: whichever is met by the actual day count wins.
const INACTIVITY_BUCKETS = [90, 60, 30]

export function daysBetween(fromIso, now = new Date()) {
  if (!fromIso) return null
  const from = new Date(fromIso)
  if (Number.isNaN(from.getTime())) return null
  return Math.floor((now.getTime() - from.getTime()) / DAY_MS)
}

export function inactivityBucket(daysSincePurchase) {
  if (daysSincePurchase == null) return null
  for (const bucket of INACTIVITY_BUCKETS) {
    if (daysSincePurchase >= bucket) return bucket
  }
  return null
}

// Simple 1-5 priority model (never shown as a number - only used to pick
// the single headline reason and to sort the CRM list).
export const CRM_PRIORITY = {
  OVERDUE_PAYMENT: 1,
  ADMIN_ACTION: 2,
  QUOTE_WAITING: 3,
  INACTIVE: 4,
  GENERAL: 5,
}

function overduePaymentReason({ overdueInvoice }) {
  if (!overdueInvoice) return null
  const days = daysBetween(overdueInvoice.due_date)
  return {
    key: 'payment_followup',
    priority: CRM_PRIORITY.OVERDUE_PAYMENT,
    label: 'پیگیری تسویه',
    detail: `فاکتور ${overdueInvoice.invoice_number ?? overdueInvoice.id} - ${days ?? 0} روز تأخیر`,
    remainingRial: overdueInvoice.remainingRial ?? null,
    daysOverdue: days,
    action: { type: 'invoice', id: overdueInvoice.id },
    nextAction: 'پیگیری تسویه',
    meta: {
      invoiceNumber: overdueInvoice.invoice_number ?? overdueInvoice.id,
      outstandingAmount: overdueInvoice.remainingRial,
    },
  }
}

function adminActionReason({ approvedOrder }) {
  if (!approvedOrder) return null
  return {
    key: 'admin_action',
    priority: CRM_PRIORITY.ADMIN_ACTION,
    label: 'نیاز به تأیید سفارش',
    detail: `سفارش ${approvedOrder.order_number ?? approvedOrder.id} منتظر تأیید هینزا است`,
    action: { type: 'order', id: approvedOrder.id },
    nextAction: 'نیاز به تأیید سفارش',
    meta: { orderNumber: approvedOrder.order_number ?? approvedOrder.id },
  }
}

function quoteFollowupReason({ quotedOrder, quotedSinceDays }) {
  if (!quotedOrder) return null
  const isOverdue = quotedSinceDays != null && quotedSinceDays >= QUOTE_FOLLOWUP_THRESHOLD_DAYS
  return {
    key: 'quote_followup',
    priority: CRM_PRIORITY.QUOTE_WAITING,
    label: isOverdue ? 'پیگیری قیمت' : 'منتظر پاسخ مشتری',
    detail: isOverdue
      ? `${quotedSinceDays} روز از اعلام قیمت سفارش ${quotedOrder.order_number ?? quotedOrder.id} گذشته`
      : `منتظر پاسخ مشتری برای سفارش ${quotedOrder.order_number ?? quotedOrder.id}`,
    action: { type: 'order', id: quotedOrder.id },
    nextAction: 'پیگیری قیمت',
    meta: {
      orderNumber: quotedOrder.order_number ?? quotedOrder.id,
      productSummary: summarizeOrderProducts(quotedOrder.order_items),
    },
  }
}

function inactivityReason({ daysSincePurchase }) {
  const bucket = inactivityBucket(daysSincePurchase)
  if (!bucket) return null
  return {
    key: 'inactivity',
    priority: CRM_PRIORITY.INACTIVE,
    label: `خرید غیرفعال (${bucket}+ روز)`,
    detail: `${daysSincePurchase} روز از آخرین خرید گذشته`,
    action: null,
    nextAction: 'تماس مجدد',
    meta: {},
  }
}

// Only for customers with zero orders ever - a brand-new customer with a
// purchase history is never labeled "new" here.
function newCustomerReason({ hasEverOrdered, representativeCreatedAt }) {
  if (hasEverOrdered) return null
  const days = daysBetween(representativeCreatedAt)
  if (days == null || days > NEW_CUSTOMER_WINDOW_DAYS) return null
  return {
    key: 'new_customer',
    priority: CRM_PRIORITY.GENERAL,
    label: 'مشتری جدید',
    detail: 'مشتری جدید — هنوز سفارشی ثبت نکرده',
    action: null,
    nextAction: 'تماس آشناسازی',
    meta: {},
  }
}

function deliveredFollowupReason({ lastDeliveredOrder }) {
  if (!lastDeliveredOrder) return null
  const days = daysBetween(lastDeliveredOrder.created_at)
  if (days == null || days < DELIVERED_FOLLOWUP_MIN_DAYS || days > DELIVERED_FOLLOWUP_MAX_DAYS) {
    return null
  }
  return {
    key: 'delivered_followup',
    priority: CRM_PRIORITY.GENERAL,
    label: 'پیگیری رضایت / سفارش بعدی',
    detail: `${days} روز از تحویل سفارش ${lastDeliveredOrder.order_number ?? lastDeliveredOrder.id} گذشته`,
    action: { type: 'order', id: lastDeliveredOrder.id },
    nextAction: 'تماس مجدد',
    meta: {
      orderNumber: lastDeliveredOrder.order_number ?? lastDeliveredOrder.id,
      productSummary: summarizeOrderProducts(lastDeliveredOrder.order_items),
    },
  }
}

// Rules A-F, combined and priority-sorted. Callers filter out any reason
// whose key is currently snoozed before picking the headline one.
export function computeCustomerAttention(input) {
  const reasons = [
    overduePaymentReason(input),
    adminActionReason(input),
    quoteFollowupReason(input),
    inactivityReason(input),
    newCustomerReason(input),
    deliveredFollowupReason(input),
  ].filter(Boolean)

  reasons.sort((a, b) => a.priority - b.priority)

  return reasons
}

export function deriveNextAction(reasons) {
  return reasons[0]?.nextAction || 'فعلاً اقدامی لازم نیست'
}

// Simple, documented segments - no scoring. "مشتری وفادار" is intentionally
// left out here: it depends on the same get_pricing_suggestion RPC the order
// screens already use, which is per-company/product and too expensive to
// call for every row of the CRM list, so it is only shown on the customer's
// own 360 profile (reusing that existing RPC-backed logic).
export function deriveSegments({ hasEverOrdered, daysSincePurchase, balance, representativeCreatedAt }) {
  const segments = []
  const newCustomerDays = daysBetween(representativeCreatedAt)
  if (!hasEverOrdered) {
    if (newCustomerDays != null && newCustomerDays <= NEW_CUSTOMER_WINDOW_DAYS) {
      segments.push('مشتری جدید')
    }
  } else if (inactivityBucket(daysSincePurchase)) {
    segments.push('مشتری غیرفعال')
  } else {
    segments.push('مشتری فعال')
  }
  if (Number(balance) > 0) segments.push('دارای مانده حساب')
  return segments
}

// Maps an attention-item key to the crm_communications.reason value, so
// quick-contact actions and the communication history use one shared
// vocabulary instead of two independently invented ones.
export function dbReasonForAttentionKey(key) {
  if (key === 'quote_followup') return 'quote_followup'
  if (key === 'payment_followup') return 'payment_followup'
  if (key === 'inactivity') return 'inactive_followup'
  if (key === 'delivered_followup') return 'order_followup'
  return 'general'
}

// crm_snoozes' unique index is (company_id, reason_key, order_id,
// invoice_id) - a reason tied to one specific order/invoice can be snoozed
// independently of a same-typed reason tied to a different one (e.g. a new
// quote created after an old one was snoozed isn't accidentally suppressed).
export function snoozeSignature(reasonKey, orderId, invoiceId) {
  return `${reasonKey}|${orderId || ''}|${invoiceId || ''}`
}

// Convenience: pull {orderId, invoiceId} straight out of a reason's `action`.
export function reasonContext(reason) {
  return {
    orderId: reason?.action?.type === 'order' ? reason.action.id : null,
    invoiceId: reason?.action?.type === 'invoice' ? reason.action.id : null,
  }
}
