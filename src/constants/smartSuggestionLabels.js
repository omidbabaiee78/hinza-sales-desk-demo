export const REASON_LABELS = {
  quoted_waiting_customer: 'پیگیری قیمت (منتظر تأیید مشتری)',
  ready_for_delivery: 'آماده تحویل',
  order_confirmed: 'تأیید سفارش',
  delivered_followup: 'پیگیری پس از تحویل',
  invoice_due_soon: 'سررسید نزدیک فاکتور',
  invoice_overdue: 'فاکتور سررسید گذشته',
}

export const CONFIDENCE_LABELS = {
  high: 'اطمینان بالا',
  medium: 'اطمینان متوسط',
  manual_review: 'نیاز به بررسی دستی',
}

export const CONFIDENCE_TONE = {
  high: 'success',
  medium: 'warning',
  manual_review: 'danger',
}
