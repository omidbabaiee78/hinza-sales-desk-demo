// WhatsApp / Bale introduction - server-side run of runChannelOutreachCycle()
// (src/outreach/channelOutreachPipeline.js). Needs phase34 SQL.
//
// Both channels are OFF unless automation_settings.whatsapp_provider_enabled
// / bale_provider_enabled is true AND the provider secrets below are set.
// Until then each run only records contacts as "waiting for provider".
//
// Secrets (all optional - a missing one keeps that channel unconfigured):
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID   (same as outreach-send)
//   WHATSAPP_INTRO_TEMPLATE, WHATSAPP_INTRO_TEMPLATE_LANGUAGE (default fa),
//   WHATSAPP_INTRO_TEMPLATE_PARAMS = "company_name" | "" - an approved
//     WhatsApp Manager template; a cold first message must be a template
//   BALE_SAFIR_API_KEY, BALE_SAFIR_BOT_ID  - Safir, sends to phone numbers
//     of Bale users (business account + credit required)
//   BALE_BOT_TOKEN - Bot API, only for leads with a known bale_chat_id
//
// Auth, same pattern as outreach-auto-email:
//   1. x-outreach-channels-secret = OUTREACH_CHANNELS_CRON_SECRET (pg_cron)
//   2. an approved admin's session (the "Run now" button)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { runChannelOutreachCycle } from '../../../src/outreach/channelOutreachPipeline.js'
import { sendWhatsAppTemplate } from '../../../src/outreach/providers/whatsappProvider.js'
import { sendBaleBot, sendBaleSafir } from '../../../src/outreach/providers/baleProvider.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const CRON_SECRET = Deno.env.get('OUTREACH_CHANNELS_CRON_SECRET')

const WHATSAPP = {
  accessToken: Deno.env.get('WHATSAPP_ACCESS_TOKEN') || null,
  phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || null,
  templateName: Deno.env.get('WHATSAPP_INTRO_TEMPLATE') || null,
  languageCode: Deno.env.get('WHATSAPP_INTRO_TEMPLATE_LANGUAGE') || 'fa',
  params: Deno.env.get('WHATSAPP_INTRO_TEMPLATE_PARAMS') || '',
}
const BALE = {
  safirApiKey: Deno.env.get('BALE_SAFIR_API_KEY') || null,
  safirBotId: Deno.env.get('BALE_SAFIR_BOT_ID') || null,
  botToken: Deno.env.get('BALE_BOT_TOKEN') || null,
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-outreach-channels-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

async function authenticate(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const providedSecret = req.headers.get('x-outreach-channels-secret')
  if (CRON_SECRET && providedSecret && providedSecret === CRON_SECRET) return { actorType: 'cron' as const }
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !SUPABASE_URL || !ANON_KEY) return null
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } })
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return null
  const { data: profile } = await serviceClient.from('profiles').select('role, approval_status').eq('id', user.id).single()
  if (profile?.role !== 'admin' || profile?.approval_status !== 'approved') return null
  return { actorType: 'admin' as const }
}

Deno.serve(async (req) => {
  const startedAt = Date.now()
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CRON_SECRET) {
    console.error('outreach-channels: missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or OUTREACH_CHANNELS_CRON_SECRET')
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  }
  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const auth = await authenticate(req, client)
  if (!auth) return jsonResponse({ ok: false, error: 'unauthorized' }, 401)

  const providers = {
    whatsapp: ({ recipient, lead }: { recipient: string; lead: { company_name?: string } }) =>
      sendWhatsAppTemplate({
        accessToken: WHATSAPP.accessToken,
        phoneNumberId: WHATSAPP.phoneNumberId,
        recipient,
        templateName: WHATSAPP.templateName,
        languageCode: WHATSAPP.languageCode,
        bodyParameters: WHATSAPP.params === 'company_name' ? [lead.company_name || 'شرکت شما'] : [],
      }),
    baleSafir: ({ phoneNumber, text, requestId }: { phoneNumber: string; text: string; requestId: string }) =>
      sendBaleSafir({ apiKey: BALE.safirApiKey, botId: BALE.safirBotId, phoneNumber, text, requestId }),
    baleBot: ({ chatId, text }: { chatId: string; text: string }) => sendBaleBot({ token: BALE.botToken, chatId, text }),
  }

  try {
    const result = await runChannelOutreachCycle(client, { trigger: auth.actorType, credentials: { whatsapp: WHATSAPP, bale: BALE }, providers })
    console.log('outreach-channels: finish', JSON.stringify({ registered: result.registered, sent: result.sent, failed: result.failed, uncertain: result.uncertain, readiness: result.readiness }))
    return jsonResponse({ ok: true, ...result, duration_ms: Date.now() - startedAt })
  } catch (err) {
    console.error('outreach-channels: failed', err instanceof Error ? err.message : 'unknown_error')
    return jsonResponse({ ok: false, error: 'channel_outreach_failed', duration_ms: Date.now() - startedAt }, 500)
  }
})
