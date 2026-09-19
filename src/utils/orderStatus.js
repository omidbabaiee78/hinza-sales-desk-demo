// Internal database statuses (kept as-is for compatibility with existing
// data and RLS). "preparing" and "ready_for_delivery" are no longer produced
// by the app's own workflow, but old orders may still carry them.
export const ORDER_STATUSES = [
  'pending_review',
  'quoted',
  'customer_approved',
  'admin_approved',
  'preparing',
  'ready_for_delivery',
  'delivered',
  'rejected',
  'cancelled',
]

// Trimmed list for status filter dropdowns, so admins never see two
// "در حال انجام" entries for statuses that no longer exist in the visible flow.
export const VISIBLE_ORDER_STATUSES = [
  'pending_review',
  'quoted',
  'customer_approved',
  'admin_approved',
  'delivered',
  'rejected',
  'cancelled',
]

export const STATUS_LABELS = {
  pending_review: 'منتظر قیمت',
  quoted: 'قیمت آماده است',
  customer_approved: 'تأیید شما ثبت شد',
  admin_approved: 'سفارش تأیید شد',
  preparing: 'در حال انجام',
  ready_for_delivery: 'در حال انجام',
  delivered: 'تحویل شد',
  rejected: 'رد شد',
  cancelled: 'لغو شد',
}

export const EVENT_LABELS = {
  pending_review: 'سفارش ثبت شد',
  quoted: 'قیمت توسط هینزا اعلام شد',
  customer_approved: 'قیمت توسط مشتری تأیید شد',
  admin_approved: 'سفارش توسط هینزا تأیید شد',
  preparing: 'در حال انجام',
  ready_for_delivery: 'در حال انجام',
  delivered: 'تحویل شد',
  rejected: 'سفارش رد شد',
  cancelled: 'سفارش لغو شد',
}

export const STATUS_TONE = {
  pending_review: 'neutral',
  quoted: 'warning',
  customer_approved: 'warning',
  admin_approved: 'warning',
  preparing: 'warning',
  ready_for_delivery: 'warning',
  delivered: 'success',
  rejected: 'danger',
  cancelled: 'danger',
}

export const TERMINAL_STATUSES = ['delivered', 'rejected', 'cancelled']

// "سفارش مجدد" only makes sense once an order is no longer actively awaiting
// someone's action - i.e. everything except the three in-progress statuses.
// This intentionally covers admin_approved/preparing/ready_for_delivery too,
// not just the terminal ones.
const IN_PROGRESS_STATUSES = ['pending_review', 'quoted', 'customer_approved']

export function canReorderFromStatus(status) {
  return !IN_PROGRESS_STATUSES.includes(status)
}

// admin_approved now goes straight to delivered (no preparing / ready_for_delivery
// step in the normal flow). Old orders already sitting in one of those two
// legacy statuses can still be moved straight to delivered.
const ADMIN_TRANSITIONS = {
  pending_review: ['quoted', 'rejected'],
  quoted: ['rejected'],
  customer_approved: ['admin_approved', 'rejected'],
  admin_approved: ['delivered', 'rejected'],
  preparing: ['delivered'],
  ready_for_delivery: ['delivered'],
  delivered: [],
  rejected: [],
  cancelled: [],
}

const CUSTOMER_TRANSITIONS = {
  pending_review: ['cancelled'],
  quoted: ['customer_approved'],
}

export function getAllowedTransitions(status, role) {
  if (role === 'admin') return ADMIN_TRANSITIONS[status] || []
  if (role === 'customer') return CUSTOMER_TRANSITIONS[status] || []
  return []
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || status
}

export function eventLabel(eventType) {
  return EVENT_LABELS[eventType] || eventType
}
