import { evaluateCooldown, countQualifyingAttempts } from './cooldown.js'
import { evaluateContactWindow } from './contactWindow.js'
import { isValidIranMobile, toE164Iran } from '../utils/phone.js'
import { splitContactDisplay } from '../utils/leadImport/contactNumbers.js'
import { hasUsableText } from './shared.js'
import { isProviderChannel } from './providers/index.js'

// ---------------------------------------------------------------------------
// Phase 26 - the ONE fail-closed gate a real provider send must pass. Pure
// function, no Supabase/fetch/Deno - every condition is checked
// independently and ALL must pass; a single failure blocks the send with a
// specific, explainable reason (never a silent partial send). Mirrors the
// existing src/outreach/eligibility.js discipline for the SHADOW/manual
// flow, extended with the provider-specific conditions Phase 26 adds
// (outreach_enabled, per-channel provider toggle, approval state, message_
// final, credentials, idempotency, test-mode recipient).
// ---------------------------------------------------------------------------

const APPROVED_STATUSES = new Set(['approved', 'edited'])

function firstValidMobile(lead) {
  const candidates = splitContactDisplay(lead?.mobile)
  const list = candidates.length > 0 ? candidates : [lead?.mobile]
  return list.find((v) => isValidIranMobile(v)) || null
}

// The REAL recipient this lead's own contact data resolves to for a given
// channel - never a test destination. null when no usable contact exists.
export function resolveRealRecipient(lead, channel) {
  if (channel === 'whatsapp') {
    const mobile = firstValidMobile(lead)
    return mobile ? toE164Iran(mobile) : null
  }
  if (channel === 'email') {
    return hasUsableText(lead?.email) ? lead.email.trim() : null
  }
  return null
}

// Never logs/returns the raw value - a masked fingerprint only, safe to
// store in outreach_attempts.recipient_masked and to show in the UI/logs.
export function maskRecipient(recipient, channel) {
  if (!recipient) return null
  if (channel === 'email') {
    const [local, domain] = recipient.split('@')
    if (!domain) return '***'
    const visible = local.slice(0, 1)
    return `${visible}${'*'.repeat(Math.max(local.length - 1, 3))}@${domain}`
  }
  // phone-like (whatsapp/sms) - keep only the last 4 digits visible.
  const digits = recipient.replace(/[^0-9]/g, '')
  if (digits.length <= 4) return '***'
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}

// Shared with sendPipeline.js so BOTH the gate's own decision and the
// idempotency-key/claim scoping sendPipeline.js derives from it are
// guaranteed to agree on whether this is a test or production send - two
// independent copies of this formula would risk drifting apart and letting
// a test send slip onto the production idempotency key (or vice versa).
export function resolveEffectiveTestMode(settings, testMode) {
  const persistedTestMode = settings?.provider_test_mode ?? true
  const explicitTestIntent = testMode === true
  return persistedTestMode || explicitTestIntent
}

// Returns { allowed, reasons, recipient, realRecipient, testMode }.
// `credentialsConfigured` and `duplicateIdempotencyExists` are supplied by
// the caller (sendPipeline.js) since only it has DB/Edge-Function-secret
// access - this function stays pure and fully unit-testable.
export function evaluateSendGate({
  suggestion,
  lead,
  settings,
  leadAttempts = [],
  credentialsConfigured = false,
  duplicateIdempotencyExists = false,
  testMode,
  // { whatsapp: 'E.164 test number' | null, email: 'test@address' | null } -
  // read from Edge Function secrets by the caller, never from settings/DB.
  testRecipients = {},
  now = new Date(),
}) {
  const reasons = []
  const channel = suggestion?.channel

  const effectiveTestMode = resolveEffectiveTestMode(settings, testMode)

  // A controlled, explicitly-requested admin TEST send is allowed to bypass
  // the global outreach_enabled kill switch - a production send never is,
  // regardless of testMode. Deliberately narrow: email channel only (the
  // only channel this admin test path is specified/wired for - see
  // EMAIL_TEST_RECIPIENT below), and only on an explicit request, never
  // merely because provider_test_mode happens to default to true.
  const isExplicitEmailTestSend = channel === 'email' && testMode === true

  if (!settings?.outreach_enabled && !isExplicitEmailTestSend) {
    reasons.push('ارسال واقعی در تنظیمات سیستم غیرفعال است (outreach_enabled=false).')
  }

  if (!isProviderChannel(channel)) {
    reasons.push(`کانال «${channel}» برای ارسال واقعی پشتیبانی نمی‌شود.`)
  } else {
    const providerEnabledKey = channel === 'whatsapp' ? 'whatsapp_provider_enabled' : 'email_provider_enabled'
    if (!settings?.[providerEnabledKey]) {
      reasons.push(`سرویس ارسال برای کانال «${channel}» فعال نشده است.`)
    }
  }

  if (!lead) {
    reasons.push('سرنخ مرتبط دیگر یافت نمی‌شود.')
  } else {
    if (lead.do_not_contact) reasons.push('این سرنخ عدم تماس دارد.')
    if (lead.status === 'converted') reasons.push('این سرنخ به مشتری تبدیل شده است.')
    if (lead.status === 'lost') reasons.push('این سرنخ از دست رفته است.')
  }

  if (!suggestion) {
    reasons.push('پیشنهاد مرتبط یافت نمی‌شود.')
  } else if (!APPROVED_STATUSES.has(suggestion.status)) {
    reasons.push('پیشنهاد هنوز توسط ادمین تأیید نشده است.')
  }

  const finalMessage = suggestion?.message_final || (suggestion?.status === 'approved' ? suggestion?.message_draft : null)
  if (!hasUsableText(finalMessage)) {
    reasons.push('متن نهایی پیام موجود نیست.')
  }

  const realRecipient = lead ? resolveRealRecipient(lead, channel) : null
  if (!realRecipient) {
    reasons.push('اطلاعات تماس معتبر برای این کانال موجود نیست.')
  }

  const testRecipientConfigured = channel === 'whatsapp' ? Boolean(testRecipients.whatsapp) : Boolean(testRecipients.email)
  if (effectiveTestMode && !testRecipientConfigured) {
    reasons.push('حالت آزمایشی فعال است اما مقصد آزمایشی برای این کانال پیکربندی نشده است.')
  }

  if (!credentialsConfigured) {
    reasons.push('اطلاعات اعتبارسنجی (credentials) سرویس ارسال برای این کانال پیکربندی نشده است.')
  }

  const cooldownHours = settings?.outreach_cooldown_hours ?? 20
  const cooldown = evaluateCooldown(leadAttempts, cooldownHours, now)
  if (cooldown.withinCooldown) {
    reasons.push(`اخیراً برای این سرنخ اقدام ثبت شده - طبق فاصله زمانی مجاز (${cooldownHours} ساعت) هنوز زود است.`)
  }

  const maxAttempts = settings?.max_contact_attempts ?? 6
  if (countQualifyingAttempts(leadAttempts) >= maxAttempts) {
    reasons.push(`به حداکثر تعداد تلاش مجاز (${maxAttempts} بار) رسیده است.`)
  }

  const window = evaluateContactWindow(settings, now)
  if (!window.withinWindow) {
    reasons.push('خارج از بازه زمانی مجاز تماس است.')
  }

  if (duplicateIdempotencyExists) {
    reasons.push('این پیام قبلاً با همین کلید یکتا ارسال شده است (idempotency) - ارسال مجدد مجاز نیست.')
  }

  const recipient = effectiveTestMode ? (channel === 'whatsapp' ? testRecipients.whatsapp : testRecipients.email) || null : realRecipient

  return {
    allowed: reasons.length === 0,
    reasons,
    recipient,
    realRecipient,
    testMode: effectiveTestMode,
  }
}
