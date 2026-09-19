export const LEAD_STATUSES = [
  'new',
  'contacted',
  'interested',
  'sample_review',
  'quoted',
  'negotiating',
  'converted',
  'lost',
]

// Active pipeline columns only - converted/lost are terminal and shown
// exclusively through the leads list, never as a kanban column.
export const PIPELINE_STATUSES = [
  'new',
  'contacted',
  'interested',
  'sample_review',
  'quoted',
  'negotiating',
]

export const LEAD_STATUS_LABELS = {
  new: 'جدید',
  contacted: 'تماس گرفته شد',
  interested: 'علاقه‌مند',
  sample_review: 'نمونه / بررسی',
  quoted: 'قیمت داده شد',
  negotiating: 'مذاکره',
  converted: 'تبدیل به مشتری',
  lost: 'از دست رفته',
}

// Reuses the app's existing generic status palette (index.css) wherever a
// tone already fits; 'interested' and 'negotiating' get their own tones
// defined locally in AdminLeadsPage.css since no shared token fits them.
export const LEAD_STATUS_TONE = {
  new: 'new',
  contacted: 'contacted',
  interested: 'interested',
  sample_review: 'sample',
  quoted: 'offer',
  negotiating: 'negotiating',
  converted: 'won',
  lost: 'lost',
}

export const LEAD_PRIORITIES = ['low', 'medium', 'high']
export const LEAD_PRIORITY_LABELS = { low: 'کم', medium: 'متوسط', high: 'بالا' }

export const LEAD_SOURCE_LABELS = {
  cold_call: 'تماس سرد',
  referral: 'معرفی',
  website: 'وب‌سایت',
  instagram: 'اینستاگرام',
  exhibition: 'نمایشگاه',
  existing_customer: 'مشتری قبلی',
  whatsapp: 'واتساپ',
  other: 'سایر',
}
export const LEAD_SOURCES = Object.keys(LEAD_SOURCE_LABELS)

// Matches the DB's allowed preferred_channel values exactly - never sent to
// any provider in this phase, only shown as a per-lead preference/label.
export const LEAD_PREFERRED_CHANNEL_LABELS = {
  phone: 'تماس تلفنی',
  whatsapp: 'واتساپ',
  sms: 'پیامک',
  bale: 'بله',
  email: 'ایمیل',
}
export const LEAD_PREFERRED_CHANNELS = Object.keys(LEAD_PREFERRED_CHANNEL_LABELS)

export const LEAD_LOSS_REASON_LABELS = {
  price: 'قیمت',
  competitor: 'خرید از تأمین‌کننده دیگر',
  no_response: 'عدم پاسخ',
  irrelevant: 'محصول نامرتبط',
  no_current_need: 'فعلاً نیاز ندارد',
  other: 'سایر',
}
export const LEAD_LOSS_REASONS = Object.keys(LEAD_LOSS_REASON_LABELS)

export const LEAD_ACTIVITY_TYPE_LABELS = {
  phone: 'تماس',
  whatsapp: 'واتساپ',
  meeting: 'جلسه',
  note: 'یادداشت',
  sample: 'نمونه',
  quote: 'قیمت',
  followup: 'پیگیری',
  status_change: 'تغییر وضعیت',
}

// Logging one of these activity types is a genuine customer-facing contact,
// so it also stamps sales_leads.last_contact_at - 'note' and 'status_change'
// deliberately do not (an internal note isn't a contact).
export const CONTACT_ACTIVITY_TYPES = new Set(['phone', 'whatsapp', 'meeting', 'sample', 'quote'])

export function leadStatusLabel(status) {
  return LEAD_STATUS_LABELS[status] || status
}

export function leadPriorityLabel(priority) {
  return LEAD_PRIORITY_LABELS[priority] || priority || '—'
}

export function leadSourceLabel(source) {
  return LEAD_SOURCE_LABELS[source] || source || '—'
}

export function leadPreferredChannelLabel(channel) {
  return LEAD_PREFERRED_CHANNEL_LABELS[channel] || channel || '—'
}

export function leadLossReasonLabel(reason) {
  return LEAD_LOSS_REASON_LABELS[reason] || reason
}

export function leadActivityTypeLabel(type) {
  return LEAD_ACTIVITY_TYPE_LABELS[type] || type
}

export function leadDisplayName(lead) {
  return lead.company_name || lead.contact_name || '—'
}
