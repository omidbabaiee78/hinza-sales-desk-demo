// Phase 26 - Real Provider Integration Foundation regression checks.
// No new test framework - Node's built-in assert, run directly with
// `node scripts/checkOutreachSend.mjs`.

import assert from 'node:assert/strict'
import {
  evaluateSendGate,
  resolveRealRecipient,
  maskRecipient,
  classifySendAttempts,
  previewFirstEmailSend,
  AMBIGUOUS_PRIOR_DELIVERY_REASON,
  buildEmailBody,
  emailSubjectFor,
  EMAIL_OPT_OUT_FOOTER,
} from '../src/outreach/sendGate.js'
import { attemptSend, classifyOutcome } from '../src/outreach/sendPipeline.js'
import { sendWhatsApp } from '../src/outreach/providers/whatsappProvider.js'
import { sendEmail } from '../src/outreach/providers/emailProvider.js'
import { runShadowOutreachCycle } from '../src/outreach/shadowPipeline.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseLead(overrides = {}) {
  return {
    id: 'lead-1',
    company_name: 'شرکت نمونه',
    contact_name: 'آقای رضایی',
    mobile: '09121234567',
    phone: null,
    email: 'contact@example.com',
    status: 'new',
    do_not_contact: false,
    ...overrides,
  }
}

function baseSuggestion(overrides = {}) {
  return {
    id: 'sugg-1',
    lead_id: 'lead-1',
    channel: 'whatsapp',
    status: 'approved',
    message_draft: 'سلام وقت بخیر، پیام آزمایشی.',
    message_final: null,
    approved_by: 'admin-1',
    approved_at: '2026-09-22T05:00:00Z',
    ...overrides,
  }
}

const baseSettings = {
  outreach_enabled: true,
  whatsapp_provider_enabled: true,
  email_provider_enabled: true,
  provider_test_mode: true,
  outreach_cooldown_hours: 20,
  max_contact_attempts: 6,
  contact_window_start: '09:00:00',
  contact_window_end: '19:00:00',
}

const noon = new Date('2026-09-22T09:00:00+03:30') // within the default contact window
const testRecipients = { whatsapp: '+989120000000', email: 'test@hinzapolymer.com' }

// ---------------------------------------------------------------------------
// evaluateSendGate - pure unit tests
// ---------------------------------------------------------------------------

await check('outreach_enabled=false blocks send', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: { ...baseSettings, outreach_enabled: false },
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('outreach_enabled')))
})

await check('an unapproved (pending) suggestion blocks send', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ status: 'pending' }),
    lead: baseLead(),
    settings: baseSettings,
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('تأیید نشده')))
})

await check('a do_not_contact lead blocks send', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead({ do_not_contact: true }),
    settings: baseSettings,
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('عدم تماس')))
})

await check('a lead with no usable recipient for the channel blocks send', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ channel: 'whatsapp' }),
    lead: baseLead({ mobile: null }),
    settings: baseSettings,
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('اطلاعات تماس')))
})

await check('missing provider credentials blocks send', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: baseSettings,
    credentialsConfigured: false,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('credentials') || r.includes('اعتبارسنجی')))
})

await check('test mode with no configured test recipient blocks send (never silently falls back to the real one)', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: baseSettings,
    credentialsConfigured: true,
    testRecipients: {},
    testMode: true,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('آزمایشی')))
})

await check('test mode NEVER uses the real customer recipient, even when everything else passes', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: baseSettings,
    credentialsConfigured: true,
    testRecipients,
    testMode: true,
    now: noon,
  })
  assert.equal(gate.allowed, true)
  assert.equal(gate.recipient, testRecipients.whatsapp)
  assert.notEqual(gate.recipient, gate.realRecipient)
})

await check('production mode (testMode=false) uses the real customer recipient when provider_test_mode is persisted false', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: { ...baseSettings, provider_test_mode: false },
    credentialsConfigured: true,
    testRecipients,
    testMode: false,
    now: noon,
  })
  assert.equal(gate.allowed, true)
  assert.equal(gate.recipient, gate.realRecipient)
})

await check('a request testMode=false can NEVER override a persisted provider_test_mode=true - stays in test mode, real recipient never used', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: { ...baseSettings, provider_test_mode: true },
    credentialsConfigured: true,
    testRecipients,
    testMode: false,
    now: noon,
  })
  assert.equal(gate.testMode, true, 'persisted provider_test_mode=true must win over a request testMode=false')
  assert.equal(gate.allowed, true)
  assert.equal(gate.recipient, testRecipients.whatsapp)
  assert.notEqual(gate.recipient, gate.realRecipient)
})

await check('outreach_enabled=false still blocks a production (non-test) send even when the request omits testMode', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: { ...baseSettings, outreach_enabled: false, provider_test_mode: false },
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('outreach_enabled')))
})

await check('the explicit admin email test-send path: outreach_enabled=false is bypassed ONLY for an explicit testMode=true email send', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ channel: 'email', message_final: 'متن نهایی' }),
    lead: baseLead(),
    settings: { ...baseSettings, outreach_enabled: false },
    credentialsConfigured: true,
    testRecipients,
    testMode: true,
    now: noon,
  })
  assert.equal(gate.allowed, true, gate.reasons.join('; '))
  assert.equal(gate.testMode, true)
  assert.equal(gate.recipient, testRecipients.email)
})

await check('the explicit admin test-send bypass never applies to whatsapp - outreach_enabled=false still blocks it even with testMode=true', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ channel: 'whatsapp' }),
    lead: baseLead(),
    settings: { ...baseSettings, outreach_enabled: false },
    credentialsConfigured: true,
    testRecipients,
    testMode: true,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('outreach_enabled')))
})

await check('the explicit admin test-send bypass never applies without an EXPLICIT testMode=true - merely being channel=email is not enough', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ channel: 'email', message_final: 'متن نهایی' }),
    lead: baseLead(),
    settings: { ...baseSettings, outreach_enabled: false, provider_test_mode: false },
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('outreach_enabled')))
})

await check('the explicit admin email test-send still requires email_provider_enabled=true', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ channel: 'email', message_final: 'متن نهایی' }),
    lead: baseLead(),
    settings: { ...baseSettings, outreach_enabled: false, email_provider_enabled: false },
    credentialsConfigured: true,
    testRecipients,
    testMode: true,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('فعال نشده')))
})

await check('the explicit admin email test-send still requires a configured server-side EMAIL_TEST_RECIPIENT, with no fallback to the lead email', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ channel: 'email', message_final: 'متن نهایی' }),
    lead: baseLead({ email: 'reallead@example.com' }),
    settings: { ...baseSettings, outreach_enabled: false },
    credentialsConfigured: true,
    testRecipients: { whatsapp: testRecipients.whatsapp }, // no email test recipient configured
    testMode: true,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('آزمایشی')))
  assert.notEqual(gate.recipient, 'reallead@example.com', 'must never silently fall back to the real lead email')
})

await check('a duplicate idempotency key (already sent) blocks a second send', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: baseSettings,
    credentialsConfigured: true,
    testRecipients,
    duplicateIdempotencyExists: true,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('idempotency')))
})

await check('cooldown blocks a repeat send', () => {
  const attempts = [{ status: 'sent', created_at: new Date(noon.getTime() - 60 * 60 * 1000).toISOString() }]
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: baseSettings,
    leadAttempts: attempts,
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('فاصله زمانی مجاز')))
})

await check('a TEST-mode sent attempt never counts toward the real customer\'s cooldown - it never actually reached them', () => {
  const attempts = [{ status: 'sent', test_mode: true, created_at: new Date(noon.getTime() - 60 * 60 * 1000).toISOString() }]
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: baseSettings,
    leadAttempts: attempts,
    credentialsConfigured: true,
    testRecipients,
    testMode: false,
    now: noon,
  })
  assert.equal(gate.allowed, true, 'a prior TEST send must not block a genuine production send via cooldown')
})

await check('max attempts cap blocks further sends', () => {
  const attempts = Array.from({ length: 6 }, (_, i) => ({ status: 'sent', created_at: `2020-01-0${(i % 9) + 1}T00:00:00Z` }))
  const gate = evaluateSendGate({
    suggestion: baseSuggestion(),
    lead: baseLead(),
    settings: baseSettings,
    leadAttempts: attempts,
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('حداکثر تعداد تلاش')))
})

await check('a disabled per-channel provider toggle blocks send even when outreach_enabled=true', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ channel: 'email' }),
    lead: baseLead(),
    settings: { ...baseSettings, email_provider_enabled: false },
    credentialsConfigured: true,
    testRecipients,
    now: noon,
  })
  assert.equal(gate.allowed, false)
  assert.ok(gate.reasons.some((r) => r.includes('فعال نشده')))
})

await check('a fully valid, all-gates-pass case is allowed', () => {
  const gate = evaluateSendGate({
    suggestion: baseSuggestion({ status: 'edited', message_final: 'متن نهایی' }),
    lead: baseLead(),
    settings: baseSettings,
    credentialsConfigured: true,
    testRecipients,
    testMode: true,
    now: noon,
  })
  assert.equal(gate.allowed, true)
  assert.deepEqual(gate.reasons, [])
})

await check('maskRecipient never reveals the full phone/email', () => {
  assert.equal(maskRecipient('+989121234567', 'whatsapp'), '********4567')
  const maskedEmail = maskRecipient('contact@example.com', 'email')
  assert.ok(maskedEmail.startsWith('c'))
  assert.ok(maskedEmail.endsWith('@example.com'))
  assert.doesNotMatch(maskedEmail, /contact@example\.com/)
})

await check('resolveRealRecipient normalizes an Iranian mobile to E.164 for whatsapp', () => {
  assert.equal(resolveRealRecipient(baseLead({ mobile: '09121234567' }), 'whatsapp'), '+989121234567')
})

// ---------------------------------------------------------------------------
// Provider adapters - normalized result shape, timeout, mocked fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch
function mockFetch(responder) {
  globalThis.fetch = responder
}
function restoreFetch() {
  globalThis.fetch = originalFetch
}
function jsonFetchResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

await check('sendWhatsApp returns credentials_missing without ever calling fetch when unconfigured', async () => {
  let called = false
  mockFetch(async () => {
    called = true
    return jsonFetchResponse({})
  })
  try {
    const result = await sendWhatsApp({ accessToken: null, phoneNumberId: null, recipient: '+989120000000', message: 'x' })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'credentials_missing')
    assert.equal(called, false)
  } finally {
    restoreFetch()
  }
})

await check('sendWhatsApp normalizes a successful provider response', async () => {
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.ABC123' }] }))
  try {
    const result = await sendWhatsApp({ accessToken: 'tok', phoneNumberId: '123', recipient: '+989120000000', message: 'x' })
    assert.equal(result.ok, true)
    assert.equal(result.provider, 'whatsapp_cloud_api')
    assert.equal(result.providerMessageId, 'wamid.ABC123')
    assert.equal(result.status, 'sent')
  } finally {
    restoreFetch()
  }
})

await check('sendWhatsApp normalizes a provider error response, never throwing', async () => {
  mockFetch(async () => jsonFetchResponse({ error: { code: 131026, message: 'Message undeliverable' } }, { ok: false, status: 400 }))
  try {
    const result = await sendWhatsApp({ accessToken: 'tok', phoneNumberId: '123', recipient: '+989120000000', message: 'x' })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, '131026')
    assert.equal(result.errorMessage, 'Message undeliverable')
  } finally {
    restoreFetch()
  }
})

await check('sendWhatsApp normalizes a timeout as errorCode="timeout", never an unhandled rejection', async () => {
  mockFetch((url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  try {
    const result = await sendWhatsApp({ accessToken: 'tok', phoneNumberId: '123', recipient: '+989120000000', message: 'x', timeoutMs: 20 })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'timeout')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail returns credentials_missing without ever calling fetch when unconfigured', async () => {
  let called = false
  mockFetch(async () => {
    called = true
    return jsonFetchResponse({})
  })
  try {
    const result = await sendEmail({ apiKey: null, fromAddress: null, recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'credentials_missing')
    assert.equal(called, false)
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a 2xx with a valid message id is outcome=accepted', async () => {
  mockFetch(async () => jsonFetchResponse({ id: 'resend-msg-1' }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, true)
    assert.equal(result.outcome, 'accepted')
    assert.equal(result.provider, 'resend')
    assert.equal(result.providerMessageId, 'resend-msg-1')
    assert.equal(result.status, 'sent')
    assert.deepEqual(Object.keys(result).sort(), ['errorCode', 'errorMessage', 'ok', 'outcome', 'provider', 'providerMessageId', 'status'].sort())
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a documented, allowlisted rejection error (422 missing_required_field) is outcome=rejected', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'missing_required_field', message: 'Missing `to` field' }, { ok: false, status: 422 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'rejected')
    assert.equal(result.errorCode, 'missing_required_field')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: 400 + validation_error is outcome=rejected (the exact documented pair)', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'validation_error', message: 'Invalid `to` field' }, { ok: false, status: 400 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'rejected')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: 500 + validation_error is outcome=unknown - the status forces unknown regardless of a "recognized" name', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'validation_error', message: 'Invalid `from` field' }, { ok: false, status: 500 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown', 'a name we vetted at 400/403 must NOT be trusted at an unvetted 5xx status')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: 409 + validation_error is outcome=unknown - 409 always forces unknown regardless of body.name', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'validation_error', message: 'Invalid `from` field' }, { ok: false, status: 409 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a recognized error name at an UNDOCUMENTED status is outcome=unknown (e.g. not_found reported at 400, never documented there)', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'not_found', message: 'The requested endpoint does not exist' }, { ok: false, status: 400 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown', 'the (status, name) PAIR must be documented, not the name alone')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a 500 application_error is outcome=unknown, NOT a confirmed rejection', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'application_error', message: 'An unexpected error occurred' }, { ok: false, status: 500 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown', 'a 5xx must never be assumed to be a definite rejection')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a 409 (concurrent_idempotent_requests) is outcome=unknown - another request with the same key may still complete', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'concurrent_idempotent_requests', message: 'There is another request in progress' }, { ok: false, status: 409 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: an unrecognized/undocumented error name defaults to outcome=unknown, never rejected', async () => {
  mockFetch(async () => jsonFetchResponse({ name: 'some_future_error_type_we_have_never_seen', message: 'new error' }, { ok: false, status: 400 }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown', 'only an EXPLICITLY allowlisted, documented error may ever count as rejected')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a non-2xx response with an unparseable (malformed) body is outcome=unknown', async () => {
  mockFetch(async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json') } }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.errorCode, 'malformed_response')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a 2xx response with an unparseable (malformed) body is outcome=unknown, never accepted', async () => {
  mockFetch(async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json') } }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown', 'a 2xx alone is never enough - it must never be reported as accepted without a readable body')
    assert.equal(result.errorCode, 'malformed_response')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a 2xx response with no message id (or an empty/non-string one) is outcome=unknown, never accepted', async () => {
  mockFetch(async () => jsonFetchResponse({}))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.errorCode, 'missing_message_id')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a 2xx response with an empty-string message id is outcome=unknown, never accepted', async () => {
  mockFetch(async () => jsonFetchResponse({ id: '   ' }))
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown')
  } finally {
    restoreFetch()
  }
})

await check('sendEmail: a timeout is outcome=unknown, never a confirmed rejection', async () => {
  mockFetch(async () => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  })
  try {
    const result = await sendEmail({ apiKey: 'key', fromAddress: 'sales@hinzapolymer.com', recipient: 'x@example.com', subject: 's', message: 'm' })
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.errorCode, 'timeout')
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// Fake Supabase client (extends the same in-memory harness style as
// scripts/checkOutreachShadow.mjs) for full attemptSend() pipeline tests.
// ---------------------------------------------------------------------------

function makeFakeClient() {
  const tables = {
    sales_leads: [baseLead()],
    prospect_outreach_suggestions: [],
    outreach_attempts: [],
    outreach_send_claims: [],
    lead_activities: [],
    automation_settings: [{ id: 1, ...baseSettings }],
  }
  let nextId = 1
  const newId = (table) => `${table}-${nextId++}`

  // Injectable one-shot write failure, for the "DB write fails right after
  // the provider already accepted the send" regression tests - consumed
  // (cleared) the first time a matching write is attempted, same as a real
  // transient DB error would only hit once.
  const pendingFailures = new Set()
  function shouldFail(table, op) {
    const key = `${table}:${op}`
    if (pendingFailures.has(key)) {
      pendingFailures.delete(key)
      return true
    }
    return false
  }

  function matches(row, filters) {
    return filters.every(([type, field, value]) => {
      if (type === 'eq') return row[field] === value
      if (type === 'in') return value.includes(row[field])
      if (type === 'contains') return Array.isArray(row[field]) && value.every((v) => row[field].includes(v))
      return true
    })
  }

  function selectChain(table, selectStr) {
    const filters = []
    const chain = {
      eq: (f, v) => (filters.push(['eq', f, v]), chain),
      in: (f, v) => (filters.push(['in', f, v]), chain),
      contains: (f, v) => (filters.push(['contains', f, v]), chain),
      single: async () => {
        const rows = tables[table].filter((r) => matches(r, filters)).map((r) => ({ ...r }))
        if (rows.length === 0) return { data: null, error: { message: 'not found' } }
        const row = rows[0]
        if (selectStr?.includes('sales_leads')) {
          row.sales_leads = tables.sales_leads.find((l) => l.id === row.lead_id) || null
        }
        return { data: row, error: null }
      },
      maybeSingle: async () => {
        const rows = tables[table].filter((r) => matches(r, filters))
        return { data: rows[0] ? { ...rows[0] } : null, error: null }
      },
      then: (resolve) => resolve({ data: tables[table].filter((r) => matches(r, filters)).map((r) => ({ ...r })), error: null }),
    }
    return chain
  }

  function insertChain(table, payload) {
    if (shouldFail(table, 'insert')) {
      const errorResult = { data: null, error: { message: `simulated insert failure on ${table}` } }
      return { select: () => ({ single: async () => errorResult }), then: (resolve) => resolve(errorResult) }
    }
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
      id: newId(table),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...row,
    }))
    tables[table].push(...rows)
    return {
      select: () => ({ single: async () => ({ data: rows[0], error: null }), then: (resolve) => resolve({ data: rows, error: null }) }),
      then: (resolve) => resolve({ data: rows, error: null }),
    }
  }

  // Supports chained .eq().eq()... (needed for the claim table's conditional
  // reclaim, e.g. .eq('idempotency_key', k).eq('status', 'failed')) and
  // defers the actual mutation until a terminal call (.then()/.select()) so
  // ALL filters are collected first - same semantics as a real WHERE clause
  // built up across multiple .eq() calls.
  function updateChain(table, patch) {
    const filters = []
    const willFail = shouldFail(table, 'update')
    let applied = null
    function apply() {
      if (applied) return applied
      const rows = willFail ? [] : (tables[table] || []).filter((r) => matches(r, filters))
      rows.forEach((r) => Object.assign(r, patch))
      applied = rows
      return rows
    }
    const chain = {
      eq: (field, value) => (filters.push(['eq', field, value]), chain),
      select: () => ({
        single: async () => (willFail ? { data: null, error: { message: `simulated update failure on ${table}` } } : { data: apply()[0] || null, error: null }),
        then: (resolve) => resolve(willFail ? { data: null, error: { message: `simulated update failure on ${table}` } } : { data: apply(), error: null }),
      }),
      then: (resolve) => resolve(willFail ? { data: null, error: { message: `simulated update failure on ${table}` } } : { data: apply(), error: null }),
    }
    return chain
  }

  // Mirrors PostgREST's `insert ... on conflict (onConflict) do nothing`
  // (ignoreDuplicates: true) semantics: a conflicting row is left untouched
  // and is NOT included in the returned/selected data - that is how
  // claimSend() in sendPipeline.js detects "someone else already holds this
  // key" without an error being thrown.
  function upsertChain(table, payload, options = {}) {
    const rows = Array.isArray(payload) ? payload : [payload]
    const conflictCol = options.onConflict
    const written = []
    for (const row of rows) {
      const existing = conflictCol ? (tables[table] || []).find((r) => r[conflictCol] === row[conflictCol]) : null
      if (existing) {
        if (options.ignoreDuplicates) continue
        Object.assign(existing, row)
        written.push(existing)
        continue
      }
      const newRow = { created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row }
      tables[table].push(newRow)
      written.push(newRow)
    }
    return {
      select: () => ({ then: (resolve) => resolve({ data: written, error: null }), single: async () => ({ data: written[0] || null, error: null }) }),
      then: (resolve) => resolve({ data: written, error: null }),
    }
  }

  return {
    from(table) {
      return {
        select: (selectStr) => selectChain(table, selectStr),
        insert: (payload) => insertChain(table, payload),
        update: (patch) => updateChain(table, patch),
        upsert: (payload, options) => upsertChain(table, payload, options),
      }
    },
    failNextWrite: (table, op) => pendingFailures.add(`${table}:${op}`),
    tables,
  }
}

const validCredentials = {
  whatsapp: { accessToken: 'tok', phoneNumberId: '123' },
  email: { apiKey: 'key', fromAddress: 'sales@hinzapolymer.com' },
}

await check('attemptSend: end-to-end, an allowed test-mode send goes through the mocked provider and records a full audit trail', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.TEST1' }] }))
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, true)
    assert.equal(result.testMode, true)
    assert.equal(result.providerMessageId, 'wamid.TEST1')
    const attempt = client.tables.outreach_attempts[0]
    assert.equal(attempt.status, 'sent')
    assert.equal(attempt.test_mode, true)
    assert.equal(attempt.idempotency_key, 'test-send:sugg-1', 'a test send must use its OWN idempotency-key namespace, never the production one')
    assert.ok(attempt.recipient_masked)
    assert.notEqual(attempt.recipient_masked, testRecipients.whatsapp, 'the masked field must never be the raw recipient')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a successful TEST send must NEVER consume the production suggestion - status/send_status stay untouched', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.TEST1b' }] }))
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, true)
    const suggestion = client.tables.prospect_outreach_suggestions[0]
    assert.equal(suggestion.status, 'approved', 'a test send must never mark the suggestion acted - it is not a production action')
    assert.notEqual(suggestion.send_status, 'sent', 'a test send must never mark the production send_status as sent')
    assert.equal(suggestion.acted_by, undefined)
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a production send AFTER a prior successful TEST send for the same suggestion is NOT blocked - test and production idempotency are isolated', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.ISO1' }] }))
  try {
    const testResult = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(testResult.ok, true)
    const prodResult = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(prodResult.ok, true, 'a prior TEST send must never block the real production send: ' + JSON.stringify(prodResult))
    const suggestion = client.tables.prospect_outreach_suggestions[0]
    assert.equal(suggestion.status, 'acted')
    assert.equal(suggestion.send_status, 'sent')
    assert.equal(client.tables.lead_activities.length, 1, 'only the PRODUCTION send stamps contact history')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a SECOND test send for the same suggestion, after the first succeeded, is blocked (duplicate test sends are prevented too)', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.DUPTEST' }] }))
  try {
    const first = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(first.ok, true)
    const second = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(second.ok, false)
    assert.equal(client.tables.outreach_attempts.filter((a) => a.test_mode && a.status === 'sent').length, 1, 'only ONE successful test send ever recorded')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a test-mode send never logs lead_activities or stamps last_contact_at (it never touched the real customer)', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.TEST2' }] }))
  try {
    await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(client.tables.lead_activities.length, 0)
    assert.equal(client.tables.sales_leads[0].last_contact_at, undefined)
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a production-mode (testMode=false) successful send DOES log lead_activities and stamp last_contact_at', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.PROD1' }] }))
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, true)
    assert.equal(client.tables.lead_activities.length, 1)
    assert.equal(client.tables.lead_activities[0].activity_type, 'whatsapp')
    assert.ok(client.tables.sales_leads[0].last_contact_at)
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: outreach_enabled=false blocks the send and still records a cancelled audit row, without calling the provider', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].outreach_enabled = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  let called = false
  mockFetch(async () => {
    called = true
    return jsonFetchResponse({})
  })
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, false)
    assert.ok(result.reasons.some((r) => r.includes('outreach_enabled')))
    assert.equal(called, false, 'the provider must never be called when the gate blocks')
    assert.equal(client.tables.outreach_attempts.length, 1)
    assert.equal(client.tables.outreach_attempts[0].status, 'cancelled')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: the explicit admin email test-send goes through even with outreach_enabled=false, and is recorded as a real test-mode attempt', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].outreach_enabled = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ channel: 'email', message_final: 'متن نهایی' }))
  mockFetch(async () => jsonFetchResponse({ id: 'resend-test-1' }))
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.testMode, true)
    const attempt = client.tables.outreach_attempts[0]
    assert.equal(attempt.status, 'sent')
    assert.equal(attempt.test_mode, true)
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: the same outreach_enabled=false state still blocks a whatsapp send even with testMode=true (bypass never extends past email)', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].outreach_enabled = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ channel: 'whatsapp' }))
  let called = false
  mockFetch(async () => {
    called = true
    return jsonFetchResponse({})
  })
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, false)
    assert.ok(result.reasons.some((r) => r.includes('outreach_enabled')))
    assert.equal(called, false)
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a second call for the same suggestion after a successful send is blocked by idempotency, never double-sends', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.ONCE' }] }))
  try {
    const first = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(first.ok, true)
    const second = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(second.ok, false)
    assert.ok(second.reasons.some((r) => r.includes('idempotency')))
    assert.equal(client.tables.outreach_attempts.filter((a) => a.status === 'sent').length, 1, 'only ONE successful send ever recorded')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a production provider failure is recorded as status=failed with the normalized error, and send_status becomes failed', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  mockFetch(async () => jsonFetchResponse({ error: { code: 500, message: 'Internal error' } }, { ok: false, status: 500 }))
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, '500')
    const attempt = client.tables.outreach_attempts[0]
    assert.equal(attempt.status, 'failed')
    const suggestion = client.tables.prospect_outreach_suggestions[0]
    assert.equal(suggestion.send_status, 'failed')
    assert.notEqual(suggestion.status, 'acted', 'a failed send must never be marked acted')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a retry AFTER a definite (known) provider failure is allowed and can succeed - the claim is reclaimable from "failed"', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  let call = 0
  mockFetch(async () => {
    call += 1
    return call === 1 ? jsonFetchResponse({ error: { code: 500, message: 'Internal error' } }, { ok: false, status: 500 }) : jsonFetchResponse({ messages: [{ id: 'wamid.RETRY_OK' }] })
  })
  try {
    const first = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(first.ok, false)
    const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
    assert.equal(claim.status, 'failed', 'a definite provider failure must resolve the claim to failed, allowing a retry')
    const second = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(second.ok, true, 'a retry after a definite failure must be allowed: ' + JSON.stringify(second))
    assert.equal(call, 2, 'the provider must be called exactly once per attempt')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: missing credentials blocks send with credentials_missing-style reason, provider never called', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion())
  let called = false
  mockFetch(async () => {
    called = true
    return jsonFetchResponse({})
  })
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: {}, testRecipients, now: noon })
    assert.equal(result.ok, false)
    assert.ok(result.reasons.some((r) => r.includes('اعتبارسنجی') || r.includes('credentials')))
    assert.equal(called, false)
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: a missing test recipient blocks BEFORE ever reaching the claim step (no stray claim row is left behind)', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ channel: 'email', message_final: 'متن نهایی' }))
  let called = false
  mockFetch(async () => {
    called = true
    return jsonFetchResponse({})
  })
  try {
    const result = await attemptSend(client, {
      suggestionId: 'sugg-1',
      actorUserId: 'admin-1',
      testMode: true,
      credentials: validCredentials,
      testRecipients: { whatsapp: testRecipients.whatsapp }, // no email test recipient configured
      now: noon,
    })
    assert.equal(result.ok, false)
    assert.ok(result.reasons.some((r) => r.includes('آزمایشی')))
    assert.equal(called, false, 'the provider must never be called when the test recipient is missing')
    assert.equal(client.tables.outreach_send_claims.length, 0, 'the gate must block before any claim is ever taken')
    assert.equal(client.tables.outreach_attempts[0].status, 'cancelled')
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// Concurrency safety - two requests racing for the SAME suggestion must
// never both reach the provider. This exercises the real interleaving
// hazard (not just a sequential re-check): both attemptSend() calls are
// started together via Promise.all and progress through their own await
// chains concurrently, exactly like two simultaneous admin clicks / a
// double-submitted request would in the real Edge Function.
// ---------------------------------------------------------------------------

await check('attemptSend: two concurrent calls for the same suggestion never both reach the provider - only one send ever goes through', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  let providerCalls = 0
  mockFetch(async () => {
    providerCalls += 1
    // A real network round-trip has a delay - yielding here (rather than
    // resolving synchronously) makes the race deterministic-but-real: both
    // callers reach the provider step before either one's response lands,
    // which is exactly the scenario the atomic claim must prevent EARLIER,
    // before either fetch() call is even made.
    await new Promise((resolve) => setTimeout(resolve, 5))
    return jsonFetchResponse({ messages: [{ id: 'wamid.RACE' }] })
  })
  try {
    const call = () => attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    const [a, b] = await Promise.all([call(), call()])
    const results = [a, b]
    const succeeded = results.filter((r) => r.ok)
    const blocked = results.filter((r) => !r.ok)
    assert.equal(succeeded.length, 1, `exactly one concurrent call must succeed, got: ${JSON.stringify(results)}`)
    assert.equal(blocked.length, 1)
    assert.equal(providerCalls, 1, 'the provider must be called exactly once, never twice, under a race')
    assert.equal(client.tables.outreach_attempts.filter((a2) => a2.status === 'sent').length, 1)
    assert.equal(client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1').status, 'sent')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: two concurrent RETRIES racing to reclaim the SAME failed claim - only one wins and calls the provider, never both', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  let providerCalls = 0
  mockFetch(async () => {
    providerCalls += 1
    return jsonFetchResponse({ error: { code: 500, message: 'still failing' } }, { ok: false, status: 500 })
  })
  // Seed a genuine prior FAILURE first (sequential), so the claim row exists
  // in the one state that is ever reclaimable at all.
  const seed = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
  assert.equal(seed.ok, false)
  assert.equal(client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1').status, 'failed')
  restoreFetch()

  providerCalls = 0
  mockFetch(async () => {
    providerCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return jsonFetchResponse({ messages: [{ id: 'wamid.RETRY_RACE' }] })
  })
  try {
    // Now TWO concurrent retries race for the SAME idempotency key, both
    // trying to reclaim the exact same 'failed' -> 'claimed' transition
    // (claimSend()'s Step 2) at the same time.
    const call = () => attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    const [a, b] = await Promise.all([call(), call()])
    const succeeded = [a, b].filter((r) => r.ok)
    assert.equal(succeeded.length, 1, `exactly one of the two racing retries must succeed, got: ${JSON.stringify([a, b])}`)
    assert.equal(providerCalls, 1, 'the provider must be called exactly once across both racing retries')
    assert.equal(client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1').status, 'sent')
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// DB write failures AFTER the provider already accepted the send - must
// never be reported as a plain success, and must never leave the door open
// for a second real send.
// ---------------------------------------------------------------------------

await check('attemptSend: a DB write failure right after a successful provider send is reported as a failure, never a silent/plain success', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  mockFetch(async () => jsonFetchResponse({ messages: [{ id: 'wamid.DBFAIL' }] }))
  client.failNextWrite('outreach_attempts', 'update')
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(result.ok, false, 'a provider success followed by a DB write failure must never be reported as ok:true')
    assert.equal(result.errorCode, 'record_write_failed')
  } finally {
    restoreFetch()
  }
})

await check('attemptSend: after a provider-succeeded-but-DB-write-failed attempt, a second call is still blocked (the claim was never released)', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  let providerCalls = 0
  mockFetch(async () => {
    providerCalls += 1
    return jsonFetchResponse({ messages: [{ id: 'wamid.DBFAIL2' }] })
  })
  client.failNextWrite('outreach_attempts', 'update')
  try {
    const first = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(first.ok, false)
    const second = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(second.ok, false, 'a second send must stay blocked - we do not KNOW the first one failed, only that its bookkeeping did')
    assert.equal(providerCalls, 1, 'the provider must never be called a second time while the first outcome is unresolved')
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// Unknown outcomes (timeout/network) - must never be auto-retried, and the
// claim must never be auto-released, since we genuinely do not know whether
// the provider processed the request.
// ---------------------------------------------------------------------------

await check('attemptSend: a provider timeout is an UNKNOWN outcome - never marked sent/failed, the claim stays claimed, and a retry is blocked', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ status: 'approved' }))
  let providerCalls = 0
  mockFetch(async () => {
    // Rejects immediately with the same shape the real AbortController
    // produces once its internal timer fires - exercises sendWhatsApp's
    // timeout-handling branch without actually waiting out its (default
    // 15s) internal timeout in this test.
    providerCalls += 1
    throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  })
  try {
    const first = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(first.ok, false)
    assert.equal(first.errorCode, 'timeout')
    const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
    assert.equal(attempt.status, 'prepared', 'an unknown outcome must never be recorded as sent OR failed')
    const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
    assert.equal(claim.status, 'claimed', 'an unknown outcome must never release or resolve the claim')
    const suggestion = client.tables.prospect_outreach_suggestions[0]
    assert.notEqual(suggestion.send_status, 'sent')
    assert.notEqual(suggestion.send_status, 'failed')

    const second = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(second.ok, false, 'a retry after an unknown outcome must be blocked, not silently retried')
    assert.equal(providerCalls, 1, 'the provider must never be called again while the first outcome is unknown')
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// classifyOutcome() - focused, no-fetch-at-all unit tests of the fail-closed
// contract itself. A real emailProvider.js call can never actually produce
// a missing/invalid `outcome` any more (it always sets one correctly), so
// this is the only way to directly exercise "what if it didn't" - a bug in
// the provider, a future code path that forgot to set it, a typo - without
// reaching into module internals or making any network/provider call.
// ---------------------------------------------------------------------------

await check('classifyOutcome: EMAIL with a missing outcome field is unknown - NEVER inferred from result.ok', () => {
  assert.equal(classifyOutcome({ ok: true, providerMessageId: 'looks-fine' }, 'email'), 'unknown')
})

await check('classifyOutcome: EMAIL with outcome=null is unknown, even when ok=true', () => {
  assert.equal(classifyOutcome({ ok: true, outcome: null }, 'email'), 'unknown')
})

await check('classifyOutcome: EMAIL with an invalid/garbled outcome string is unknown, not trusted verbatim', () => {
  assert.equal(classifyOutcome({ ok: true, outcome: 'succeeded' }, 'email'), 'unknown')
  assert.equal(classifyOutcome({ ok: false, outcome: 'ACCEPTED' }, 'email'), 'unknown', 'must be an exact match, not case-insensitive or fuzzy')
})

await check('classifyOutcome: EMAIL trusts an explicit, valid outcome even when it disagrees with result.ok (outcome is authoritative, ok is not consulted)', () => {
  assert.equal(classifyOutcome({ ok: false, outcome: 'accepted' }, 'email'), 'accepted')
  assert.equal(classifyOutcome({ ok: true, outcome: 'rejected' }, 'email'), 'rejected')
})

await check('classifyOutcome: only accepted/rejected/unknown are ever returned for EMAIL - every other shape fails closed to unknown', () => {
  for (const outcome of ['accepted', 'rejected', 'unknown']) {
    assert.equal(classifyOutcome({ outcome }, 'email'), outcome)
  }
  for (const bad of [undefined, null, '', 'ok', 0, false, {}]) {
    assert.equal(classifyOutcome({ ok: true, outcome: bad }, 'email'), 'unknown', `outcome=${JSON.stringify(bad)} must fail closed`)
  }
})

await check('classifyOutcome: WhatsApp (no outcome contract) keeps its EXACT pre-existing ok/timeout-based classification, unaffected by the email fail-closed rule', () => {
  assert.equal(classifyOutcome({ ok: true }, 'whatsapp'), 'accepted')
  assert.equal(classifyOutcome({ ok: false, errorCode: '131026' }, 'whatsapp'), 'rejected')
  assert.equal(classifyOutcome({ ok: false, errorCode: 'timeout' }, 'whatsapp'), 'unknown')
  assert.equal(classifyOutcome({ ok: false, errorCode: 'network_error' }, 'whatsapp'), 'unknown')
})

// ---------------------------------------------------------------------------
// Email outcome-classification, end-to-end through attemptSend(). Each
// helper seeds a fresh EMAIL-channel suggestion and mocks fetch with the
// given response shape - covers every case sendGate/sendPipeline must
// classify correctly, matching emailProvider.js's own unit tests but
// verified through the FULL pipeline (claim/attempt/suggestion state, and -
// for every 'unknown' case - that a second invocation never calls the
// provider again).
// ---------------------------------------------------------------------------

async function emailPipelineCase(fetchImpl) {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = false
  await client.from('prospect_outreach_suggestions').insert(baseSuggestion({ channel: 'email', message_final: 'متن نهایی', status: 'approved' }))
  let providerCalls = 0
  mockFetch(async (...args) => {
    providerCalls += 1
    return fetchImpl(...args)
  })
  try {
    const result = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    return { client, result, callCount: () => providerCalls }
  } finally {
    restoreFetch()
  }
}

async function assertSecondCallBlockedWithoutProvider(client, providerCallsRef) {
  const callsBefore = providerCallsRef()
  mockFetch(async () => {
    throw new Error('the provider must never be called again for an unresolved unknown outcome')
  })
  try {
    const second = await attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
    assert.equal(second.ok, false, 'a second invocation after an unknown outcome must be blocked')
  } finally {
    restoreFetch()
  }
  assert.equal(callsBefore, 1, 'the provider must have been called exactly once on the FIRST invocation')
}

await check('email pipeline: a valid success (2xx + message id) is accepted - sent, claim resolved, suggestion acted, contact history stamped', async () => {
  const { client, result } = await emailPipelineCase(async () => jsonFetchResponse({ id: 'resend-msg-ok' }))
  assert.equal(result.ok, true)
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'sent')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'sent')
  const suggestion = client.tables.prospect_outreach_suggestions[0]
  assert.equal(suggestion.status, 'acted')
  assert.equal(suggestion.send_status, 'sent')
  assert.equal(client.tables.lead_activities.length, 1)
  assert.ok(client.tables.sales_leads[0].last_contact_at)
})

await check('email pipeline: a documented rejection (422 missing_required_field) is a confirmed failure - claim failed, retryable', async () => {
  const { client, result } = await emailPipelineCase(async () => jsonFetchResponse({ name: 'missing_required_field', message: 'Missing `to` field' }, { ok: false, status: 422 }))
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'missing_required_field')
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'failed')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'failed', 'a confirmed, documented rejection must resolve the claim to failed so a retry is possible')
  const suggestion = client.tables.prospect_outreach_suggestions[0]
  assert.notEqual(suggestion.status, 'acted')
})

await check('email pipeline: a 500 is an UNKNOWN outcome, not a confirmed rejection - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, callCount } = await emailPipelineCase(async () => jsonFetchResponse({ name: 'application_error', message: 'An unexpected error occurred' }, { ok: false, status: 500 }))
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared', 'a 500 must never be recorded as a confirmed failure')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

await check('email pipeline: 500 + validation_error (a name only documented at 400/403) is still an UNKNOWN outcome - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, callCount } = await emailPipelineCase(async () => jsonFetchResponse({ name: 'validation_error', message: 'Invalid `from` field' }, { ok: false, status: 500 }))
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared', 'the status/name PAIR is not documented - the status alone must force unknown')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  const suggestion = client.tables.prospect_outreach_suggestions[0]
  assert.notEqual(suggestion.status, 'acted')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

await check('email pipeline: 409 + validation_error is still an UNKNOWN outcome - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, callCount } = await emailPipelineCase(async () => jsonFetchResponse({ name: 'validation_error', message: 'Invalid `from` field' }, { ok: false, status: 409 }))
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

await check('email pipeline: 400 + validation_error IS a confirmed rejection - claim resolves to failed, retryable', async () => {
  const { client, result } = await emailPipelineCase(async () => jsonFetchResponse({ name: 'validation_error', message: 'Invalid `to` field' }, { ok: false, status: 400 }))
  assert.equal(result.ok, false)
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'failed')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'failed', 'the exact documented (400, validation_error) pair is a confirmed rejection, safe to retry')
})

await check('email pipeline: a documented name at an UNDOCUMENTED status (not_found reported at 400) is an UNKNOWN outcome - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, callCount } = await emailPipelineCase(async () => jsonFetchResponse({ name: 'not_found', message: 'The requested endpoint does not exist' }, { ok: false, status: 400 }))
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

await check('email pipeline: a 409 (idempotency conflict) is an UNKNOWN outcome - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, callCount } = await emailPipelineCase(async () => jsonFetchResponse({ name: 'concurrent_idempotent_requests', message: 'There is another request in progress' }, { ok: false, status: 409 }))
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

await check('email pipeline: a malformed (unparseable) JSON response is an UNKNOWN outcome - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, callCount } = await emailPipelineCase(async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json') } }))
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared')
  assert.equal(attempt.error_code, 'malformed_response')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

await check('email pipeline: a 2xx with no valid message id is an UNKNOWN outcome (never accepted) - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, callCount } = await emailPipelineCase(async () => jsonFetchResponse({}))
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared', 'a 2xx alone must never be recorded as sent without a valid message id')
  assert.equal(attempt.error_code, 'missing_message_id')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  const suggestion = client.tables.prospect_outreach_suggestions[0]
  assert.notEqual(suggestion.status, 'acted')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

await check('email pipeline: a timeout is an UNKNOWN outcome via the explicit outcome field - claim stays claimed, second invocation never calls the provider', async () => {
  const { client, result, callCount } = await emailPipelineCase(async () => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'timeout')
  const attempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1')
  assert.equal(attempt.status, 'prepared')
  const claim = client.tables.outreach_send_claims.find((c) => c.idempotency_key === 'send:sugg-1')
  assert.equal(claim.status, 'claimed')
  await assertSecondCallBlockedWithoutProvider(client, callCount)
})

// ---------------------------------------------------------------------------
// The daily shadow cron must remain fully unaffected - it still only ever
// generates suggestions, never sends. (Full shadow-pipeline coverage lives
// in scripts/checkOutreachShadow.mjs - this is a targeted cross-check that
// nothing here changed that.)
// ---------------------------------------------------------------------------

await check('the shadow outreach cycle never calls a provider and never writes to outreach_attempts (Phase 26 changed nothing about Phase 25 behavior)', async () => {
  const client = makeFakeClient()
  client.tables.prospect_outreach_runs = []
  client.tables.prospect_candidates = []
  client.tables.prospect_evidence = []
  let fetchCalled = false
  mockFetch(async () => {
    fetchCalled = true
    return jsonFetchResponse({})
  })
  try {
    const lead2 = { ...baseLead(), id: 'lead-2', tags: ['prospecting'] }
    client.tables.sales_leads.push(lead2)
    const run = await runShadowOutreachCycle(client, { runType: 'manual' })
    assert.equal(run.status, 'completed')
    assert.equal(fetchCalled, false, 'shadow evaluation must never call an external provider')
    assert.equal(client.tables.outreach_attempts.length, 0, 'shadow evaluation must never write to outreach_attempts')
  } finally {
    restoreFetch()
  }
})

// ---------------------------------------------------------------------------
// Controlled first REAL email (admin outreach page) - test vs real delivery,
// duplicates, concurrency, and ambiguous older records. Email channel, with
// provider_test_mode persisted OFF unless a check says otherwise.
// ---------------------------------------------------------------------------

function firstEmailClient({ testModeOn = false } = {}) {
  const client = makeFakeClient()
  client.tables.automation_settings[0].provider_test_mode = testModeOn
  client.tables.prospect_outreach_suggestions.push(baseSuggestion({ channel: 'email', status: 'edited', message_final: 'متن نهایی ایمیل' }))
  return client
}

const realEmailSend = (client) =>
  attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: false, credentials: validCredentials, testRecipients, now: noon })
const testEmailSend = (client) =>
  attemptSend(client, { suggestionId: 'sugg-1', actorUserId: 'admin-1', testMode: true, credentials: validCredentials, testRecipients, now: noon })

function previewFor(client) {
  return previewFirstEmailSend({
    suggestion: client.tables.prospect_outreach_suggestions[0],
    lead: client.tables.sales_leads[0],
    settings: client.tables.automation_settings[0],
    leadAttempts: client.tables.outreach_attempts,
    now: noon,
  })
}

function recordingProvider(recipients) {
  return async (_url, init) => {
    recipients.push(JSON.parse(init.body).to[0])
    return jsonFetchResponse({ id: `resend-${recipients.length}` })
  }
}

await check('first email: test-then-real - a confirmed TEST delivery neither consumes the real key nor blocks the first real email, which reaches the prospect', async () => {
  const client = firstEmailClient()
  const recipients = []
  mockFetch(recordingProvider(recipients))
  try {
    assert.equal((await testEmailSend(client)).ok, true)
    const afterTest = previewFor(client)
    assert.equal(afterTest.allowed, true, 'the UI pre-check must still offer the real send: ' + JSON.stringify(afterTest.reasons))
    assert.equal(afterTest.history.testDelivered, 1)
    assert.equal(afterTest.history.realDelivered, 0, 'a test delivery must never be counted as delivery to the prospect')

    const real = await realEmailSend(client)
    assert.equal(real.ok, true, JSON.stringify(real))
    assert.equal(real.testMode, false)
    assert.deepEqual(recipients, [testRecipients.email, 'contact@example.com'], 'the test went to the test inbox, the real send to the prospect')
    const realAttempt = client.tables.outreach_attempts.find((a) => a.idempotency_key === 'send:sugg-1' && a.status === 'sent')
    assert.equal(realAttempt.test_mode, false)
    assert.equal(previewFor(client).history.realDelivered, 1)
  } finally {
    restoreFetch()
  }
})

await check('first email: while provider_test_mode is on, the UI pre-check never offers a real send, and the server never uses the prospect address', async () => {
  const client = firstEmailClient({ testModeOn: true })
  const recipients = []
  mockFetch(recordingProvider(recipients))
  try {
    const preview = previewFor(client)
    assert.equal(preview.allowed, false)
    assert.ok(preview.reasons[0].includes('حالت آزمایشی'), 'the test-mode reason must come first: ' + preview.reasons[0])
    const result = await realEmailSend(client) // a stale UI still calling the server
    assert.equal(result.testMode, true)
    assert.ok(!recipients.includes('contact@example.com'), 'the prospect must never be emailed while provider_test_mode is on')
    assert.equal(client.tables.outreach_attempts.some((a) => a.idempotency_key === 'send:sugg-1'), false, 'the real key must stay untouched')
  } finally {
    restoreFetch()
  }
})

await check('first email: real-then-real - a confirmed REAL delivery blocks a second real send (server and UI), provider called once', async () => {
  const client = firstEmailClient()
  const recipients = []
  mockFetch(recordingProvider(recipients))
  try {
    assert.equal((await realEmailSend(client)).ok, true)
    const second = await realEmailSend(client)
    assert.equal(second.ok, false)
    assert.equal(recipients.length, 1, 'the provider must never be called for the duplicate')
    const preview = previewFor(client)
    assert.equal(preview.allowed, false)
    assert.ok(preview.reasons.some((r) => r.includes('قبلاً برای مشتری ارسال شده')), JSON.stringify(preview.reasons))
    assert.equal(client.tables.prospect_outreach_suggestions[0].send_status, 'sent')
  } finally {
    restoreFetch()
  }
})

await check('first email: two concurrent real sends for the same suggestion - exactly one reaches the provider', async () => {
  const client = firstEmailClient()
  let providerCalls = 0
  mockFetch(async () => {
    providerCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return jsonFetchResponse({ id: 'resend-race' })
  })
  try {
    const results = await Promise.all([realEmailSend(client), realEmailSend(client)])
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results))
    assert.equal(providerCalls, 1)
    assert.equal(client.tables.outreach_attempts.filter((a) => a.status === 'sent').length, 1)
  } finally {
    restoreFetch()
  }
})

await check('first email: an uncertain earlier real send (claim held, attempt still prepared) blocks the next one and is shown as uncertain, never as delivered', async () => {
  const client = firstEmailClient()
  mockFetch(async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    throw err
  })
  try {
    const first = await realEmailSend(client)
    assert.equal(first.ok, false)
    const preview = previewFor(client)
    assert.equal(preview.history.realUncertain, 1)
    assert.equal(preview.history.realDelivered, 0)
    assert.equal(preview.allowed, false)
  } finally {
    restoreFetch()
  }
  let called = false
  mockFetch(async () => ((called = true), jsonFetchResponse({ id: 'resend-x' })))
  try {
    assert.equal((await realEmailSend(client)).ok, false)
    assert.equal(called, false, 'an uncertain send must never be retried automatically')
  } finally {
    restoreFetch()
  }
})

await check('first email: an ambiguous OLDER record (sent on the real send: key but flagged test_mode=true) blocks the real send with its own reason, is never reported as delivered, and is not guessed', async () => {
  const client = firstEmailClient()
  client.tables.outreach_attempts.push({
    id: 'legacy-1',
    lead_id: 'lead-1',
    suggestion_id: 'sugg-1',
    channel: 'email',
    status: 'sent',
    test_mode: true,
    idempotency_key: 'send:sugg-1',
    created_at: '2026-09-20T08:00:00Z',
  })
  let called = false
  mockFetch(async () => ((called = true), jsonFetchResponse({ id: 'resend-y' })))
  try {
    const result = await realEmailSend(client)
    assert.equal(result.ok, false)
    assert.equal(called, false, 'the provider must never be called over an ambiguous record')
    assert.ok(result.reasons.includes(AMBIGUOUS_PRIOR_DELIVERY_REASON), JSON.stringify(result.reasons))
    assert.ok(!result.reasons.some((r) => r.includes('برای مشتری ارسال شده')), 'must not claim the prospect received it')
    const legacy = client.tables.outreach_attempts.find((a) => a.id === 'legacy-1')
    assert.equal(legacy.status, 'sent')
    assert.equal(legacy.test_mode, true, 'existing records are never altered')

    const preview = previewFor(client)
    assert.equal(preview.allowed, false)
    assert.equal(preview.history.realKeyAmbiguous, 1)
    assert.equal(preview.history.realDelivered, 0)
    assert.ok(preview.reasons.includes(AMBIGUOUS_PRIOR_DELIVERY_REASON))
  } finally {
    restoreFetch()
  }
})

await check('first email: the real email body is exactly the confirmed message + opt-out footer, and the audit snapshot records that exact body and subject', async () => {
  const client = firstEmailClient()
  let sentBody = null
  let sentSubject = null
  mockFetch(async (_url, init) => {
    const payload = JSON.parse(init.body)
    sentBody = payload.text
    sentSubject = payload.subject
    return jsonFetchResponse({ id: 'resend-body' })
  })
  try {
    assert.equal((await realEmailSend(client)).ok, true)
    assert.equal(sentBody, buildEmailBody('متن نهایی ایمیل'))
    assert.ok(sentBody.includes(EMAIL_OPT_OUT_FOOTER), 'every email must carry the opt-out instruction')
    assert.equal(sentSubject, emailSubjectFor(client.tables.prospect_outreach_suggestions[0]))
    const attempt = client.tables.outreach_attempts.find((a) => a.status === 'sent')
    assert.equal(attempt.message_snapshot, sentBody)
    assert.equal(attempt.subject_snapshot, sentSubject)
  } finally {
    restoreFetch()
  }
})

await check('first email: an opt-out (lead marked do_not_contact) blocks the real send on the server and in the UI pre-check, provider never called', async () => {
  const client = firstEmailClient()
  client.tables.sales_leads[0].do_not_contact = true
  let called = false
  mockFetch(async () => ((called = true), jsonFetchResponse({ id: 'resend-dnc' })))
  try {
    const result = await realEmailSend(client)
    assert.equal(result.ok, false)
    assert.equal(called, false)
    assert.ok(result.reasons.some((r) => r.includes('عدم تماس')), JSON.stringify(result.reasons))
    assert.equal(previewFor(client).allowed, false)
  } finally {
    restoreFetch()
  }
})

await check('first email: a BLOCKED attempt (sending switched off) is recorded as cancelled, never as delivered, and does not block a later real send once allowed', async () => {
  const client = firstEmailClient()
  client.tables.automation_settings[0].outreach_enabled = false
  const recipients = []
  mockFetch(recordingProvider(recipients))
  try {
    const blocked = await realEmailSend(client)
    assert.equal(blocked.ok, false)
    assert.equal(recipients.length, 0)
    const row = client.tables.outreach_attempts[0]
    assert.equal(row.status, 'cancelled')
    assert.equal(row.error_code, 'send_gate_blocked')
    const history = previewFor(client).history
    assert.equal(history.failedOrBlocked, 1)
    assert.equal(history.realDelivered, 0)

    client.tables.automation_settings[0].outreach_enabled = true
    const real = await realEmailSend(client)
    assert.equal(real.ok, true, JSON.stringify(real))
    assert.deepEqual(recipients, ['contact@example.com'])
  } finally {
    restoreFetch()
  }
})

await check('classifySendAttempts: separates test, real, uncertain, failed/blocked and ambiguous records, and ignores other suggestions', () => {
  const rows = [
    { idempotency_key: 'test-send:sugg-1', status: 'sent', test_mode: true },
    { idempotency_key: 'test-send:sugg-1', status: 'cancelled', test_mode: true },
    { idempotency_key: 'send:sugg-1', status: 'failed', test_mode: false },
    { idempotency_key: 'send:sugg-1', status: 'prepared', test_mode: false },
    { idempotency_key: 'test-send:sugg-1', status: 'sent', test_mode: false },
    { idempotency_key: 'send:other', status: 'sent', test_mode: false },
    { idempotency_key: null, status: 'completed' },
  ]
  assert.deepEqual(classifySendAttempts(rows, 'sugg-1'), {
    testDelivered: 1,
    realDelivered: 0,
    realUncertain: 1,
    testUncertain: 0,
    failedOrBlocked: 2,
    ambiguous: 1,
    realKeyAmbiguous: 0,
  })
})

console.log(`\n${passed} check(s) passed.`)
