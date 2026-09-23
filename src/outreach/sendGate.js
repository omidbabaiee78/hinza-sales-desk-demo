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

// The exact email the provider receives, shared by sendPipeline.js (server)
// and the admin confirmation dialog so what the admin confirms is what is
// sent. Every email ends with the opt-out instruction; a «لغو» reply is
// recognized as do_not_contact by replyIntelligence/classifyReply.js, and
// once an admin confirms it (reply inbox, or "ثبت لغو دریافت" on the
// outreach card) sales_leads.do_not_contact blocks every future send below.
export const DEFAULT_EMAIL_SUBJECT = 'پیام از هینزا پلیمر'
export const EMAIL_OPT_OUT_FOOTER = 'اگر مایل به دریافت ایمیل از ما نیستید، در پاسخ به همین ایمیل فقط بنویسید «لغو» تا دیگر برایتان ایمیلی ارسال نشود.'

export function emailSubjectFor(suggestion) {
  return hasUsableText(suggestion?.subject_draft) ? suggestion.subject_draft : DEFAULT_EMAIL_SUBJECT
}

export function buildEmailBody(message) {
  return `${(message || '').trim()}\n\n—\n${EMAIL_OPT_OUT_FOOTER}`
}

// The one idempotency-key formula, shared by sendPipeline.js (server) and
// previewFirstEmailSend() below (admin UI) so both always agree.
export function sendIdempotencyKey(suggestionId, testMode) {
  return testMode ? `test-send:${suggestionId}` : `send:${suggestionId}`
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
  // A prior 'sent' attempt on THIS key whose test_mode contradicts the key
  // (see classifySendAttempts) - delivery mode can't be determined, so it
  // blocks like a duplicate, with its own reason, until reconciled.
  ambiguousPriorDelivery = false,
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
    // Same block either way - only the wording says which kind of delivery
    // the existing key belongs to, so a test delivery is never reported as
    // having reached the prospect.
    reasons.push(
      effectiveTestMode
        ? 'این پیام قبلاً در حالت آزمایشی فقط به نشانی آزمایشی ارسال شده است، نه به مشتری (idempotency) - ارسال آزمایشی مجدد مجاز نیست.'
        : 'این پیام قبلاً برای مشتری ارسال شده است (idempotency) - ارسال مجدد مجاز نیست.',
    )
  }

  if (ambiguousPriorDelivery) {
    reasons.push(AMBIGUOUS_PRIOR_DELIVERY_REASON)
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

// Sorts one suggestion's provider-send attempts (outreach_attempts rows)
// into the delivery states the admin must be able to tell apart. Test and
// real deliveries use separate keys (test-send:<id> / send:<id>) and every
// attempt records test_mode, so no guessing is needed - EXCEPT when a row's
// key and test_mode disagree (e.g. a test delivery recorded on the real
// send: key by an earlier version of the send code). That row is
// "ambiguous": it is never treated as "the prospect got it" and never as
// "safe to send" - on the real key it blocks the real send until an admin
// reconciles it.
//   testDelivered   - confirmed delivery to the TEST inbox only
//   realDelivered   - confirmed delivery to the prospect (blocks a real send)
//   realUncertain   - a real send in flight or with an unknown outcome
//                     (status 'prepared'; blocks a real send)
//   testUncertain   - the same, for a test send (never blocks a real send)
//   failedOrBlocked - confirmed provider rejection or a gate-blocked request
//                     (status 'failed'/'cancelled'; never blocks)
//   ambiguous       - key/test_mode mismatch; realKeyAmbiguous counts the
//                     ones on the real key (those block a real send)
export function classifySendAttempts(attempts, suggestionId) {
  const realKey = sendIdempotencyKey(suggestionId, false)
  const testKey = sendIdempotencyKey(suggestionId, true)
  const result = { testDelivered: 0, realDelivered: 0, realUncertain: 0, testUncertain: 0, failedOrBlocked: 0, ambiguous: 0, realKeyAmbiguous: 0 }
  for (const a of attempts || []) {
    const onRealKey = a.idempotency_key === realKey
    if (!onRealKey && a.idempotency_key !== testKey) continue
    if (a.status === 'failed' || a.status === 'cancelled') {
      result.failedOrBlocked += 1
      continue
    }
    if (a.status !== 'sent' && a.status !== 'prepared') continue
    const flaggedTest = a.test_mode === true
    if (onRealKey === flaggedTest) {
      result.ambiguous += 1
      if (onRealKey) result.realKeyAmbiguous += 1
      continue
    }
    if (onRealKey) {
      if (a.status === 'sent') result.realDelivered += 1
      else result.realUncertain += 1
    } else if (a.status === 'sent') result.testDelivered += 1
    else result.testUncertain += 1
  }
  return result
}

export const AMBIGUOUS_PRIOR_DELIVERY_REASON =
  'سابقه ارسال قبلی این پیام مبهم است (نوع کلید ثبت‌شده با علامت آزمایشی/واقعی آن هم‌خوانی ندارد) و معلوم نیست به مشتری رسیده یا فقط به نشانی آزمایشی. تا بررسی دستی، ارسال مجاز نیست.'

// Admin-UI PRE-CHECK ONLY for the controlled first-email action (a
// testMode:false request). It runs the SAME evaluateSendGate() with every
// fact the browser can actually know (settings, lead, the lead's
// outreach_attempts) and assumes only the two server-only facts pass
// (credentials and the test-recipient secret), so any reason it returns is
// one the server would also block on. It can only HIDE the action, never
// allow a send: the Edge Function re-runs the full gate with real values
// and remains the source of truth.
//
// Judged against the REAL send: key only - a test delivery never counts as
// delivery to the prospect and never blocks this action. While
// provider_test_mode is on the action is unavailable outright (the server
// would route it to the test inbox), with that as the first reason.
// outreach_send_claims is server-only, so an unresolved real send is
// detected from its outreach_attempts row ('prepared').
export function previewFirstEmailSend({ suggestion, lead, settings, leadAttempts = [], now = new Date() }) {
  const effectiveTestMode = resolveEffectiveTestMode(settings, false)
  const history = classifySendAttempts(leadAttempts, suggestion?.id)
  // Most specific reasons come FIRST (the UI shows the first reason).
  const reasons = []
  if (effectiveTestMode) {
    reasons.push('حالت آزمایشی سیستم روشن است؛ ایمیل به مشتری ارسال نمی‌شود (فقط به نشانی آزمایشی). برای آزمایش از «ارسال آزمایشی» استفاده کنید.')
  }
  if (history.realDelivered > 0) reasons.push('این ایمیل قبلاً برای مشتری ارسال شده است و ارسال مجدد مجاز نیست.')
  if (history.realUncertain > 0) reasons.push('ارسال قبلی این ایمیل به مشتری هنوز نتیجه قطعی ندارد و باید دستی بررسی شود.')
  if (history.realKeyAmbiguous > 0) reasons.push(AMBIGUOUS_PRIOR_DELIVERY_REASON)
  const gate = evaluateSendGate({
    suggestion,
    lead,
    settings,
    leadAttempts,
    credentialsConfigured: true,
    duplicateIdempotencyExists: false,
    testMode: false,
    testRecipients: { email: effectiveTestMode ? 'checked-on-server' : null },
    now,
  })
  reasons.push(...gate.reasons)
  return { allowed: reasons.length === 0, reasons, testMode: effectiveTestMode, history }
}
