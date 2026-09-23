// ---------------------------------------------------------------------------
// Phase 26 - WhatsApp Cloud API (Meta) provider adapter.
//
// SERVER-SIDE CONCEPT ONLY - this file never reads Deno.env/process.env
// itself and never imports the browser Supabase client. It is imported
// ONLY by supabase/functions/outreach-send/index.ts, which reads the real
// access token from its own Edge Function secret and passes it in as a
// plain argument. This keeps the access token structurally impossible to
// reach any browser-bundled file (this module could theoretically be
// imported client-side without ever leaking a real secret, since it never
// holds one itself) and keeps this file fully unit-testable in Node with a
// mocked global fetch (see scripts/checkOutreachSend.mjs) - the same
// pattern src/prospecting/sourceAdapters/serperSearch.js already uses.
//
// Normalized result shape (shared with emailProvider.js, see providers/
// index.js): { ok, provider, providerMessageId, status, errorCode,
// errorMessage }. Business logic (sendPipeline.js) never depends on the
// Meta Graph API's own response shape beyond this file.
// ---------------------------------------------------------------------------

const GRAPH_API_VERSION = 'v21.0'
const DEFAULT_TIMEOUT_MS = 15000
const PROVIDER_NAME = 'whatsapp_cloud_api'

export async function sendWhatsApp({ accessToken, phoneNumberId, recipient, message, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      provider: PROVIDER_NAME,
      providerMessageId: null,
      status: 'failed',
      errorCode: 'credentials_missing',
      errorMessage: 'WhatsApp access token / phone number id is not configured.',
    }
  }
  if (!recipient) {
    return { ok: false, provider: PROVIDER_NAME, providerMessageId: null, status: 'failed', errorCode: 'recipient_missing', errorMessage: 'No recipient number provided.' }
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: message, preview_url: false },
      }),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        ok: false,
        provider: PROVIDER_NAME,
        providerMessageId: null,
        status: 'failed',
        errorCode: body?.error?.code != null ? String(body.error.code) : String(response.status),
        errorMessage: body?.error?.message || `HTTP ${response.status}`,
      }
    }

    return {
      ok: true,
      provider: PROVIDER_NAME,
      providerMessageId: body?.messages?.[0]?.id || null,
      status: 'sent',
      errorCode: null,
      errorMessage: null,
    }
  } catch (err) {
    const isTimeout = err?.name === 'AbortError'
    return {
      ok: false,
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
