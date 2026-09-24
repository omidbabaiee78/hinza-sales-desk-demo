import { detectContactPoints, hasAnyContact } from './contactPoints.js'
import { composeAutoIntroEmail, EMAIL_STATE_REASONS } from './autoEmail.js'

// ---------------------------------------------------------------------------
// WhatsApp / Bale introduction - the pure rules shared by the server runner
// (channelOutreachPipeline.js) and the admin pages. Email keeps its own,
// unchanged pipeline (autoEmail.js / autoEmailPipeline.js).
//
// Every registered lead (sales_leads - whatever its origin) is treated the
// same. Per channel, one introduction per NORMALIZED DESTINATION, ever: the
// channel_outreach_messages row for (channel, destination) is unique in the
// database, so a company found by discovery AND uploaded twice is reached
// once. That row is the durable record and moves through:
//
//   waiting_provider - contact found, but the channel's provider is not
//                      configured/enabled: nothing is sent, nothing claimed
//   queued           - provider ready; the next run inside the contact
//                      window sends it
//   sending          - claimed by one run (atomic), provider call in flight
//   sent             - the provider accepted it (NOT proof of delivery)
//   delivered        - the provider reported delivery (needs a status
//                      webhook - not connected yet for either channel)
//   failed           - the provider rejected it (e.g. no Bale account)
//   uncertain        - the call's outcome is unknown; never retried
//   opted_out        - the lead asked not to be contacted
//
// A prepared link or draft is never any of the sent states.
// ---------------------------------------------------------------------------

export const CHANNELS = ['whatsapp', 'bale']

export const CHANNEL_LABELS = { email: 'ایمیل', whatsapp: 'واتساپ', bale: 'بله' }

export const CHANNEL_STATE_LABELS = {
  no_contact: 'اطلاعات تماس برای این کانال ندارد',
  contact_found: 'اطلاعات تماس پیدا شد (در اجرای بعدی ثبت می‌شود)',
  not_configured: 'کانال پیکربندی نشده - چیزی ارسال نمی‌شود',
  queued: 'در صف ارسال',
  sending: 'در حال ارسال',
  sent: 'ارسال شد (سرویس پذیرفت؛ تحویل تأیید نشده)',
  delivered: 'تحویل داده شد',
  failed: 'ناموفق',
  uncertain: 'نتیجه نامشخص - دوباره ارسال نمی‌شود',
  opted_out: 'لغو دریافت / عدم تماس',
  duplicate_destination: 'این مقصد قبلاً برای سرنخ دیگری ثبت شده است',
  already_in_contact: 'قبلاً با این سرنخ در ارتباط هستید - پیام معرفی لازم نیست',
  closed: 'سرنخ تبدیل‌شده یا ازدست‌رفته است',
}

export const DESTINATION_KIND_LABELS = {
  mobile: 'شماره موبایل',
  mobile_unverified: 'شماره موبایل (عضویت در بله تأیید نشده)',
  bale_chat_id: 'شناسه گفتگوی بله',
  email: 'ایمیل',
}

export const MESSAGE_STATUSES = ['waiting_provider', 'queued', 'sending', 'sent', 'delivered', 'failed', 'uncertain', 'opted_out']
export const SENT_STATUSES = new Set(['sent', 'delivered'])

export const CHANNEL_DEFAULT_DAILY_CAP = 20
export const CHANNEL_DEFAULT_MAX_PER_RUN = 5

export function resolveChannelLimits(settings) {
  const cap = Number(settings?.channel_daily_cap)
  const perRun = Number(settings?.channel_max_per_run)
  return {
    dailyCap: Number.isFinite(cap) && cap >= 1 ? Math.min(Math.floor(cap), 100) : CHANNEL_DEFAULT_DAILY_CAP,
    maxPerRun: Number.isFinite(perRun) && perRun >= 1 ? Math.min(Math.floor(perRun), 20) : CHANNEL_DEFAULT_MAX_PER_RUN,
  }
}

// Is a live send possible for this channel + recipient kind? Server-side
// only (credentials come from Edge Function secrets). Every missing piece
// is a reason; `ready` only when there is none.
//   credentials.whatsapp: { accessToken, phoneNumberId, templateName, languageCode }
//   credentials.bale:     { safirApiKey, safirBotId, botToken }
export function channelProviderReadiness(channel, kind, settings, credentials = {}) {
  const reasons = []
  if (channel === 'whatsapp') {
    if (!settings?.whatsapp_provider_enabled) reasons.push('provider_disabled')
    const c = credentials.whatsapp || {}
    if (!c.accessToken || !c.phoneNumberId) reasons.push('credentials_missing')
    if (!c.templateName) reasons.push('template_missing')
    return { ready: reasons.length === 0, reasons, provider: 'whatsapp_cloud_api' }
  }
  if (channel === 'bale') {
    if (!settings?.bale_provider_enabled) reasons.push('provider_disabled')
    const c = credentials.bale || {}
    if (kind === 'bale_chat_id') {
      if (!c.botToken) reasons.push('credentials_missing')
      return { ready: reasons.length === 0, reasons, provider: 'bale_bot' }
    }
    if (!c.safirApiKey || !c.safirBotId) reasons.push('credentials_missing')
    return { ready: reasons.length === 0, reasons, provider: 'bale_safir' }
  }
  return { ready: false, reasons: ['unsupported_channel'], provider: null }
}

export const READINESS_REASON_LABELS = {
  provider_disabled: 'سرویس این کانال در تنظیمات خاموش است',
  credentials_missing: 'کلیدهای سرویس (Edge Function secrets) تنظیم نشده‌اند',
  template_missing: 'قالب پیام تأییدشده واتساپ تنظیم نشده است',
  unsupported_channel: 'کانال پشتیبانی نمی‌شود',
}

const CLOSED_STATUSES = new Set(['converted', 'lost'])

// Opt-out (do_not_contact, or a «لغو» reply), closed, or already in a
// conversation a person is handling. The automatic email intro stamps
// last_contact_at, so that alone does not count here - otherwise one
// channel's introduction would silence the others.
export function leadIntroBlock(lead, { optedOutLeadIds, repliedLeadIds, autoEmailedLeadIds }) {
  if (lead.do_not_contact || optedOutLeadIds.has(lead.id)) return 'opted_out'
  if (CLOSED_STATUSES.has(lead.status)) return 'closed'
  if (repliedLeadIds.has(lead.id)) return 'already_in_contact'
  if (lead.status && lead.status !== 'new') return 'already_in_contact'
  if (lead.last_contact_at && !autoEmailedLeadIds.has(lead.id)) return 'already_in_contact'
  return null
}

export function replySets(replies = [], recipients = []) {
  const optedOutLeadIds = new Set(replies.filter((r) => r.final_intent === 'do_not_contact' || r.predicted_intent === 'do_not_contact').map((r) => r.lead_id))
  const repliedLeadIds = new Set(replies.map((r) => r.lead_id))
  const autoEmailedLeadIds = new Set(recipients.filter((r) => r.lead_id && r.status !== 'failed').map((r) => r.lead_id))
  return { optedOutLeadIds, repliedLeadIds, autoEmailedLeadIds }
}

export function messageKey(channel, destination) {
  return `${channel}|${destination}`
}

// Per lead: its contact points and, per channel, the state to show.
// messages = channel_outreach_messages rows.
export function buildChannelOutreachState({ leads = [], messages = [], replies = [], recipients = [] }) {
  const byKey = new Map(messages.map((m) => [messageKey(m.channel, m.normalized_destination), m]))
  const sets = replySets(replies, recipients)
  return leads.map((lead) => {
    const contacts = detectContactPoints(lead)
    const block = leadIntroBlock(lead, sets)
    const channels = {}
    for (const channel of CHANNELS) {
      const point = contacts[channel]
      if (!point) {
        channels[channel] = { state: 'no_contact', point: null, message: null }
        continue
      }
      const message = byKey.get(messageKey(channel, point.destination)) || null
      if (message && message.lead_id && message.lead_id !== lead.id) {
        channels[channel] = { state: 'duplicate_destination', point, message }
        continue
      }
      if (message) {
        channels[channel] = { state: message.status === 'waiting_provider' ? 'not_configured' : message.status, point, message }
        continue
      }
      channels[channel] = { state: block || 'contact_found', point, message: null }
    }
    return { lead, contacts, hasContact: hasAnyContact(contacts), channels }
  })
}

export function summarizeChannelOutreach(entries) {
  const counts = { leads: entries.length, withContact: 0 }
  for (const channel of CHANNELS) counts[channel] = Object.fromEntries(Object.keys(CHANNEL_STATE_LABELS).map((s) => [s, 0]))
  for (const e of entries) {
    if (e.hasContact) counts.withContact += 1
    for (const channel of CHANNELS) counts[channel][e.channels[channel].state] += 1
  }
  counts.waitingProvider = CHANNELS.reduce((n, c) => n + counts[c].not_configured, 0)
  return counts
}

// The introduction text for WhatsApp/Bale: the same wording as the email
// intro plus an opt-out line. (WhatsApp sends an approved template instead;
// this text is what Bale sends and what is stored as the snapshot.)
export const CHANNEL_OPT_OUT_LINE = 'اگر مایل به دریافت پیام از ما نیستید، «لغو» را ارسال کنید.'

export function composeChannelIntro({ lead, industryLabels = [], products = [] }) {
  const { message } = composeAutoIntroEmail({ companyName: lead.company_name || lead.contact_name, industryLabels, products })
  return `${message.trim()}\n\n${CHANNEL_OPT_OUT_LINE}`
}

// The email column next to WhatsApp/Bale, from the email pipeline's own
// classification (autoEmail.js buildEmailOutreachState).
export function emailStatusLabel(entry) {
  if (!entry) return { key: 'none', text: '—' }
  if (entry.state === 'sent') return entry.kind === 'bounced' ? { key: 'bounced', text: 'برگشت خورد (bounce)' } : { key: 'sent', text: 'ارسال شد' }
  if (entry.state === 'queued') return { key: 'queued', text: 'در صف ارسال' }
  if (entry.state === 'ready') return { key: 'ready', text: 'در اجرای بعدی به صف اضافه می‌شود' }
  return { key: entry.kind || entry.state, text: EMAIL_STATE_REASONS[entry.kind] || entry.state }
}
