// ---------------------------------------------------------------------------
// Phase 26 - Email provider adapter.
//
// Provider chosen: Resend (https://resend.com). Rationale, so this is a
// documented decision and not a guess: a single REST API + API key (no SMTP
// credential juggling, no SDK/npm dependency needed - matches this
// codebase's existing zero-dependency, fetch-based Edge Function style, the
// same as src/prospecting/sourceAdapters/serperSearch.js), a straightforward
// verified-domain/sender model, and first-class support for a plain-text
// body alongside an optional HTML version (STEP 8's requirement). Swapping
// providers later only means rewriting this one file - sendPipeline.js
// never depends on Resend's response shape directly.
//
// SERVER-SIDE CONCEPT ONLY - same discipline as whatsappProvider.js: no
// Deno.env/process.env read here, no browser import anywhere in this
// codebase. Only supabase/functions/outreach-send/index.ts calls this, with
// credentials it read from its own Edge Function secrets.
//
// OUTCOME CONTRACT (Phase 26 follow-up): every call resolves to an explicit
// `outcome`, one of:
//   'accepted' - Resend confirmed it received a valid, non-empty message id.
//                The ONLY outcome sendPipeline.js is allowed to record as a
//                real send.
//   'rejected' - a DEFINITE, DOCUMENTED non-acceptance of THIS specific
//                request (bad input/auth/permissions - see
//                DOCUMENTED_REJECTION_ERRORS below) - nothing was queued,
//                safe to let a retry be attempted after the underlying
//                issue is fixed.
//   'unknown'  - anything else: a timeout, a network error, a malformed/
//                unparseable response body, a 2xx response with no valid
//                message id, or a non-2xx response whose error is NOT on
//                the documented-rejection list (rate limits, quota,
//                5xx/503, 408, 409 idempotency conflicts, or anything
//                unrecognized). We genuinely do not know whether Resend
//                processed the request - sendPipeline.js must never treat
//                this as safe to retry.
// `ok` is kept for backward-compatible logging/display, but is ONLY ever
// true when outcome === 'accepted' - callers that care about retry safety
// must branch on `outcome`, never on `ok` alone.
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15000
const PROVIDER_NAME = 'resend'

// Resend's own documented, EXACT (HTTP status, error name) PAIRS
// (https://resend.com/docs/api-reference/errors) that represent a DEFINITE
// rejection of THIS request - bad input, auth, or permissions, never a
// state where the email could still have been queued/sent. Keyed on the
// pair, not the name alone: the same error name can appear at more than
// one status (e.g. validation_error at both 400 and 403), and checking the
// name in isolation would also let a name we DID vet at one status get
// misclassified as rejected if it ever showed up at a DIFFERENT,
// unvetted status (5xx, 408, 409, or anything else). Deliberately an
// ALLOWLIST, not a denylist: a pair we don't recognize defaults to
// 'unknown' - the safe direction. Verified against the current Resend
// error-codes reference; if Resend adds a new error/status later, it
// starts out (correctly) as 'unknown' until someone deliberately adds the
// exact pair here.
const DOCUMENTED_REJECTION_ERRORS = new Set([
  '400:invalid_idempotency_key', // the idempotency key itself is malformed (1-256 chars)
  '400:validation_error', // malformed request fields
  '401:missing_api_key',
  '401:restricted_api_key', // key lacks the required scope
  '403:invalid_permission',
  '403:restricted_api_key', // key is not active
  '403:suspended_api_key',
  '403:validation_error', // unverified sender domain / recipient restriction
  '404:not_found',
  '405:method_not_allowed',
  '422:invalid_attachment',
  '422:invalid_parameter',
  '422:missing_required_field',
  '422:missing_required_parameter',
])

// 5xx (server-side, may have processed the request before failing), 408
// (request timeout - the request may have reached the server), and 409
// (idempotency conflicts - a DIFFERENT/the SAME request may still
// complete) can NEVER be a confirmed rejection, regardless of what
// body.name says - checked BEFORE the allowlist so no documented name can
// ever override this at one of these statuses.
function isForcedUnknownStatus(status) {
  return status === 408 || status === 409 || status >= 500
}

// Explicitly documented but NEVER treated as a rejection - included here
// only so the exclusion is a deliberate, visible decision, not an
// omission: 'email_above_quota' (403), 'daily_quota_exceeded' (429),
// 'monthly_quota_exceeded' (429), 'rate_limit_exceeded' (429),
// 'application_error' (500), 'service_unavailable' (503),
// 'concurrent_idempotent_requests' (409 - another request with the SAME
// idempotency key is in flight; retrying here would race that same
// request, not avoid it), 'invalid_idempotent_request' (409 - key reused
// with a different payload; the ORIGINAL request under this key may still
// have gone through), 'resource_locked' (409). Every one of these falls
// through to 'unknown' below since it is not in the allowlist above.

function isValidMessageId(id) {
  return typeof id === 'string' && id.trim().length > 0
}

// `idempotencyKey`, when provided, is forwarded as Resend's own
// `Idempotency-Key` header (https://resend.com/docs - idempotent requests) -
// genuine PROVIDER-LEVEL dedup, on top of (never instead of) the atomic
// claim sendPipeline.js takes before ever reaching this function. It is
// ALWAYS the same, stable, per-suggestion key sendPipeline.js already
// computes (idempotencyKeyFor) - this function never generates or rotates
// one itself, and callers must never mint a new key just to route around a
// 409 conflict; doing so would defeat the entire purpose of an idempotency
// key. Meta's WhatsApp Cloud API has no equivalent request-idempotency
// mechanism for the /messages send endpoint, so whatsappProvider.js has no
// matching parameter, and is INTENTIONALLY left untouched by this fix - the
// atomic claim in sendPipeline.js remains its only duplicate-send
// protection, and its own (unchanged) known-outcome classification
// (ok/timeout/network_error) is preserved exactly as before.
export async function sendEmail({ apiKey, fromAddress, fromName, replyTo, recipient, subject, message, htmlMessage, idempotencyKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!apiKey || !fromAddress) {
    return {
      ok: false,
      outcome: 'rejected', // a local config gap, never sent to Resend at all - definite, not ambiguous
      provider: PROVIDER_NAME,
      providerMessageId: null,
      status: 'failed',
      errorCode: 'credentials_missing',
      errorMessage: 'Email API key / verified sender address is not configured.',
    }
  }
  if (!recipient) {
    return {
      ok: false,
      outcome: 'rejected', // same - never reached Resend
      provider: PROVIDER_NAME,
      providerMessageId: null,
      status: 'failed',
      errorCode: 'recipient_missing',
      errorMessage: 'No recipient email address provided.',
    }
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
        to: [recipient],
        reply_to: replyTo || undefined,
        subject,
        text: message,
        // Plain-text is always sent (STEP 8's "plain-text safe fallback");
        // HTML is optional and only added on top when the caller has one.
        html: htmlMessage || undefined,
      }),
      signal: controller.signal,
    })
    let body
    let bodyParseFailed = false
    try {
      body = await response.json()
    } catch {
      bodyParseFailed = true
      body = null
    }

    if (response.ok) {
      if (bodyParseFailed) {
        // A 2xx with an unparseable body - Resend may well have accepted
        // it, we just can't read the confirmation. Ambiguous, not a
        // failure and not a success.
        return {
          ok: false,
          outcome: 'unknown',
          provider: PROVIDER_NAME,
          providerMessageId: null,
          status: 'failed',
          errorCode: 'malformed_response',
          errorMessage: `HTTP ${response.status} with an unparseable response body.`,
        }
      }
      if (!isValidMessageId(body?.id)) {
        // A 2xx with no valid message id - same reasoning: cannot be
        // confirmed as accepted without one.
        return {
          ok: false,
          outcome: 'unknown',
          provider: PROVIDER_NAME,
          providerMessageId: null,
          status: 'failed',
          errorCode: 'missing_message_id',
          errorMessage: `HTTP ${response.status} did not include a valid message id.`,
        }
      }
      return {
        ok: true,
        outcome: 'accepted',
        provider: PROVIDER_NAME,
        providerMessageId: body.id,
        status: 'sent',
        errorCode: null,
        errorMessage: null,
      }
    }

    if (bodyParseFailed) {
      // A non-2xx with an unparseable body - we cannot even read WHAT
      // Resend rejected, so this can never be treated as a confirmed,
      // documented rejection.
      return {
        ok: false,
        outcome: 'unknown',
        provider: PROVIDER_NAME,
        providerMessageId: null,
        status: 'failed',
        errorCode: 'malformed_response',
        errorMessage: `HTTP ${response.status} with an unparseable response body.`,
      }
    }

    const errorName = body?.name
    const outcome = !isForcedUnknownStatus(response.status) && errorName && DOCUMENTED_REJECTION_ERRORS.has(`${response.status}:${errorName}`) ? 'rejected' : 'unknown'
    return {
      ok: false,
      outcome,
      provider: PROVIDER_NAME,
      providerMessageId: null,
      status: 'failed',
      errorCode: errorName || String(response.status),
      errorMessage: body?.message || `HTTP ${response.status}`,
    }
  } catch (err) {
    const isTimeout = err?.name === 'AbortError'
    return {
      ok: false,
      outcome: 'unknown', // timeout/network errors are ALWAYS ambiguous - the request may still have reached Resend
      provider: PROVIDER_NAME,
      providerMessageId: null,
      status: 'failed',
      errorCode: isTimeout ? 'timeout' : 'network_error',
      errorMessage: isTimeout ? `Request timed out after ${timeoutMs}ms` : err?.message || 'Unknown network error',
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

// Delivery status of an already-accepted email (Resend GET /emails/{id} -
// `last_event`: delivered, bounced, complained, delivery_delayed, sent,
// opened, clicked, ...). Read-only; never sends. Returns
// { ok, status, error } - status is the raw last_event string.
export async function fetchEmailDeliveryStatus({ apiKey, providerMessageId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!apiKey || !isValidMessageId(providerMessageId)) return { ok: false, status: null, error: 'missing_key_or_id' }
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerMessageId)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, status: null, error: `HTTP ${response.status}` }
    const body = await response.json().catch(() => null)
    return typeof body?.last_event === 'string' ? { ok: true, status: body.last_event, error: null } : { ok: false, status: null, error: 'no_last_event' }
  } catch (err) {
    return { ok: false, status: null, error: err?.name === 'AbortError' ? 'timeout' : 'network_error' }
  } finally {
    clearTimeout(timeoutHandle)
  }
}
