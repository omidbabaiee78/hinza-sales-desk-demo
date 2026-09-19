// Persian UI labels only - task_type/status/autonomy_mode/event_type are
// internal keys everywhere else (reconciler, DB), never shown raw.

export const TASK_TYPE_LABELS = {
  lead_first_contact: 'فرصت تماس اولیه',
  lead_followup_due: 'پیگیری سرنخ امروز',
  lead_followup_overdue: 'پیگیری سرنخ عقب‌افتاده',
  order_pending_review: 'نیاز به اعلام قیمت',
  order_customer_approved: 'نیاز به تأیید سفارش',
  order_ready_for_delivery: 'هماهنگی تحویل سفارش',
  quote_waiting_customer: 'منتظر تأیید مشتری',
  invoice_due_soon: 'فاکتور نزدیک به سررسید',
  invoice_overdue: 'فاکتور عقب‌افتاده',
  smart_message_review: 'پیشنهاد هوشمند پیام',
  prospect_data_incomplete: 'تکمیل اطلاعات تماس سرنخ',
  internal_reconciliation: 'همگام‌سازی داخلی',
}

export function taskTypeLabel(type) {
  return TASK_TYPE_LABELS[type] || type
}

export const TASK_STATUS_LABELS = {
  pending: 'در انتظار',
  ready: 'آماده اقدام',
  waiting_approval: 'نیازمند تأیید',
  running: 'در حال اجرا',
  completed: 'تکمیل‌شده',
  snoozed: 'به تعویق افتاده',
  cancelled: 'لغوشده',
  expired: 'منقضی‌شده',
  failed: 'ناموفق',
}

export function taskStatusLabel(status) {
  return TASK_STATUS_LABELS[status] || status
}

export const AUTONOMY_MODE_LABELS = {
  observe: 'مشاهده',
  approval: 'با تأیید',
  auto: 'خودکار',
}

export function autonomyModeLabel(mode) {
  return AUTONOMY_MODE_LABELS[mode] || mode
}

export const TASK_EVENT_TYPE_LABELS = {
  created: 'ایجاد شد',
  became_ready: 'آماده اقدام شد',
  approved: 'تأیید شد',
  executed: 'اجرا شد',
  completed: 'تکمیل شد',
  failed: 'ناموفق بود',
  retried: 'تلاش مجدد',
  snoozed: 'به تعویق افتاد',
  cancelled: 'لغو شد',
  expired: 'منقضی شد',
  reconciled: 'به‌روزرسانی شد',
}

export function taskEventTypeLabel(type) {
  return TASK_EVENT_TYPE_LABELS[type] || type
}
