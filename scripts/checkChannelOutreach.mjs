// Initial-contact workflow for registered leads (email + WhatsApp + Bale) -
// regression checks. Node's built-in assert, run with
// `npm run check:channels`. Every provider is a mock - nothing here can
// reach WhatsApp, Bale, Resend or a real customer.

import assert from 'node:assert/strict'
import { detectContactPoints, leadOrigin, normalizeMobile } from '../src/outreach/contactPoints.js'
import { buildChannelOutreachState, channelProviderReadiness, summarizeChannelOutreach } from '../src/outreach/channelOutreach.js'
import { runChannelOutreachCycle } from '../src/outreach/channelOutreachPipeline.js'
import { buildEmailOutreachState } from '../src/outreach/autoEmail.js'
import { sendBaleSafir, sendBaleBot } from '../src/outreach/providers/baleProvider.js'
import { sendWhatsAppTemplate } from '../src/outreach/providers/whatsappProvider.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

const noon = new Date('2026-09-24T11:00:00+03:30')
const night = new Date('2026-09-24T22:00:00+03:30')

function settings(overrides = {}) {
  return {
    id: 1,
    contact_window_start: '09:00:00',
    contact_window_end: '18:00:00',
    outreach_enabled: true,
    email_provider_enabled: true,
    whatsapp_provider_enabled: false,
    bale_provider_enabled: false,
    provider_test_mode: false,
    auto_email_enabled: true,
    auto_email_daily_cap: 20,
    channel_daily_cap: 20,
    channel_max_per_run: 5,
    ...overrides,
  }
}

let seq = 0
function lead(overrides = {}) {
  seq += 1
  return {
    id: `lead-${seq}`,
    company_name: `شرکت نمونه ${seq}`,
    mobile: null,
    phone: null,
    email: null,
    status: 'new',
    do_not_contact: false,
    last_contact_at: null,
    tags: [],
    import_batch_id: null,
    created_at: new Date(Date.UTC(2026, 8, 1, 0, seq)).toISOString(),
    ...overrides,
  }
}

const manualLead = (o = {}) => lead({ ...o })
const uploadedLead = (o = {}) => lead({ tags: ['prospecting', 'منبع:آپلود دستی'], ...o })
const discoveredLead = (o = {}) => lead({ tags: ['prospecting', 'منبع:جستجوی وب (Serper / Google)'], ...o })

const WHATSAPP_READY = { whatsapp: { accessToken: 't', phoneNumberId: 'p', templateName: 'hinza_intro' } }
const BALE_SAFIR_READY = { bale: { safirApiKey: 'k', safirBotId: '123' } }

// In-memory Supabase: select/eq/in, insert, upsert(onConflict,
// ignoreDuplicates), conditional update with .in(), and the
// claim_channel_outreach_message RPC (same rules as the SQL). Every await
// yields, so concurrent runs genuinely interleave.
function makeClient({ config = settings(), leads = [], messages = [], replies = [], recipients = [], candidates = [] } = {}) {
  const tables = {
    automation_settings: [config],
    sales_leads: leads,
    channel_outreach_messages: messages,
    channel_outreach_events: [],
    channel_outreach_runs: [],
    inbound_replies: replies,
    email_outreach_recipients: recipients,
    prospect_candidates: candidates,
    outreach_attempts: [],
  }
  let nextId = 1
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const clone = (x) => structuredClone(x)
  const matches = (row, filters) => filters.every(([f, v, op]) => (op === 'in' ? v.includes(row[f]) : row[f] === v))

  function select(table) {
    const filters = []
    const rows = () => tables[table].filter((r) => matches(r, filters)).map(clone)
    const chain = {
      eq: (f, v) => (filters.push([f, v]), chain),
      in: (f, v) => (filters.push([f, v, 'in']), chain),
      single: async () => {
        await tick()
        const r = rows()
        return r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'not found' } }
      },
      then: (res, rej) => tick().then(() => ({ data: rows(), error: null })).then(res, rej),
    }
    return chain
  }
  function stamp(table, r) {
    return { id: `${table}-${nextId++}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...clone(r) }
  }
  function insert(table, payload) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => stamp(table, r))
    tables[table].push(...rows)
    const result = { data: rows.map(clone), error: null }
    return { select: () => ({ single: async () => (await tick(), { data: clone(rows[0]), error: null }), then: (res) => tick().then(() => res(result)) }), then: (res) => tick().then(() => res(result)) }
  }
  function upsert(table, payload, { onConflict, ignoreDuplicates }) {
    const keys = onConflict.split(',')
    const run = async () => {
      await tick()
      const inserted = []
      for (const r of payload) {
        const existing = tables[table].find((x) => keys.every((k) => x[k] === r[k]))
        if (existing) {
          if (!ignoreDuplicates) Object.assign(existing, r)
          continue
        }
        const row = stamp(table, r)
        tables[table].push(row)
        inserted.push(clone(row))
      }
      return { data: inserted, error: null }
    }
    return { select: () => ({ then: (res, rej) => run().then(res, rej) }) }
  }
  function update(table, patch) {
    const filters = []
    const run = async () => {
      await tick()
      const hit = tables[table].filter((r) => matches(r, filters))
      hit.forEach((r) => Object.assign(r, clone(patch)))
      return { data: hit.map(clone), error: null }
    }
    const chain = {
      eq: (f, v) => (filters.push([f, v]), chain),
      in: (f, v) => (filters.push([f, v, 'in']), chain),
      select: () => ({ then: (res, rej) => run().then(res, rej) }),
      then: (res, rej) => run().then(res, rej),
    }
    return chain
  }
  let claimLock = Promise.resolve()
  async function rpc(name, args) {
    assert.equal(name, 'claim_channel_outreach_message')
    const release = claimLock
    let done
    claimLock = new Promise((r) => (done = r))
    await release
    try {
      await tick()
      const row = tables.channel_outreach_messages.find((m) => m.id === args.p_id && m.status === 'queued')
      if (!row) return { data: 'not_queued', error: null }
      const cap = tables.automation_settings[0].channel_daily_cap ?? 20
      const today = tables.channel_outreach_messages.filter((m) => m.channel === row.channel && ['sending', 'sent', 'delivered', 'uncertain'].includes(m.status) && m.claimed_at).length
      if (today >= cap) return { data: 'cap_reached', error: null }
      row.status = 'sending'
      row.claimed_at = new Date().toISOString()
      return { data: 'claimed', error: null }
    } finally {
      done()
    }
  }
  return {
    tables,
    rpc,
    from: (table) => ({
      select: () => select(table),
      insert: (p) => insert(table, p),
      upsert: (p, o) => upsert(table, p, o),
      update: (p) => update(table, p),
    }),
  }
}

function mockProviders({ whatsapp, baleSafir, baleBot } = {}) {
  const calls = { whatsapp: [], baleSafir: [], baleBot: [] }
  const ok = (provider) => async () => ({ ok: true, provider, providerMessageId: `msg-${Math.random()}`, status: 'sent' })
  const wrap = (key, fn) => async (args) => {
    calls[key].push(args)
    await new Promise((r) => setImmediate(r))
    return fn(args)
  }
  return {
    calls,
    providers: {
      whatsapp: wrap('whatsapp', whatsapp || ok('whatsapp_cloud_api')),
      baleSafir: wrap('baleSafir', baleSafir || ok('bale_safir')),
      baleBot: wrap('baleBot', baleBot || ok('bale_bot')),
    },
  }
}

// --- Contact detection ------------------------------------------------------

await check('contacts: manual, promoted-upload and discovered leads are detected the same way, each with its source', () => {
  const m = detectContactPoints(manualLead({ email: 'Info@Acme.ir ', mobile: '۰۹۱۲۱۱۱۲۲۳۳' }))
  assert.equal(m.email.destination, 'info@acme.ir')
  assert.equal(m.email.source, 'manual')
  assert.equal(m.whatsapp.destination, '+989121112233', 'Persian digits normalize to the same E.164 number')
  const u = detectContactPoints(uploadedLead({ email: 'sales@b.ir' }))
  assert.equal(u.email.source, 'uploaded_list')
  const d = detectContactPoints(discoveredLead({ email: 'info@c.ir', email_source_url: 'https://c.ir/contact/' }))
  assert.equal(d.email.source, 'company_website')
  assert.equal(d.email.sourceDetail, 'https://c.ir/contact/')
  assert.equal(leadOrigin(lead({ import_batch_id: 'b1', source_row_number: 4 })).source, 'lead_import')
})

await check('contacts: a phone number alone is only an UNVERIFIED Bale candidate; a chat id is the verified recipient', () => {
  const byPhone = detectContactPoints(manualLead({ mobile: '09121112233' }))
  assert.equal(byPhone.bale.kind, 'mobile_unverified')
  assert.equal(byPhone.bale.verified, false)
  const byChat = detectContactPoints(manualLead({ mobile: '09121112233', bale_chat_id: '5551234' }))
  assert.equal(byChat.bale.kind, 'bale_chat_id')
  assert.equal(byChat.bale.verified, true)
  assert.equal(byChat.bale.destination, '5551234')
})

await check('contacts: a landline is not a WhatsApp/Bale destination; missing contact info gives none', () => {
  const p = detectContactPoints(manualLead({ phone: '02133334444' }))
  assert.equal(p.whatsapp, null)
  assert.equal(p.bale, null)
  assert.equal(p.email, null)
  assert.equal(normalizeMobile('+98 912 111 2233'), '+989121112233')
})

// --- Email: one source-independent workflow (existing pipeline) --------------

await check('email: manual, promoted-upload and discovered leads all enter the same email workflow; a shared address is emailed once', () => {
  const a = manualLead({ email: 'info@shared.ir' })
  const b = uploadedLead({ email: 'INFO@shared.ir' })
  const c = discoveredLead({ email: 'sales@other.ir' })
  const d = uploadedLead({ email: null })
  const entries = buildEmailOutreachState({ leads: [a, b, c, d] })
  const state = (l) => entries.find((e) => e.lead.id === l.id)
  assert.equal(state(a).state, 'ready')
  assert.equal(state(b).kind, 'duplicate_address', 'the same address from an upload is not emailed a second time')
  assert.equal(state(c).state, 'ready', 'a discovered lead is treated exactly like a manual one')
  assert.equal(state(d).kind, 'no_email')
})

// --- WhatsApp / Bale queue ----------------------------------------------------

await check('channels: with providers disabled, contacts are recorded as waiting for provider and nothing is sent', async () => {
  const leads = [manualLead({ mobile: '09121112233' }), uploadedLead({ mobile: '09121112244' }), discoveredLead({ mobile: '09121112255', email: 'x@y.ir' })]
  const client = makeClient({ leads })
  const { calls, providers } = mockProviders()
  const report = await runChannelOutreachCycle(client, { providers, credentials: {}, now: noon })
  assert.equal(report.sent, 0)
  assert.equal(calls.whatsapp.length + calls.baleSafir.length + calls.baleBot.length, 0, 'no provider is ever called')
  const rows = client.tables.channel_outreach_messages
  assert.equal(rows.length, 6, 'one WhatsApp + one Bale record per lead')
  assert.ok(rows.every((r) => r.status === 'waiting_provider'))
  assert.equal(rows.filter((r) => r.channel === 'bale').every((r) => r.destination_kind === 'mobile_unverified'), true)
  assert.deepEqual(report.readiness.whatsapp, ['provider_disabled', 'credentials_missing', 'template_missing'])
  const counts = summarizeChannelOutreach(buildChannelOutreachState({ leads, messages: rows }))
  assert.equal(counts.waitingProvider, 6)
  assert.equal(counts.whatsapp.sent, 0)
})

await check('channels: enabling the setting without credentials still sends nothing', async () => {
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true, bale_provider_enabled: true }), leads: [manualLead({ mobile: '09121112233' })] })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: {}, now: noon })
  assert.equal(calls.whatsapp.length + calls.baleSafir.length, 0)
  assert.ok(client.tables.channel_outreach_messages.every((r) => r.status === 'waiting_provider'))
})

await check('channels: once configured, waiting rows are queued and sent automatically inside the window - one per destination', async () => {
  const leads = [manualLead({ mobile: '09121112233' })]
  const client = makeClient({ leads })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: {}, now: noon })
  client.tables.automation_settings[0].whatsapp_provider_enabled = true
  const report = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(report.requeued, 1)
  assert.equal(report.sent, 1)
  assert.equal(calls.whatsapp.length, 1)
  assert.equal(calls.whatsapp[0].recipient, '+989121112233')
  const wa = client.tables.channel_outreach_messages.find((r) => r.channel === 'whatsapp')
  assert.equal(wa.status, 'sent')
  assert.ok(wa.provider_message_id)
  assert.equal(client.tables.channel_outreach_messages.find((r) => r.channel === 'bale').status, 'waiting_provider', 'Bale stays unconfigured')
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 1, 'never a second introduction to the same number')
  assert.ok(client.tables.channel_outreach_events.some((e) => e.event === 'sent'), 'history is recorded')
  assert.equal(client.tables.outreach_attempts.length, 0, 'email history is untouched')
})

await check('channels: the same mobile from a manual entry, a discovery and two uploads gets ONE message', async () => {
  const leads = [
    manualLead({ mobile: '0912 111 2233' }),
    discoveredLead({ mobile: '+989121112233' }),
    uploadedLead({ mobile: '۰۹۱۲۱۱۱۲۲۳۳' }),
    uploadedLead({ mobile: '9121112233' }),
  ]
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true }), leads })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 1)
  assert.equal(client.tables.channel_outreach_messages.filter((r) => r.channel === 'whatsapp').length, 1)
  const states = buildChannelOutreachState({ leads, messages: client.tables.channel_outreach_messages }).map((e) => e.channels.whatsapp.state)
  assert.deepEqual(states, ['sent', 'duplicate_destination', 'duplicate_destination', 'duplicate_destination'])
})

await check('channels: two concurrent runs register and send each destination exactly once', async () => {
  const leads = [manualLead({ mobile: '09121112233' }), discoveredLead({ mobile: '09121112244' }), uploadedLead({ mobile: '09121112233' })]
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true }), leads })
  const { calls, providers } = mockProviders()
  const [a, b] = await Promise.all([
    runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon }),
    runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon }),
  ])
  assert.equal(client.tables.channel_outreach_messages.filter((r) => r.channel === 'whatsapp').length, 2)
  assert.equal(calls.whatsapp.length, 2, 'two destinations, two messages, no matter how many runs')
  assert.equal(new Set(calls.whatsapp.map((c) => c.recipient)).size, 2)
  assert.equal(a.sent + b.sent, 2)
})

await check('channels: concurrent runs that both see the same QUEUED rows still send each one once (atomic claim)', async () => {
  const leads = [manualLead({ mobile: '09121112233' }), manualLead({ mobile: '09121112244' })]
  const messages = leads.map((l, i) => ({
    id: `pre-${i}`,
    channel: 'whatsapp',
    normalized_destination: normalizeMobile(l.mobile),
    destination_kind: 'mobile',
    lead_id: l.id,
    status: 'queued',
    queued_at: noon.toISOString(),
  }))
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true }), leads, messages })
  const { calls, providers } = mockProviders()
  await Promise.all([1, 2, 3].map(() => runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })))
  assert.equal(calls.whatsapp.length, 2)
  assert.deepEqual(client.tables.channel_outreach_messages.filter((r) => r.channel === 'whatsapp').map((r) => r.status), ['sent', 'sent'])
})

await check('channels: nothing is sent outside the contact window, in test mode, or with outreach disabled', async () => {
  for (const [config, now] of [
    [settings({ whatsapp_provider_enabled: true }), night],
    [settings({ whatsapp_provider_enabled: true, provider_test_mode: true }), noon],
    [settings({ whatsapp_provider_enabled: true, outreach_enabled: false }), noon],
  ]) {
    const client = makeClient({ config, leads: [manualLead({ mobile: '09121112233' })] })
    const { calls, providers } = mockProviders()
    const report = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now })
    assert.equal(calls.whatsapp.length, 0)
    assert.ok(report.notSending)
    assert.equal(client.tables.channel_outreach_messages.find((r) => r.channel === 'whatsapp').status, 'queued')
  }
})

await check('channels: the per-channel daily cap and per-run limit hold', async () => {
  const leads = Array.from({ length: 6 }, (_, i) => manualLead({ mobile: `0912111220${i}` }))
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true, channel_daily_cap: 3, channel_max_per_run: 2 }), leads })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 2, 'per-run limit')
  const report = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 3, 'daily cap')
  assert.match(report.notSending, /سقف روزانه/)
})

await check('channels: opted-out leads are never messaged, and a queued row is withdrawn when the lead opts out', async () => {
  const optedOut = manualLead({ mobile: '09121112233', do_not_contact: true })
  const later = manualLead({ mobile: '09121112244' })
  const client = makeClient({ leads: [optedOut, later] })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: {}, now: noon })
  assert.ok(client.tables.channel_outreach_messages.filter((r) => r.lead_id === optedOut.id).every((r) => r.status === 'opted_out'))
  client.tables.sales_leads.find((l) => l.id === later.id).do_not_contact = true
  client.tables.automation_settings[0].whatsapp_provider_enabled = true
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 0)
  assert.ok(client.tables.channel_outreach_messages.filter((r) => r.lead_id === later.id).every((r) => r.status === 'opted_out'))
})

await check('channels: a «لغو» reply or a reply of any kind stops introductions; the automatic email intro does not', async () => {
  const replied = manualLead({ mobile: '09121112233' })
  const emailed = manualLead({ mobile: '09121112244', email: 'a@b.ir', last_contact_at: noon.toISOString() })
  const contactedByHand = manualLead({ mobile: '09121112255', last_contact_at: noon.toISOString() })
  const client = makeClient({
    config: settings({ whatsapp_provider_enabled: true }),
    leads: [replied, emailed, contactedByHand],
    replies: [{ lead_id: replied.id, predicted_intent: 'interested', final_intent: null }],
    recipients: [{ lead_id: emailed.id, status: 'sent' }],
  })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.deepEqual(calls.whatsapp.map((c) => c.recipient), ['+989121112244'])
})

await check('channels: unpromoted candidate rows are never messaged - only registered leads', async () => {
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true }), candidates: [{ id: 'c1', status: 'manual_review', mobile: '09121112233', promoted_lead_id: null }] })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(client.tables.channel_outreach_messages.length, 0)
  assert.equal(calls.whatsapp.length, 0)
})

await check('channels: a provider rejection is failed; an exception is uncertain and never retried', async () => {
  const client = makeClient({ config: settings({ bale_provider_enabled: true, whatsapp_provider_enabled: true }), leads: [manualLead({ mobile: '09121112233' })] })
  const { calls, providers } = mockProviders({
    baleSafir: async () => ({ ok: false, provider: 'bale_safir', status: 'failed', errorCode: 'no_bale_account', errorMessage: 'User does not have a Bale account' }),
    whatsapp: async () => {
      throw new Error('socket hang up')
    },
  })
  await runChannelOutreachCycle(client, { providers, credentials: { ...WHATSAPP_READY, ...BALE_SAFIR_READY }, now: noon })
  const rows = client.tables.channel_outreach_messages
  assert.equal(rows.find((r) => r.channel === 'bale').status, 'failed')
  assert.equal(rows.find((r) => r.channel === 'bale').error_code, 'no_bale_account')
  assert.equal(rows.find((r) => r.channel === 'whatsapp').status, 'uncertain')
  await runChannelOutreachCycle(client, { providers, credentials: { ...WHATSAPP_READY, ...BALE_SAFIR_READY }, now: noon })
  assert.equal(calls.whatsapp.length, 1)
  assert.equal(calls.baleSafir.length, 1)
})

await check('channels: Bale uses the Bot API for a known chat id and Safir only for a phone number', async () => {
  const client = makeClient({
    config: settings({ bale_provider_enabled: true }),
    leads: [manualLead({ mobile: '09121112233', bale_chat_id: '777' }), discoveredLead({ mobile: '09121112244' })],
  })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: { bale: { botToken: 'bt' } }, now: noon })
  assert.deepEqual(calls.baleBot.map((c) => c.chatId), ['777'])
  assert.equal(calls.baleSafir.length, 0, 'no Safir credentials - the phone-number candidate waits')
  assert.equal(client.tables.channel_outreach_messages.find((r) => r.normalized_destination === '+989121112244' && r.channel === 'bale').status, 'waiting_provider')
})

await check('channels: provider readiness names every missing piece', () => {
  assert.deepEqual(channelProviderReadiness('whatsapp', 'mobile', settings({ whatsapp_provider_enabled: true }), { whatsapp: { accessToken: 'a', phoneNumberId: 'b' } }).reasons, ['template_missing'])
  assert.equal(channelProviderReadiness('bale', 'mobile_unverified', settings({ bale_provider_enabled: true }), BALE_SAFIR_READY).ready, true)
  assert.equal(channelProviderReadiness('bale', 'bale_chat_id', settings({ bale_provider_enabled: true }), BALE_SAFIR_READY).ready, false)
})

// --- Provider request shapes (mocked fetch) -----------------------------------

async function withFetch(responder, fn) {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) })
    return responder(url, options)
  }
  try {
    await fn(requests)
  } finally {
    globalThis.fetch = original
  }
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

await check('provider: Safir request matches the documented contract; error 17 means no Bale account', async () => {
  await withFetch(
    () => json({ message_id: null, error_data: [{ phone_number: '989121112233', code: 17, description: 'User does not have a Bale account' }] }),
    async (requests) => {
      const r = await sendBaleSafir({ apiKey: 'k', botId: '42', phoneNumber: '+989121112233', text: 'سلام', requestId: 'intro:1' })
      assert.equal(requests[0].url, 'https://safir.bale.ai/api/v3/send_message')
      assert.equal(requests[0].options.headers['api-access-key'], 'k')
      assert.deepEqual(requests[0].body, { request_id: 'intro:1', bot_id: 42, phone_number: '989121112233', message_data: { message: { text: 'سلام' } } })
      assert.equal(r.ok, false)
      assert.equal(r.errorCode, 'no_bale_account')
    },
  )
  await withFetch(
    () => json({ message_id: 'uuid-1', error_data: null }),
    async () => {
      const r = await sendBaleSafir({ apiKey: 'k', botId: '42', phoneNumber: '+989121112233', text: 'سلام', requestId: 'x' })
      assert.equal(r.ok, true)
      assert.equal(r.status, 'sent', 'Safir has no delivery callback - never "delivered"')
    },
  )
})

await check('provider: Bale Bot API posts chat_id + text; WhatsApp sends an approved template, not free text', async () => {
  await withFetch(
    () => json({ ok: true, result: { message_id: 9 } }),
    async (requests) => {
      const r = await sendBaleBot({ token: 'T', chatId: '777', text: 'سلام' })
      assert.equal(requests[0].url, 'https://tapi.bale.ai/botT/sendMessage')
      assert.deepEqual(requests[0].body, { chat_id: '777', text: 'سلام' })
      assert.equal(r.providerMessageId, '9')
    },
  )
  await withFetch(
    () => json({ messages: [{ id: 'wamid.1' }] }),
    async (requests) => {
      const r = await sendWhatsAppTemplate({ accessToken: 'a', phoneNumberId: 'p', recipient: '+989121112233', templateName: 'hinza_intro', bodyParameters: ['شرکت الف'] })
      assert.equal(requests[0].body.type, 'template')
      assert.equal(requests[0].body.to, '989121112233')
      assert.equal(requests[0].body.template.name, 'hinza_intro')
      assert.equal(requests[0].body.template.components[0].parameters[0].text, 'شرکت الف')
      assert.equal(r.status, 'sent')
    },
  )
  const noTemplate = await sendWhatsAppTemplate({ accessToken: 'a', phoneNumberId: 'p', recipient: '+989121112233' })
  assert.equal(noTemplate.errorCode, 'template_missing')
})

console.log(`\n${passed} check(s) passed.`)
