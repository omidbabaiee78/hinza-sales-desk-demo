// Phase 26 - real provider send (WhatsApp / Email). Runs the EXACT SAME
// attemptSend() pipeline (src/outreach/sendPipeline.js) an admin action
// would call directly - only the DB client (service-role) and credential
// wiring are server-specific.
//
// DELIBERATELY ADMIN-JWT ONLY - unlike prospect-discovery/outreach-shadow,
// this function has NO cron-secret authentication path at all. A real send
// must always be a specific, logged-in admin's explicit action; no
// scheduled/unattended trigger can ever reach this function structurally,
// not just by convention (see the "Two ways to authenticate" comment in
// prospect-discovery/index.ts for contrast - this function only has ONE).
//
// PREPARED FOR DEPLOYMENT. Every provider credential below is read from
// Edge Function secrets that do not exist yet (Phase 26 STEP 14) - until
// they are configured, attemptSend()'s own fail-closed gate blocks every
// send with 'credentials_missing', regardless of anything else.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { attemptSend } from '../../../src/outreach/sendPipeline.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

// WhatsApp Cloud API - unset until STEP 14's credential setup is complete.
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
const WHATSAPP_TEST_RECIPIENT = Deno.env.get('WHATSAPP_TEST_RECIPIENT')

// Resend (email) - unset until STEP 14's credential setup is complete.
const EMAIL_API_KEY = Deno.env.get('RESEND_API_KEY')
const EMAIL_FROM_ADDRESS = Deno.env.get('EMAIL_FROM_ADDRESS')
const EMAIL_FROM_NAME = Deno.env.get('EMAIL_FROM_NAME')
const EMAIL_REPLY_TO = Deno.env.get('EMAIL_REPLY_TO')
const EMAIL_TEST_RECIPIENT = Deno.env.get('EMAIL_TEST_RECIPIENT')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

async function authenticateAdmin(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !SUPABASE_URL || !ANON_KEY) return null

  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } })
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return null

  // Aligned with private.is_admin() (Phase 26 privilege-escalation fix) -
  // role='admin' ALONE is not enough; an admin whose own approval_status
  // isn't 'approved' (e.g. a role flip that hasn't been through the real
  // admin-approval process, or a suspended admin) must not be able to
  // trigger a real send either.
  const { data: profile } = await serviceClient.from('profiles').select('role, approval_status').eq('id', user.id).single()
  if (profile?.role !== 'admin' || profile?.approval_status !== 'approved') return null

  return { userId: user.id }
}

Deno.serve(async (req) => {
  const startedAt = Date.now()

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('outreach-send: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const admin = await authenticateAdmin(req, client)
  if (!admin) {
    console.error('outreach-send: rejected request - no valid admin session')
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  let suggestionId: string | null = null
  let testMode: boolean | undefined
  try {
    const body = await req.json().catch(() => ({}))
    suggestionId = body?.suggestionId || null
    testMode = typeof body?.testMode === 'boolean' ? body.testMode : undefined
  } catch {
    suggestionId = null
  }

  if (!suggestionId) return jsonResponse({ ok: false, error: 'suggestion_id_required' }, 400)

  console.log('outreach-send: start', `admin=${admin.userId}`, `suggestion=${suggestionId}`, testMode !== undefined ? `testMode=${testMode}` : '')

  try {
    const result = await attemptSend(client, {
      suggestionId,
      actorUserId: admin.userId,
      testMode,
      credentials: {
        whatsapp: WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID ? { accessToken: WHATSAPP_ACCESS_TOKEN, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID } : null,
        email: EMAIL_API_KEY && EMAIL_FROM_ADDRESS ? { apiKey: EMAIL_API_KEY, fromAddress: EMAIL_FROM_ADDRESS, fromName: EMAIL_FROM_NAME, replyTo: EMAIL_REPLY_TO } : null,
      },
      testRecipients: { whatsapp: WHATSAPP_TEST_RECIPIENT || null, email: EMAIL_TEST_RECIPIENT || null },
    })
    const durationMs = Date.now() - startedAt

    // Never return the message text, recipient, or any credential - status/
    // reason/ids only, same "no unnecessary PII" discipline as every other
    // server-side function in this project.
    const response = {
      ok: result.ok,
      reasons: result.reasons || null,
      attemptId: result.attemptId || null,
      provider: result.provider || null,
      providerMessageId: result.providerMessageId || null,
      status: result.status || null,
      errorCode: result.errorCode || null,
      testMode: result.testMode,
      duration_ms: durationMs,
    }
    console.log('outreach-send: finish', JSON.stringify({ ok: response.ok, status: response.status, errorCode: response.errorCode, testMode: response.testMode }))
    return jsonResponse(response, 200)
  } catch (err) {
    const durationMs = Date.now() - startedAt
    console.error('outreach-send: failed', err instanceof Error ? err.message : 'unknown_error', `${durationMs}ms`)
    return jsonResponse({ ok: false, error: 'send_failed', duration_ms: durationMs }, 500)
  }
})
