// WhatsApp Cloud API webhook: message statuses (sent / delivered / read /
// failed) and inbound messages (opt-out). See src/outreach/whatsappWebhook.js
// for the rules. Deployed with --no-verify-jwt: Meta sends no Supabase JWT.
//   GET  - Meta's subscription handshake; answered only when hub.verify_token
//          equals WHATSAPP_WEBHOOK_VERIFY_TOKEN.
//   POST - applied only when X-Hub-Signature-256 verifies with
//          WHATSAPP_APP_SECRET (the Meta app's secret).
// Fail-closed: a missing secret -> 503 (Meta retries later), a bad
// signature -> 401. Needs phase37_whatsapp_outreach.sql.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleWhatsAppWebhook, verifyMetaSignature, verifySubscription } from '../../../src/outreach/whatsappWebhook.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET')
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const challenge = verifySubscription({
      mode: url.searchParams.get('hub.mode'),
      token: url.searchParams.get('hub.verify_token'),
      challenge: url.searchParams.get('hub.challenge'),
      verifyToken: VERIFY_TOKEN,
    })
    if (challenge === null) return jsonResponse({ ok: false, error: 'verification_failed' }, 403)
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  if (!APP_SECRET) {
    console.error('whatsapp-webhook: WHATSAPP_APP_SECRET is not set')
    return jsonResponse({ ok: false, error: 'webhook_secret_not_configured' }, 503)
  }

  const body = await req.text()
  const check = await verifyMetaSignature({ appSecret: APP_SECRET, body, signature: req.headers.get('x-hub-signature-256') })
  if (!check.ok) {
    console.error('whatsapp-webhook: rejected', check.reason)
    return jsonResponse({ ok: false, error: 'invalid_signature' }, 401)
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  try {
    const result = await handleWhatsAppWebhook(client, payload)
    console.log('whatsapp-webhook:', JSON.stringify(result))
    return jsonResponse({ ok: true, ...result })
  } catch (err) {
    // 500 -> Meta retries; an event is recorded only after it was applied,
    // and a recorded event is skipped, so a retry never double-applies.
    console.error('whatsapp-webhook: failed', err instanceof Error ? err.message : 'unknown_error')
    return jsonResponse({ ok: false, error: 'apply_failed' }, 500)
  }
})
