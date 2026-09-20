export const OUTREACH_STATUS_LABELS = {
  eligible: 'آماده اقدام',
  blocked: 'مسدود',
  manual_review: 'نیازمند بررسی',
}

export function outreachStatusLabel(status) {
  return OUTREACH_STATUS_LABELS[status] || status
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
