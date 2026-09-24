// Resend delivery webhook: email.delivered / email.bounced / email.complained.
// See src/outreach/resendWebhook.js for the rules. Deployed with
// --no-verify-jwt: Resend sends no Supabase JWT - the Svix signature
// (RESEND_WEBHOOK_SECRET, the endpoint's "whsec_..." signing secret) is the
// only credential, and nothing is written unless it verifies.
// Fail-closed: no secret -> 503 (Resend retries later), bad signature -> 401.
// Needs phase32_resend_webhook.sql.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { applyResendEvent, verifyResendSignature } from '../../../src/outreach/resendWebhook.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET')

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  if (!WEBHOOK_SECRET) {
    console.error('resend-webhook: RESEND_WEBHOOK_SECRET is not set')
    return jsonResponse({ ok: false, error: 'webhook_secret_not_configured' }, 503)
  }

  const body = await req.text()
  const eventId = req.headers.get('svix-id')
  const check = await verifyResendSignature({
    secret: WEBHOOK_SECRET,
    id: eventId,
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
    body,
  })
  if (!check.ok) {
    console.error('resend-webhook: rejected', check.reason)
    return jsonResponse({ ok: false, error: 'invalid_signature' }, 401)
  }

  let event
  try {
    event = JSON.parse(body)
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  try {
    const result = await applyResendEvent(client, { eventId, event, payloadText: body })
    console.log('resend-webhook:', event?.type, JSON.stringify({ duplicate: result.duplicate, status: result.status, attempts: result.attemptsUpdated, suppressed: result.suppressed.length, optedOut: result.leadsOptedOut }))
    return jsonResponse({ ok: true, ...result, suppressed: result.suppressed.length })
  } catch (err) {
    // 500 -> Resend retries; the unique svix-id keeps a retry from double-applying.
    console.error('resend-webhook: failed', err instanceof Error ? err.message : 'unknown_error')
    return jsonResponse({ ok: false, error: 'apply_failed' }, 500)
  }
})
