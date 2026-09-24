// ---------------------------------------------------------------------------
// Bale (بله) provider adapters. Same shape and rules as whatsappProvider.js:
// credentials are passed in by the Edge Function (never read here), and the
// result is normalized to { ok, provider, providerMessageId, status,
// errorCode, errorMessage }.
//
// Two documented Bale products, with different recipient identifiers
// (https://docs.bale.ai, https://docs.bale.ai/safir, checked 2026-09-24):
//
// 1. Safir (سفیر) - business messaging to a PHONE NUMBER.
//    POST https://safir.bale.ai/api/v3/send_message, header api-access-key,
//    body { request_id, bot_id, phone_number: "98912...", message_data:
//    { message: { text } } }. Needs a Bale business account, a bot created
//    in the business panel, an API access key and credit. The number must
//    belong to a Bale user - otherwise error_data code 17 ("user does not
//    have a Bale account"). request_id makes a repeated request a no-op.
//    Response { message_id, error_data }. No delivery-status webhook is
//    documented, so a Safir send is "sent", never "delivered".
//
// 2. Bot API - POST https://tapi.bale.ai/bot<token>/sendMessage
//    { chat_id, text }. chat_id is a conversation id the bot only learns
//    after the person starts a chat with it - a phone number is not one.
//    Telegram-style response { ok, result: { message_id }, description }.
// ---------------------------------------------------------------------------

const SAFIR_URL = 'https://safir.bale.ai/api/v3/send_message'
const BOT_API_BASE = 'https://tapi.bale.ai'
const DEFAULT_TIMEOUT_MS = 15000

const SAFIR_ERRORS = {
  2: 'internal_error',
  3: 'rate_limited',
  4: 'invalid_request',
  8: 'invalid_phone_number',
  17: 'no_bale_account',
  20: 'insufficient_credit',
  21: 'contact_limit_reached',
}

function failure(provider, errorCode, errorMessage) {
  return { ok: false, provider, providerMessageId: null, status: 'failed', errorCode, errorMessage }
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal })
    return { response, body: await response.json().catch(() => null) }
  } finally {
    clearTimeout(timer)
  }
}

// "+989121234567" -> "989121234567" (Safir rejects any extra character).
export function safirPhoneNumber(e164) {
  const digits = String(e164 || '').replace(/\D/g, '')
  return /^989\d{9}$/.test(digits) ? digits : null
}

export async function sendBaleSafir({ apiKey, botId, phoneNumber, text, requestId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const provider = 'bale_safir'
  if (!apiKey || !botId) return failure(provider, 'credentials_missing', 'Bale Safir API key / bot id is not configured.')
  const phone = safirPhoneNumber(phoneNumber)
  if (!phone) return failure(provider, 'invalid_phone_number', 'Recipient is not an Iranian mobile number.')
  try {
    const { response, body } = await postJson(
      SAFIR_URL,
      { 'api-access-key': apiKey },
      { request_id: requestId, bot_id: Number(botId), phone_number: phone, message_data: { message: { text } } },
      timeoutMs,
    )
    const error = Array.isArray(body?.error_data) ? body.error_data[0] : null
    if (!response.ok || error || !body?.message_id) {
      const code = error?.code != null ? SAFIR_ERRORS[error.code] || `safir_${error.code}` : String(response.status)
      return failure(provider, code, error?.description || `HTTP ${response.status}`)
    }
    return { ok: true, provider, providerMessageId: String(body.message_id), status: 'sent', errorCode: null, errorMessage: null }
  } catch (err) {
    const timeout = err?.name === 'AbortError'
    return failure(provider, timeout ? 'timeout' : 'network_error', timeout ? `Request timed out after ${timeoutMs}ms` : err?.message || 'network error')
  }
}

export async function sendBaleBot({ token, chatId, text, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const provider = 'bale_bot'
  if (!token) return failure(provider, 'credentials_missing', 'Bale bot token is not configured.')
  if (!chatId) return failure(provider, 'recipient_missing', 'No Bale chat id.')
  try {
    const { response, body } = await postJson(`${BOT_API_BASE}/bot${token}/sendMessage`, {}, { chat_id: chatId, text }, timeoutMs)
    if (!response.ok || body?.ok !== true) {
      return failure(provider, body?.error_code != null ? String(body.error_code) : String(response.status), body?.description || `HTTP ${response.status}`)
    }
    return { ok: true, provider, providerMessageId: body.result?.message_id != null ? String(body.result.message_id) : null, status: 'sent', errorCode: null, errorMessage: null }
  } catch (err) {
    const timeout = err?.name === 'AbortError'
    return failure(provider, timeout ? 'timeout' : 'network_error', timeout ? `Request timed out after ${timeoutMs}ms` : err?.message || 'network error')
  }
}
