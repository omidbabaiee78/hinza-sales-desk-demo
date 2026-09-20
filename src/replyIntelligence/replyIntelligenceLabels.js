export const REPLY_CHANNEL_LABELS = {
  whatsapp: 'واتساپ',
  sms: 'پیامک',
  phone: 'تماس تلفنی',
  email: 'ایمیل',
  manual: 'ثبت دستی',
  other: 'سایر',
}
export const REPLY_CHANNELS = Object.keys(REPLY_CHANNEL_LABELS)

export function replyChannelLabel(channel) {
  return REPLY_CHANNEL_LABELS[channel] || channel || '—'
}

// Internal confidence values -> the ONLY vocabulary an admin should ever
// see (never "confidence: medium" or a raw score).
export const REPLY_CONFIDENCE_LABELS = {
  high: 'اطمینان بالا',
  medium: 'اطمینان متوسط',
  low: 'اطمینان کم',
  manual_review: 'نیازمند بررسی',
}

export function replyConfidenceLabel(confidence) {
  return REPLY_CONFIDENCE_LABELS[confidence] || 'نامشخص'
}

export const ACTION_KEY_LABELS = {
  prepare_needs_assessment: 'نیازسنجی و ادامه گفتگو',
  prepare_quote: 'آماده‌سازی قیمت',
  answer_product_question: 'پاسخ به سؤال محصول',
  review_sample_request: 'بررسی ارسال نمونه',
  create_call_task: 'تماس در اولین فرصت',
  set_follow_up: 'تنظیم پیگیری',
  schedule_later_follow_up: 'پیگیری در آینده نزدیک',
  reduce_outreach: 'کاهش پیگیری فعال',
  block_contact: 'توقف کامل تماس',
  mark_wrong_contact: 'توقف تا اصلاح اطلاعات تماس',
  long_term_follow_up: 'پیگیری بلندمدت',
  provide_more_information: 'ارسال اطلاعات تکمیلی',
  manual_review: 'بررسی دستی',
}

export function actionKeyLabel(actionKey) {
  return ACTION_KEY_LABELS[actionKey] || actionKey || '—'
}
