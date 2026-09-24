export const CRM_CHANNEL_LABELS = { phone: 'تماس', whatsapp: 'واتساپ', sms: 'پیامک' }

export const CRM_REASON_LABELS = {
  quote_followup: 'پیگیری قیمت',
  payment_followup: 'پیگیری تسویه',
  inactive_followup: 'پیگیری مشتری غیرفعال',
  order_followup: 'پیگیری سفارش',
  general: 'ارتباط عمومی',
}

// For WhatsApp deep-link/manual mode this is intentionally never "delivered"
// - opening wa.me only proves the admin opened the conversation, not that
// the customer received anything.
export const CRM_COMM_STATUS_LABELS = {
  manual_action: 'ثبت دستی',
  opened: 'لینک واتساپ باز شد (ارسال تأیید نشده)',
  copied: 'متن کپی شد (ارسال تأیید نشده)',
  sent: 'ارسال شد',
  delivered: 'تحویل داده شد',
  failed: 'ناموفق',
}
