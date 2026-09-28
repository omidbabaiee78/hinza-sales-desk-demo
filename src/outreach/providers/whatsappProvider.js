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

// The three-state outcome of a non-2xx Graph API response: a 4xx is a
// definite rejection (bad number, template, token...) - EXCEPT 408/409/429,
// where Meta may still process the request - and a 5xx is unknown.
export function whatsappErrorOutcome(httpStatus) {
  if (httpStatus >= 400 && httpStatus < 500 && ![408, 409, 429].includes(httpStatus)) return 'rejected'
  return 'unknown'
}

// First (business-initiated) contact. WhatsApp Cloud API delivers free-form
// text only inside a 24-hour window opened by the customer's own message;
// a cold introduction must use a message TEMPLATE approved in Meta's
// WhatsApp Manager. `templateName`/`languageCode` name that approved
// template; `bodyParameters` fill its {{1}}, {{2}}... placeholders in order
// (must match the template, e.g. [companyName] or []).
export async function sendWhatsAppTemplate({ accessToken, phoneNumberId, recipient, templateName, languageCode = 'fa', bodyParameters = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const fail = (errorCode, errorMessage, outcome = 'rejected') => ({ ok: false, outcome, provider: PROVIDER_NAME, providerMessageId: null, status: 'failed', errorCode, errorMessage })
  if (!accessToken || !phoneNumberId) return fail('credentials_missing', 'WhatsApp access token / phone number id is not configured.')
  if (!templateName) return fail('template_missing', 'No approved WhatsApp message template is configured.')
  if (!recipient) return fail('recipient_missing', 'No recipient number provided.')

  const template = { name: templateName, language: { code: languageCode } }
  if (bodyParameters.length > 0) template.components = [{ type: 'body', parameters: bodyParameters.map((text) => ({ type: 'text', text: String(text) })) }]

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: String(recipient).replace(/^\+/, ''), type: 'template', template }),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      return fail(
        body?.error?.code != null ? String(body.error.code) : String(response.status),
        body?.error?.message || `HTTP ${response.status}`,
        whatsappErrorOutcome(response.status),
      )
    }
    const providerMessageId = body?.messages?.[0]?.id || null
    // Accepted by Meta - NOT delivered. sent/delivered/read/failed arrive
    // later on the whatsapp-webhook status callback. A 2xx without a message
    // id cannot be matched to those callbacks, so its outcome is unknown.
    if (!providerMessageId) return { ok: false, outcome: 'unknown', provider: PROVIDER_NAME, providerMessageId: null, status: 'uncertain', errorCode: 'missing_message_id', errorMessage: 'Meta accepted the request but returned no message id.' }
    return { ok: true, outcome: 'accepted', provider: PROVIDER_NAME, providerMessageId, status: 'sent', errorCode: null, errorMessage: null }
  } catch (err) {
    const isTimeout = err?.name === 'AbortError'
    return fail(isTimeout ? 'timeout' : 'network_error', isTimeout ? `Request timed out after ${timeoutMs}ms` : err?.message || 'Unknown network error', 'unknown')
  } finally {
    clearTimeout(timeoutHandle)
  }
}

// The approved intro template's {{1}}... values. paramSpec comes from the
// WHATSAPP_INTRO_TEMPLATE_PARAMS secret: 'company_name' fills {{1}} with
// the company name, '' sends a template without placeholders.
export function introTemplateParameters(paramSpec, lead) {
  return paramSpec === 'company_name' ? [lead?.company_name || 'شرکت شما'] : []
}

// What is stored as the message snapshot for a template send - the template
// and its values, since Meta renders the actual text.
export function describeTemplateSend({ templateName, languageCode = 'fa', bodyParameters = [] }) {
  return `[قالب واتساپ: ${templateName} (${languageCode})${bodyParameters.length ? ` - مقادیر: ${bodyParameters.join('، ')}` : ''}]`
}

// Registry entry (providers/index.js): the approved template when one is
// configured (required for a real first contact), otherwise free text
// (only reaches a number that messaged the business in the last 24h, e.g.
// the admin's own test number).
export function sendWhatsAppMessage(params) {
  return params.templateName ? sendWhatsAppTemplate(params) : sendWhatsApp(params)
}
