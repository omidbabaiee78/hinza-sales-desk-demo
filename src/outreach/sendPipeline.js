// ---------------------------------------------------------------------------
// Phase 26 - the ONE orchestrator for a real provider send. Same convention
// as src/outreach/shadowPipeline.js / src/prospecting/discoveryPipeline.js -
// no Supabase client imported here, it is always passed in, so this runs
// identically from an admin action or, server-side, from
// supabase/functions/outreach-send/index.ts.
//
// `credentials`/`testRecipients` are ALWAYS injected by the caller (the
// Edge Function, which reads them from its own Deno.env secrets) - this
// file never reads an environment variable itself, so a browser build could
// import it without ever being able to leak a real secret (there isn't one
// to leak), and it stays fully mockable in Node for regression tests.
//
// Concurrency safety (Phase 26 follow-up): the OLD design only guarded a
// duplicate send with a `select ... where status='sent'` check BEFORE
// calling the provider, then relied on a partial unique index on
// (idempotency_key) WHERE status='sent' to catch the DB write at the end.
// That leaves a real race window - two concurrent requests can each pass the
// pre-check (neither has written 'sent' yet) and BOTH reach the provider,
// double-sending to a real customer; the unique index only ever stops the
// second DB ROW, never the second PROVIDER CALL. The fix here is an atomic
// CLAIM (see claimSend()/outreach_send_claims, supabase/sql/
// phase26b_atomic_send_claims.sql) taken via a conditional DB write BEFORE
// the provider is ever called - only one concurrent caller can win it.
// ---------------------------------------------------------------------------

import { evaluateSendGate, maskRecipient, resolveEffectiveTestMode, sendIdempotencyKey, buildEmailBody, emailSubjectFor } from './sendGate.js'
import { getProviderSendFn } from './providers/index.js'

// Test and production sends are scoped to DIFFERENT idempotency keys (and
// therefore different claim rows) - a test send must never be able to
// "consume" the one-shot production idempotency key for a suggestion (or
// vice versa). Within its own scope, a send is still one-shot: a SECOND
// test send for the same suggestion is blocked exactly like a second
// production send would be, once the first has reached a definite outcome.
// Defined in sendGate.js so the admin UI's pre-check (previewFirstEmailSend)
// derives exactly the same key - never a second copy of the formula.
const idempotencyKeyFor = sendIdempotencyKey

async function fetchSuggestionWithLead(client, suggestionId) {
  const { data, error } = await client.from('prospect_outreach_suggestions').select('*, sales_leads(*)').eq('id', suggestionId).single()
  if (error) throw error
  const { sales_leads: lead, ...suggestion } = data
  return { suggestion, lead }
}

async function fetchAutomationSettings(client) {
  const { data, error } = await client.from('automation_settings').select('*').eq('id', 1).single()
  if (error) throw error
  return data
}

async function fetchLeadAttempts(client, leadId) {
  const { data, error } = await client.from('outreach_attempts').select('*').eq('lead_id', leadId)
  if (error) throw error
  return data || []
}

// The (at most one - see the partial unique index on status='sent') prior
// successful attempt on this key, with its recorded test_mode, or null.
async function existingSentAttempt(client, idempotencyKey) {
  const { data, error } = await client.from('outreach_attempts').select('id, test_mode').eq('idempotency_key', idempotencyKey).eq('status', 'sent').maybeSingle()
  if (error) throw error
  return data || null
}

// A prior 'sent' row on this key blocks either way. Whether it counts as a
// normal duplicate or as an ambiguous record depends on whether its own
// test_mode agrees with the key it sits on (see classifySendAttempts in
// sendGate.js): e.g. a test-flagged row on the real send: key means the
// delivery mode can't be determined, so it is never reported as delivered
// to the prospect and never allowed through - it waits for manual
// reconciliation instead.
export function priorSendState(priorSent, effectiveTestMode) {
  if (!priorSent) return { duplicateIdempotencyExists: false, ambiguousPriorDelivery: false }
  const agreesWithKey = (priorSent.test_mode === true) === Boolean(effectiveTestMode)
  return { duplicateIdempotencyExists: agreesWithKey, ambiguousPriorDelivery: !agreesWithKey }
}

// The ATOMIC claim. Returns true iff THIS call now exclusively owns the
// right to call the provider for this idempotency key - under a genuine
// concurrent race, exactly ONE of the racing calls gets true and only that
// one ever proceeds to call the provider; every other caller gets false and
// is blocked before ever reaching it.
//
// Neither step is an unconditional upsert (which would silently overwrite
// whatever state the row is currently in) nor a delete-then-insert (which
// is inherently non-atomic - another request could insert its own row in
// the gap between the delete and the insert). Both steps are single,
// conditional SQL statements PostgREST issues atomically in one round trip:
//
// Step 1 - try to INSERT a brand-new claim row. `ignoreDuplicates: true`
// makes Supabase/PostgREST issue `insert ... on conflict (idempotency_key)
// do nothing` - ONE atomic statement. A conflicting concurrent insert is
// silently skipped (never an error, never an overwrite) and `.select()` on
// it comes back empty - that is how we detect "someone already has this
// key".
//
// Step 2 - if a row already exists, the ONLY way to reclaim it is a
// conditional UPDATE - `update ... where idempotency_key = $1 and status =
// 'failed'` - again ONE atomic statement, that only matches while the row's
// CURRENT status is 'failed' (a definite, known, safe-to-retry outcome;
// never merely "not yet delivered" - see the reconciliation guidance in
// phase26b_atomic_send_claims.sql for what actually qualifies). This is
// genuinely atomic: Postgres row-locks the target row for the UPDATE, so
// under a real race only one concurrent caller's `eq('status', 'failed')`
// predicate can still be true once its lock is granted - Postgres commits
// the winner's change first, and the loser's own WHERE clause is then
// re-evaluated against that already-committed row, so it matches 0 rows. A
// row that is 'claimed' (in flight, or any outcome short of a confirmed
// non-acceptance) or 'sent' can NEVER be reclaimed this way - exactly the
// "don't blindly retry or release the claim" requirement.
async function claimSend(client, { idempotencyKey, suggestionId, channel, testMode, actorUserId, nowIso }) {
  const insertResult = await client
    .from('outreach_send_claims')
    .upsert(
      { idempotency_key: idempotencyKey, suggestion_id: suggestionId, channel, test_mode: testMode, status: 'claimed', claimed_at: nowIso, claimed_by: actorUserId || null, resolved_at: null },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    .select()
  if (insertResult.error) throw insertResult.error
  if (insertResult.data && insertResult.data.length > 0) return true

  const reclaimResult = await client
    .from('outreach_send_claims')
    .update({ status: 'claimed', claimed_at: nowIso, claimed_by: actorUserId || null, resolved_at: null })
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'failed')
    .select()
  if (reclaimResult.error) throw reclaimResult.error
  return Boolean(reclaimResult.data && reclaimResult.data.length > 0)
}

// Only ever called when we know FOR CERTAIN no provider call was made (a
// failure before the provider was even reached, e.g. the audit-row insert
// itself failed) - safe to free the key up for an immediate retry. Guarded
// with `eq('status', 'claimed')` - the same "only transition from the exact
// state we expect" discipline as claimSend()'s reclaim step - so this can
// never downgrade a row that something else already resolved (e.g. a
// concurrent reconciliation) out from under it.
async function releaseClaimForRetry(client, idempotencyKey) {
  try {
    await client.from('outreach_send_claims').update({ status: 'failed', resolved_at: new Date().toISOString() }).eq('idempotency_key', idempotencyKey).eq('status', 'claimed')
  } catch {
    // Best-effort. If even this fails, the claim simply stays 'claimed'
    // forever, which just blocks a retry until a human clears it manually -
    // safe (fails closed), never a silent hazard.
  }
}

// Only ever called for a DEFINITE provider outcome (success, or a clean
// provider-reported failure) - never for a timeout/network (unknown)
// outcome, which must leave the claim 'claimed' indefinitely. Same
// `eq('status', 'claimed')` guard as releaseClaimForRetry() - this call
// only ever expects to be resolving the claim IT just took.
async function resolveClaim(client, idempotencyKey, status) {
  try {
    await client.from('outreach_send_claims').update({ status, resolved_at: new Date().toISOString() }).eq('idempotency_key', idempotencyKey).eq('status', 'claimed')
  } catch {
    // Best-effort, same reasoning as releaseClaimForRetry() - staying
    // 'claimed' is the safe failure direction.
  }
}

// Records a blocked/cancelled attempt for full auditability, even when the
// gate (or the claim) refused the send BEFORE ever calling a provider -
// STEP 9's "every attempted send records..." applies to a blocked
// admin-triggered attempt too, not only a successful/failed provider call.
async function recordBlockedAttempt(client, { suggestion, lead, channel, reasons, idempotencyKey, testMode, actorUserId }) {
  const { error } = await client.from('outreach_attempts').insert({
    lead_id: lead?.id || null,
    suggestion_id: suggestion?.id || null,
    channel: channel || 'email',
    purpose: 'provider_send',
    execution_mode: 'provider',
    status: 'cancelled',
    failure_reason: reasons.join('؛ '),
    error_code: 'send_gate_blocked',
    idempotency_key: idempotencyKey,
    test_mode: testMode,
    created_by: actorUserId || null,
    approved_by: suggestion?.approved_by || null,
    approved_at: suggestion?.approved_at || null,
  })
  if (error) throw error
}

const VALID_OUTCOMES = new Set(['accepted', 'rejected', 'unknown'])

// Classifies a provider result into the three-state outcome contract:
// 'accepted' (a real send - the ONLY outcome that may ever resolve to
// 'sent'), 'rejected' (a definite, documented non-acceptance - safe to
// retry), or 'unknown' (we genuinely do not know what happened - NEVER
// treated as a definite success OR a definite, retry-safe failure).
//
// EMAIL has a mandatory, fail-closed outcome contract: emailProvider.js
// (Phase 26 follow-up) sets `result.outcome` explicitly per Resend's own
// documented error taxonomy - see its own header comment for the full
// contract (a 2xx requires a valid message id to count as 'accepted';
// malformed responses, missing ids, 5xx/429/408/409 and any unrecognized
// error all fall through to 'unknown'; only an allowlisted, documented
// (status, name) pair counts as 'rejected'). For email, `result.ok` is
// NEVER consulted here - only an EXACT, valid `result.outcome` value is
// ever trusted; a missing, undefined, or invalid/garbled outcome value
// (a bug in the provider, a future code path that forgot to set it, a
// typo) fails closed to 'unknown', never silently falls back to `ok`.
//
// whatsappProvider.js is INTENTIONALLY left untouched by that fix (Meta's
// Graph API has no comparably documented error taxonomy to vet against),
// so it never sets `result.outcome` - the fallback below (used ONLY for a
// non-email channel) reproduces its EXACT PRE-EXISTING classification
// (only a timeout/network error was ever treated as unknown; every other
// WhatsApp error was, and still is, treated as a definite rejection). This
// preserves WhatsApp's current safe behavior unchanged, without extending
// it any new leniency or new risk.
// Exported for direct, focused unit testing of the fail-closed contract
// (see scripts/checkOutreachSend.mjs) - same reasoning as sendGate.js's
// exported resolveEffectiveTestMode: a pure function this important should
// be testable without needing a mocked provider/fetch call to exercise it.
export function classifyOutcome(result, channel) {
  if (channel === 'email') {
    return VALID_OUTCOMES.has(result.outcome) ? result.outcome : 'unknown'
  }
  if (result.errorCode === 'timeout' || result.errorCode === 'network_error') return 'unknown'
  return result.ok ? 'accepted' : 'rejected'
}

// The main entry point. `credentials` = { whatsapp: {accessToken,
// phoneNumberId} | null, email: {apiKey, fromAddress, fromName, replyTo} |
// null }. `testRecipients` = { whatsapp, email }. `testMode` overrides
// automation_settings.provider_test_mode for this one call when explicitly
// passed (undefined = defer to the persisted setting, which defaults TRUE).
export async function attemptSend(client, { suggestionId, actorUserId, testMode, credentials = {}, testRecipients = {}, now = new Date() } = {}) {
  const [{ suggestion, lead }, settings] = await Promise.all([fetchSuggestionWithLead(client, suggestionId), fetchAutomationSettings(client)])

  const channel = suggestion?.channel
  const channelCredentials = channel === 'whatsapp' ? credentials.whatsapp : channel === 'email' ? credentials.email : null
  const credentialsConfigured =
    channel === 'whatsapp'
      ? Boolean(channelCredentials?.accessToken && channelCredentials?.phoneNumberId)
      : channel === 'email'
        ? Boolean(channelCredentials?.apiKey && channelCredentials?.fromAddress)
        : false

  // Computed with the SAME shared formula evaluateSendGate() itself uses
  // (see sendGate.js's resolveEffectiveTestMode) so the idempotency
  // key/claim scope and the gate's own decision can never disagree about
  // whether this is a test or a production send.
  const effectiveTestMode = resolveEffectiveTestMode(settings, testMode)
  const idempotencyKey = idempotencyKeyFor(suggestionId, effectiveTestMode)

  const [leadAttempts, priorSent] = await Promise.all([
    lead ? fetchLeadAttempts(client, lead.id) : Promise.resolve([]),
    existingSentAttempt(client, idempotencyKey),
  ])
  const { duplicateIdempotencyExists, ambiguousPriorDelivery } = priorSendState(priorSent, effectiveTestMode)

  const gate = evaluateSendGate({
    suggestion,
    lead,
    settings,
    leadAttempts,
    credentialsConfigured,
    duplicateIdempotencyExists,
    ambiguousPriorDelivery,
    testMode,
    testRecipients,
    now,
  })

  if (!gate.allowed) {
    await recordBlockedAttempt(client, { suggestion, lead, channel, reasons: gate.reasons, idempotencyKey, testMode: gate.testMode, actorUserId })
    return { ok: false, reasons: gate.reasons, testMode: gate.testMode }
  }

  const nowIso = new Date().toISOString()

  // THE atomic race guard - see claimSend()'s own comment. Nothing before
  // this point has called (or committed to calling) the provider, so
  // losing the claim here is simply "another request already owns this
  // send", never a partial/ambiguous state.
  const claimed = await claimSend(client, { idempotencyKey, suggestionId: suggestion.id, channel, testMode: gate.testMode, actorUserId, nowIso })
  if (!claimed) {
    const reasons = ['ارسال دیگری برای این پیشنهاد هم‌اکنون در حال انجام است یا قبلاً تکمیل شده است - برای جلوگیری از ارسال تکراری، این درخواست مسدود شد.']
    await recordBlockedAttempt(client, { suggestion, lead, channel, reasons, idempotencyKey, testMode: gate.testMode, actorUserId })
    return { ok: false, reasons, testMode: gate.testMode }
  }

  const finalMessage = suggestion.message_final || suggestion.message_draft
  // Email: the exact body/subject the provider receives (message + opt-out
  // footer), also what the admin saw in the confirmation dialog and what the
  // audit snapshot records. WhatsApp keeps the plain message.
  const sentBody = channel === 'email' ? buildEmailBody(finalMessage) : finalMessage
  const sentSubject = channel === 'email' ? emailSubjectFor(suggestion) : suggestion.subject_draft || null
  const recipientMasked = maskRecipient(gate.recipient, channel)

  let attemptRow
  try {
    const { data, error: insertError } = await client
      .from('outreach_attempts')
      .insert({
        lead_id: lead.id,
        suggestion_id: suggestion.id,
        channel,
        purpose: 'provider_send',
        message_snapshot: sentBody,
        subject_snapshot: sentSubject,
        execution_mode: 'provider',
        status: 'prepared',
        idempotency_key: idempotencyKey,
        test_mode: gate.testMode,
        recipient_masked: recipientMasked,
        created_by: actorUserId || null,
        approved_by: suggestion.approved_by || null,
        approved_at: suggestion.approved_at || null,
      })
      .select('*')
      .single()
    if (insertError) throw insertError
    attemptRow = data
  } catch (err) {
    // No provider call was ever made - safe to free the claim for a retry.
    await releaseClaimForRetry(client, idempotencyKey)
    throw err
  }

  // A TEST send must never touch the production suggestion's own
  // send_status/status/acted_* fields - those represent the PRODUCTION
  // lifecycle, and a test send is not a production action. Only the
  // outreach_attempts audit row (and the claim) reflect a test send.
  if (!gate.testMode) {
    await client.from('prospect_outreach_suggestions').update({ send_status: 'sending', updated_at: nowIso }).eq('id', suggestion.id)
  }

  const sendFn = getProviderSendFn(channel)
  const providerParams =
    channel === 'whatsapp'
      ? { accessToken: channelCredentials.accessToken, phoneNumberId: channelCredentials.phoneNumberId, recipient: gate.recipient, message: finalMessage }
      : {
          apiKey: channelCredentials.apiKey,
          fromAddress: channelCredentials.fromAddress,
          fromName: channelCredentials.fromName,
          replyTo: channelCredentials.replyTo,
          recipient: gate.recipient,
          subject: sentSubject,
          message: sentBody,
          // Provider-level idempotency (Resend honors this header) as
          // defense-in-depth ON TOP OF the claim above - see
          // emailProvider.js's own comment. WhatsApp has no equivalent, so
          // providerParams for that channel intentionally has no such key.
          idempotencyKey,
        }

  const result = await sendFn(providerParams)
  const resolvedAtIso = new Date().toISOString()
  // Three-state classification (see classifyOutcome()'s own comment):
  // 'accepted' is the ONLY outcome that may ever be recorded as a real
  // send; 'rejected' is a definite, documented non-acceptance (retryable);
  // 'unknown' means the actual outcome is not established and must never
  // be treated as either.
  const outcome = classifyOutcome(result, channel)
  const accepted = outcome === 'accepted'
  const rejected = outcome === 'rejected'
  // Computed from the two KNOWN states explicitly, never as "not unknown" -
  // classifyOutcome() already guarantees outcome is exactly one of
  // accepted/rejected/unknown, but this keeps the known/unknown boundary
  // defined by what IS known, not by elimination.
  const outcomeKnown = accepted || rejected

  // NOTE: supabase-js does NOT throw on a write failure by default - update()/
  // insert() resolve with { error } rather than rejecting. Every write below
  // explicitly checks `error` and throws it itself (caught right below) -
  // relying on an uncaught exception here would silently miss exactly the
  // "provider succeeded, DB write failed" case this block exists to catch.
  let bookkeepingError = null
  try {
    const { error: attemptUpdateError } = await client
      .from('outreach_attempts')
      .update({
        // An unknown outcome leaves the attempt row at 'prepared' - it is
        // NOT marked 'failed' (which would wrongly imply a confirmed,
        // documented rejection) nor 'sent' (which would wrongly imply a
        // confirmed acceptance).
        status: accepted ? 'sent' : rejected ? 'failed' : 'prepared',
        provider: result.provider,
        external_message_id: result.providerMessageId,
        error_code: result.errorCode,
        failure_reason: outcomeKnown ? result.errorMessage : `${result.errorMessage || 'نتیجه نامشخص'} - این مورد نیازمند بررسی دستی (reconciliation) است.`,
        opened_at: accepted ? resolvedAtIso : null,
        acted_at: outcomeKnown ? resolvedAtIso : null,
        updated_at: resolvedAtIso,
      })
      .eq('id', attemptRow.id)
    if (attemptUpdateError) throw attemptUpdateError

    // Same test-vs-production rule as the pre-send 'sending' update above -
    // a test send never mutates the production suggestion row, in success
    // OR failure, known OR unknown outcome.
    if (!gate.testMode && outcomeKnown) {
      const { error: suggestionUpdateError } = await client
        .from('prospect_outreach_suggestions')
        .update({
          send_status: accepted ? 'sent' : 'failed',
          status: accepted ? 'acted' : suggestion.status,
          acted_at: accepted ? resolvedAtIso : suggestion.acted_at,
          acted_by: accepted ? actorUserId || null : suggestion.acted_by,
          updated_at: resolvedAtIso,
        })
        .eq('id', suggestion.id)
      if (suggestionUpdateError) throw suggestionUpdateError
    }

    // A genuine PRODUCTION send with a CONFIRMED acceptance (never a test
    // send, which goes to a test destination, not the real customer, and
    // never an unknown/rejected outcome) stamps the lead's own timeline -
    // same "a real contact stamps last_contact_at" rule every other manual
    // outreach action in this app already follows (see
    // utils/leadStatus.js's CONTACT_ACTIVITY_TYPES).
    if (accepted && !gate.testMode) {
      const { error: activityError } = await client.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: channel === 'whatsapp' ? 'whatsapp' : 'email',
        note: `ارسال خودکار (${result.provider}) - شناسه پیام: ${result.providerMessageId || '—'}`,
        created_by: actorUserId || null,
      })
      if (activityError) throw activityError
      const { error: leadUpdateError } = await client.from('sales_leads').update({ last_contact_at: resolvedAtIso }).eq('id', lead.id)
      if (leadUpdateError) throw leadUpdateError
    }
  } catch (err) {
    bookkeepingError = err
  }

  // The claim is resolved to a DEFINITE state only for accepted/rejected -
  // only 'accepted' resolves to 'sent', only a confirmed 'rejected'
  // resolves to 'failed' (which is the ONLY state claimSend() will ever
  // reclaim for a retry). For 'unknown' it is deliberately left 'claimed' -
  // never auto-released, never auto-retried - until a human reconciles the
  // real outcome with the provider directly (see phase26b_atomic_send_
  // claims.sql's reconciliation guidance).
  if (outcomeKnown) {
    await resolveClaim(client, idempotencyKey, accepted ? 'sent' : 'failed')
  }

  if (bookkeepingError) {
    // The provider call itself already happened (and may well have
    // succeeded) - this must NEVER be reported as a plain success (the
    // admin would have no reason to check further) and must never be
    // silently swallowed either. Returning ok:false with a distinct error
    // code, while the claim stays non-retryable unless the outcome was
    // definite, is what prevents this from ever causing a second send.
    return {
      ok: false,
      attemptId: attemptRow.id,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      status: result.status,
      errorCode: 'record_write_failed',
      errorMessage: 'ارسال ممکن است توسط سرویس‌دهنده انجام شده باشد اما ثبت نتیجه در پایگاه‌داده با خطا مواجه شد - این مورد باید به‌صورت دستی بررسی شود؛ تلاش مجدد خودکار انجام نشود.',
      testMode: gate.testMode,
    }
  }

  if (!outcomeKnown) {
    return {
      ok: false,
      attemptId: attemptRow.id,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      status: result.status,
      errorCode: result.errorCode,
      errorMessage: 'نتیجه ارسال نزد سرویس‌دهنده نامشخص است - وضعیت واقعی باید به‌صورت دستی نزد سرویس‌دهنده بررسی شود (reconciliation)؛ تلاش مجدد خودکار مجاز نیست.',
      testMode: gate.testMode,
    }
  }

  return {
    ok: accepted,
    attemptId: attemptRow.id,
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    testMode: gate.testMode,
  }
}
