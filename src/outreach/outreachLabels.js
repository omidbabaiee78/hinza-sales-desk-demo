export const OUTREACH_STATUS_LABELS = {
  eligible: 'آماده اقدام',
  waiting: 'در انتظار',
  blocked: 'مسدود',
  manual_review: 'نیازمند بررسی',
}

export function outreachStatusLabel(status) {
  return OUTREACH_STATUS_LABELS[status] || status
}

// Phase 25 SHADOW MODE - a suggestion's own lifecycle status, distinct from
// outreachStatus above (which is the eligibility VERDICT). 'approved' and
// 'edited' both mean "approved-for-future-send" - neither ever triggers a
// real send in this phase.
export const SHADOW_SUGGESTION_STATUS_LABELS = {
  pending: 'در انتظار تصمیم',
  approved: 'تأییدشده (برای ارسال آینده)',
  edited: 'ویرایش‌شده (برای ارسال آینده)',
  dismissed: 'ردشده',
  snoozed: 'به تعویق افتاده',
  acted: 'اقدام‌شده',
  expired: 'منقضی‌شده',
}

export function shadowSuggestionStatusLabel(status) {
  return SHADOW_SUGGESTION_STATUS_LABELS[status] || status
}

export const OUTREACH_CHANNEL_LABELS = {
  whatsapp: 'واتساپ',
  phone: 'تماس تلفنی',
  sms: 'پیامک',
  email: 'ایمیل',
}

export function outreachChannelLabel(channel) {
  return OUTREACH_CHANNEL_LABELS[channel] || '—'
}

export const ATTEMPT_STATUS_LABELS = {
  prepared: 'آماده‌شده',
  opened: 'بازشده',
  copied: 'کپی‌شده',
  completed: 'انجام‌شده',
  failed: 'ناموفق',
  cancelled: 'لغوشده',
}

export function attemptStatusLabel(status) {
  return ATTEMPT_STATUS_LABELS[status] || status
}
