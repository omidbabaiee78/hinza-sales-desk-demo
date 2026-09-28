// Initial-contact workflow for registered leads (email + WhatsApp + Bale) -
// regression checks. Node's built-in assert, run with
// `npm run check:channels`. Every provider is a mock - nothing here can
// reach WhatsApp, Bale, Resend or a real customer.

import assert from 'node:assert/strict'
import { detectContactPoints, leadOrigin, normalizeMobile } from '../src/outreach/contactPoints.js'
import { buildChannelOutreachState, channelProviderReadiness, summarizeChannelOutreach } from '../src/outreach/channelOutreach.js'
import { runChannelOutreachCycle, runWhatsAppTestSend } from '../src/outreach/channelOutreachPipeline.js'
import { buildEmailOutreachState } from '../src/outreach/autoEmail.js'
import { claimChannelSend, channelOutcome } from '../src/outreach/channelClaims.js'
import { attemptSend } from '../src/outreach/sendPipeline.js'
import { channelTestMode } from '../src/outreach/sendGate.js'
import { handleWhatsAppWebhook, isOptOutMessage, signMetaPayload, verifyMetaSignature, verifySubscription } from '../src/outreach/whatsappWebhook.js'
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
function makeClient({ config = settings(), leads = [], messages = [], replies = [], recipients = [], candidates = [], attempts = [], suggestions = [] } = {}) {
  const tables = {
    automation_settings: [config],
    sales_leads: leads,
    channel_outreach_messages: messages,
    channel_outreach_events: [],
    channel_outreach_runs: [],
    inbound_replies: replies,
    email_outreach_recipients: recipients,
    prospect_candidates: candidates,
    outreach_attempts: attempts,
    outreach_send_claims: [],
    prospect_outreach_suggestions: suggestions,
    lead_activities: [],
    whatsapp_provider_events: [],
  }
  let nextId = 1
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const clone = (x) => structuredClone(x)
  const matches = (row, filters) => filters.every(([f, v, op]) => (op === 'in' ? v.includes(row[f]) : row[f] === v))

  function select(table, columns = '*') {
    const filters = []
    const joinLead = String(columns).includes('sales_leads(')
    const rows = () =>
      tables[table]
        .filter((r) => matches(r, filters))
        .map(clone)
        .map((r) => (joinLead ? { ...r, sales_leads: clone(tables.sales_leads.find((l) => l.id === r.lead_id) || null) } : r))
    const chain = {
      eq: (f, v) => (filters.push([f, v]), chain),
      in: (f, v) => (filters.push([f, v, 'in']), chain),
      single: async () => {
        await tick()
        const r = rows()
        return r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'not found' } }
      },
      maybeSingle: async () => (await tick(), { data: rows()[0] || null, error: null }),
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
      for (const r of Array.isArray(payload) ? payload : [payload]) {
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
      select: () => ({
        single: () => run().then(({ data }) => (data[0] ? { data: data[0], error: null } : { data: null, error: { message: 'not found' } })),
        then: (res, rej) => run().then(res, rej),
      }),
      then: (res, rej) => run().then(res, rej),
    }
    return chain
  }
  // claim_channel_send / claim_email_outreach_recipient, same rules and
  // order as phase37_whatsapp_outreach.sql, serialized by one lock.
  // clock() is the database's now() (tests move it to cross the 24h gap).
  let claimLock = Promise.resolve()
  const CLAIMED = ['sending', 'sent', 'delivered', 'uncertain']
  const HOUR = 3600 * 1000
  const tehranDay = (iso) => new Date(new Date(iso).getTime() + 3.5 * HOUR).toISOString().slice(0, 10)
  function claimChannel(a) {
    const s = tables.automation_settings[0]
    const nowMs = client.clock().getTime()
    const out = (result, row, extra = {}) => ({ result, id: row?.id || null, ...extra })
    const row = tables.channel_outreach_messages.find((m) => m.channel === a.p_channel && m.normalized_destination === a.p_destination)
    if (row && row.lead_id && row.lead_id !== a.p_lead_id) return out('duplicate', row)
    if (row && row.status === 'opted_out') return out('opted_out', row)
    if (row && !['queued', 'waiting_provider'].includes(row.status) && !(row.status === 'failed' && a.p_source === 'manual')) return out('duplicate', row)
    if (tables.channel_outreach_messages.some((m) => m.channel === a.p_channel && m.lead_id === a.p_lead_id && m.normalized_destination !== a.p_destination && CLAIMED.includes(m.status))) return out('duplicate', row)
    const lead = tables.sales_leads.find((l) => l.id === a.p_lead_id)
    if (!lead) return out('no_lead', row)
    if (lead.do_not_contact || tables.inbound_replies.some((r) => r.lead_id === lead.id && (r.final_intent === 'do_not_contact' || r.predicted_intent === 'do_not_contact'))) return out('opted_out', row)
    if (['converted', 'lost'].includes(lead.status)) return out('closed', row)
    const gap = Math.max(s.channel_first_touch_gap_hours ?? 24, 24)
    const cap = a.p_channel === 'whatsapp' ? Math.min(s.channel_daily_cap ?? 20, 20) : (s.channel_daily_cap ?? 20)
    const emailTimes = [
      ...tables.email_outreach_recipients.filter((r) => r.lead_id === lead.id && ['claimed', 'sent', 'uncertain'].includes(r.status)).map((r) => r.claimed_at),
      ...tables.outreach_attempts.filter((t) => t.lead_id === lead.id && t.channel === 'email' && t.purpose === 'provider_send' && ['prepared', 'sent'].includes(t.status) && !t.test_mode).map((t) => t.created_at),
    ].filter(Boolean).map((t) => new Date(t).getTime())
    if (emailTimes.length && Math.min(...emailTimes) > nowMs - gap * HOUR) return out('gap', row, { until: new Date(Math.min(...emailTimes) + gap * HOUR).toISOString() })
    const today = tables.channel_outreach_messages.filter((m) => m.channel === a.p_channel && CLAIMED.includes(m.status) && m.claimed_at && tehranDay(m.claimed_at) === tehranDay(client.clock().toISOString())).length
    if (today >= cap) return out('cap_reached', row)
    const nowIso = client.clock().toISOString()
    let target = row
    if (!target) {
      target = stamp('channel_outreach_messages', { channel: a.p_channel, normalized_destination: a.p_destination, destination_kind: a.p_destination_kind, lead_id: a.p_lead_id, contact_source: 'manual_send', status: 'sending', queued_at: nowIso, claimed_at: nowIso, claim_source: a.p_source, suggestion_id: a.p_suggestion_id })
      tables.channel_outreach_messages.push(target)
    } else Object.assign(target, { status: 'sending', claimed_at: nowIso, claim_source: a.p_source, suggestion_id: a.p_suggestion_id ?? target.suggestion_id })
    tables.channel_outreach_events.push(stamp('channel_outreach_events', { message_id: target.id, lead_id: a.p_lead_id, channel: a.p_channel, event: 'claimed', detail: { source: a.p_source } }))
    return out('claimed', target)
  }
  function claimEmail(a) {
    const s = tables.automation_settings[0]
    const email = a.p_email.trim().toLowerCase()
    if (tables.email_outreach_recipients.some((r) => r.normalized_email === email)) return 'duplicate'
    const gap = Math.max(s.channel_first_touch_gap_hours ?? 24, 24)
    const since = client.clock().getTime() - gap * HOUR
    if (a.p_lead_id && tables.channel_outreach_messages.some((m) => m.lead_id === a.p_lead_id && m.channel === 'whatsapp' && CLAIMED.includes(m.status) && new Date(m.claimed_at).getTime() > since)) return 'gap'
    tables.email_outreach_recipients.push(stamp('email_outreach_recipients', { normalized_email: email, lead_id: a.p_lead_id, suggestion_id: a.p_suggestion_id, status: 'claimed', claimed_at: client.clock().toISOString() }))
    return 'claimed'
  }
  async function rpc(name, args) {
    const release = claimLock
    let done
    claimLock = new Promise((r) => (done = r))
    await release
    try {
      await tick()
      if (name === 'claim_channel_send') return { data: claimChannel(args), error: null }
      if (name === 'claim_email_outreach_recipient') return { data: claimEmail(args), error: null }
      throw new Error(`unexpected rpc ${name}`)
    } finally {
      done()
    }
  }
  const client = {
    tables,
    rpc,
    clock: () => new Date(),
    from: (table) => ({
      select: (columns) => select(table, columns),
      insert: (p) => insert(table, p),
      upsert: (p, o) => upsert(table, p, o),
      update: (p) => update(table, p),
    }),
  }
  return client
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

// --- Phase 37: WhatsApp rules ---------------------------------------------------

const hoursAgo = (h, from = noon) => new Date(from.getTime() - h * 3600 * 1000).toISOString()
const WA_LIVE = { whatsapp_provider_enabled: true, whatsapp_test_mode: false }
const waRows = (client) => client.tables.channel_outreach_messages.filter((r) => r.channel === 'whatsapp')
const queuedRow = (l, i, status = 'queued') => ({ id: `q-${l.id}-${i}`, channel: 'whatsapp', normalized_destination: normalizeMobile(l.mobile), destination_kind: 'mobile', lead_id: l.id, status, queued_at: hoursAgo(72) })

await check('whatsapp: at most 20 real messages per day, even when channel_daily_cap is higher', async () => {
  const leads = Array.from({ length: 30 }, (_, i) => manualLead({ mobile: `091211130${String(i).padStart(2, '0')}` }))
  const client = makeClient({ config: settings({ ...WA_LIVE, channel_daily_cap: 50, channel_max_per_run: 50 }), leads })
  client.clock = () => noon
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  const report = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 20)
  assert.equal(waRows(client).filter((r) => r.status === 'sent').length, 20)
  assert.equal(waRows(client).filter((r) => r.status === 'queued').length, 10, 'the rest wait for tomorrow')
  assert.match(report.notSending, /سقف روزانه/)
})

await check('whatsapp: existing queued rows are never bulk-sent - test mode holds all of them, live mode is bounded by per-run limit and the 20/day cap', async () => {
  const leads = Array.from({ length: 40 }, (_, i) => manualLead({ mobile: `091211140${String(i).padStart(2, '0')}` }))
  const messages = leads.map((l, i) => queuedRow(l, i, 'waiting_provider'))
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true, whatsapp_test_mode: true }), leads, messages })
  client.clock = () => noon
  const { calls, providers } = mockProviders()
  const held = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 0, 'WhatsApp test mode: not one queued row is sent')
  assert.match(held.notSending, /حالت آزمایشی/)
  assert.deepEqual(held.testModeChannels, ['whatsapp'])
  client.tables.automation_settings[0].whatsapp_test_mode = false
  const first = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(first.sent, 5, 'one run sends at most channel_max_per_run')
  for (let i = 0; i < 10; i += 1) await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 20, 'never more than 20 in a day, however many runs')
})

await check('whatsapp: test mode is per channel - WhatsApp test mode does not stop email, and email test mode does not decide WhatsApp', async () => {
  assert.equal(channelTestMode(settings({ whatsapp_test_mode: true, provider_test_mode: false }), 'email'), false, 'email stays live')
  assert.equal(channelTestMode(settings({ whatsapp_test_mode: true, provider_test_mode: false }), 'whatsapp'), true)
  assert.equal(channelTestMode(settings({ whatsapp_test_mode: false, provider_test_mode: true }), 'whatsapp'), false)
  assert.equal(channelTestMode(settings({ provider_test_mode: true }), 'whatsapp'), true, 'before the migration WhatsApp follows the shared flag')
  assert.equal(channelTestMode({}, 'whatsapp'), true, 'unknown -> test mode')
  // Bale (no own flag) still sends while WhatsApp is held in test mode.
  const client = makeClient({ config: settings({ whatsapp_provider_enabled: true, whatsapp_test_mode: true, bale_provider_enabled: true }), leads: [manualLead({ mobile: '09121115001', bale_chat_id: '99' })] })
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: { ...WHATSAPP_READY, bale: { botToken: 'bt' } }, now: noon })
  assert.equal(calls.whatsapp.length, 0)
  assert.equal(calls.baleBot.length, 1)
})

await check('whatsapp: a lead emailed more than 24h ago still gets its WhatsApp introduction', async () => {
  const l = manualLead({ mobile: '09121116001', email: 'a@lead.ir', last_contact_at: hoursAgo(30) })
  const client = makeClient({
    config: settings(WA_LIVE),
    leads: [l],
    recipients: [{ lead_id: l.id, normalized_email: 'a@lead.ir', status: 'sent', claimed_at: hoursAgo(30) }],
    attempts: [{ lead_id: l.id, channel: 'email', purpose: 'provider_send', status: 'sent', test_mode: false, created_at: hoursAgo(30) }],
  })
  client.clock = () => noon
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.deepEqual(calls.whatsapp.map((c) => c.recipient), ['+989121116001'])
  assert.equal(client.tables.lead_activities.filter((a) => a.activity_type === 'whatsapp').length, 1, 'logged on the lead timeline')
  assert.equal(client.tables.sales_leads[0].last_contact_at, hoursAgo(30), 'a WhatsApp intro does not stamp last_contact_at')
})

await check('whatsapp: minimum 24h after the first email - an already-queued row waits, then goes out once the gap has passed', async () => {
  const l = manualLead({ mobile: '09121117001', email: 'b@lead.ir' })
  const client = makeClient({
    config: settings(WA_LIVE),
    leads: [l],
    messages: [queuedRow(l, 0)],
    recipients: [{ lead_id: l.id, normalized_email: 'b@lead.ir', status: 'sent', claimed_at: hoursAgo(2) }],
  })
  client.clock = () => noon
  const { calls, providers } = mockProviders()
  const report = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 0)
  assert.equal(report.deferred, 1)
  assert.equal(waRows(client)[0].status, 'queued', 'the queued row is kept, not dropped')
  const tomorrow = new Date(noon.getTime() + 23 * 3600 * 1000)
  client.clock = () => tomorrow
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: tomorrow })
  assert.equal(calls.whatsapp.length, 1, '25h after the first email')
  // The other direction: a fresh WhatsApp intro holds the lead's first email.
  const m = manualLead({ mobile: '09121117002', email: 'c@lead.ir' })
  client.tables.sales_leads.push(m)
  client.tables.channel_outreach_messages.push({ ...queuedRow(m, 1), status: 'sent', claimed_at: tomorrow.toISOString() })
  const { data } = await client.rpc('claim_email_outreach_recipient', { p_email: 'c@lead.ir', p_lead_id: m.id, p_suggestion_id: null })
  assert.equal(data, 'gap')
})

await check('whatsapp: the manual and automatic paths share one claim - duplicates, concurrency, do_not_contact, closed leads', async () => {
  const l = manualLead({ mobile: '09121118001' })
  const dnc = manualLead({ mobile: '09121118002', do_not_contact: true })
  const lost = manualLead({ mobile: '09121118003', status: 'lost' })
  const client = makeClient({ config: settings(WA_LIVE), leads: [l, dnc, lost] })
  const args = (lead, source) => ({ channel: 'whatsapp', destination: normalizeMobile(lead.mobile), destinationKind: 'mobile', leadId: lead.id, source })
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => claimChannelSend(client, args(l, i % 2 ? 'manual' : 'auto'))))
  assert.equal(results.filter((r) => r.result === 'claimed').length, 1, 'five concurrent claims, one winner')
  assert.equal(waRows(client).filter((r) => r.lead_id === l.id).length, 1, 'the manual claim created the one row the runner also uses')
  // The runner now sees the destination as taken and never calls the provider for it.
  const { calls, providers } = mockProviders()
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.ok(!calls.whatsapp.some((c) => c.recipient === normalizeMobile(l.mobile)))
  assert.equal((await claimChannelSend(client, args(l, 'manual'))).result, 'duplicate')
  assert.equal((await claimChannelSend(client, { ...args(l, 'manual'), destination: '+989121118999' })).result, 'duplicate', 'one intro per lead, whatever its number')
  assert.equal((await claimChannelSend(client, args(dnc, 'manual'))).result, 'opted_out')
  assert.equal((await claimChannelSend(client, args(lost, 'manual'))).result, 'closed')
  assert.equal(calls.whatsapp.length, 0)
})

await check('whatsapp: a failed provider request is recorded as failed (or uncertain), never retried, never delivered', async () => {
  const [a, b] = [manualLead({ mobile: '09121119001' }), manualLead({ mobile: '09121119002' })]
  const client = makeClient({ config: settings(WA_LIVE), leads: [a, b] })
  client.clock = () => noon
  const { calls, providers } = mockProviders({
    whatsapp: async ({ recipient }) =>
      recipient === '+989121119001'
        ? { ok: false, provider: 'whatsapp_cloud_api', status: 'failed', outcome: 'rejected', errorCode: '132001', errorMessage: 'Template name does not exist' }
        : { ok: false, provider: 'whatsapp_cloud_api', status: 'uncertain', outcome: 'unknown', errorCode: 'http_500' },
  })
  const report = await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  const rowA = waRows(client).find((r) => r.lead_id === a.id)
  const rowB = waRows(client).find((r) => r.lead_id === b.id)
  assert.equal(rowA.status, 'failed')
  assert.equal(rowA.error_code, '132001')
  assert.equal(rowA.provider_status, 'rejected')
  assert.equal(rowB.status, 'uncertain')
  assert.equal(report.failed + report.uncertain, 2)
  assert.ok(client.tables.channel_outreach_events.some((e) => e.message_id === rowA.id && e.event === 'failed'))
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  assert.equal(calls.whatsapp.length, 2, 'neither is retried automatically')
  assert.equal(channelOutcome({ ok: true, status: 'sent' }), 'accepted')
  await withFetch(
    () => json({ messages: [] }),
    async () => {
      const r = await sendWhatsAppTemplate({ accessToken: 'a', phoneNumberId: 'p', recipient: '+989121112233', templateName: 'hinza_intro' })
      assert.equal(channelOutcome(r), 'unknown', '2xx without a message id is not "accepted"')
    },
  )
  await withFetch(
    () => json({ error: { message: 'bad param' } }, 400),
    async () => assert.equal(channelOutcome(await sendWhatsAppTemplate({ accessToken: 'a', phoneNumberId: 'p', recipient: '+989121112233', templateName: 'x' })), 'rejected'),
  )
  await withFetch(
    () => json({ error: { message: 'internal' } }, 500),
    async () => assert.equal(channelOutcome(await sendWhatsAppTemplate({ accessToken: 'a', phoneNumberId: 'p', recipient: '+989121112233', templateName: 'x' })), 'unknown', 'a 5xx may have gone out - uncertain, never retried'),
  )
})

// --- Phase 37: WhatsApp webhook ---------------------------------------------------

const statusPayload = (id, status, extra = {}) => ({ entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id, status, timestamp: '1790000000', recipient_id: '989121112233', ...extra }] } }] }] })
const messagePayload = (id, from, body) => ({ entry: [{ changes: [{ field: 'messages', value: { messages: [{ id, from, timestamp: '1790000000', type: 'text', text: { body } }] } }] }] })

await check('webhook: only a provider status makes a message delivered; statuses never move backwards; retries are no-ops', async () => {
  const l = manualLead({ mobile: '09121112233' })
  const client = makeClient({ config: settings(WA_LIVE), leads: [l] })
  client.clock = () => noon
  const { providers } = mockProviders({ whatsapp: async () => ({ ok: true, provider: 'whatsapp_cloud_api', providerMessageId: 'wamid.A', status: 'sent', outcome: 'accepted' }) })
  await runChannelOutreachCycle(client, { providers, credentials: WHATSAPP_READY, now: noon })
  const row = () => waRows(client)[0]
  assert.equal(row().status, 'sent')
  assert.equal(row().provider_status, 'accepted', 'API acceptance is only "accepted"')
  assert.equal(row().delivered_at ?? null, null)
  await handleWhatsAppWebhook(client, statusPayload('wamid.A', 'sent'))
  assert.equal(row().provider_status, 'sent')
  await handleWhatsAppWebhook(client, statusPayload('wamid.A', 'delivered'))
  assert.equal(row().status, 'delivered')
  assert.ok(row().delivered_at)
  const retry = await handleWhatsAppWebhook(client, statusPayload('wamid.A', 'delivered'))
  assert.equal(retry.duplicates, 1)
  await handleWhatsAppWebhook(client, statusPayload('wamid.A', 'sent'))
  assert.equal(row().status, 'delivered', 'a late "sent" does not undo delivery')
  const ev = client.tables.whatsapp_provider_events
  assert.equal(ev.length, 2, 'sent + delivered, each once')
  assert.ok(ev.every((e) => !String(e.number_masked).includes('1112233')), 'numbers are stored masked')
})

await check('webhook: a failed status marks the message failed with the provider error', async () => {
  const l = manualLead({ mobile: '09121112244' })
  const client = makeClient({ config: settings(WA_LIVE), leads: [l], messages: [{ ...queuedRow(l, 0), status: 'sent', provider_status: 'accepted', provider_message_id: 'wamid.F' }] })
  await handleWhatsAppWebhook(client, statusPayload('wamid.F', 'failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }))
  const row = waRows(client)[0]
  assert.equal(row.status, 'failed')
  assert.equal(row.error_code, '131026')
  assert.equal(row.provider_status, 'failed')
})

await check('webhook: «لغو» / توقف / STOP / unsubscribe set do_not_contact through the reply pipeline and withdraw queued intros', async () => {
  for (const word of ['لغو', 'توقف', 'STOP', 'unsubscribe', 'لطفا دیگر پیام ندهید']) assert.equal(isOptOutMessage(word), true, word)
  for (const word of ['سلام، قیمت را بفرستید', 'ممنون']) assert.equal(isOptOutMessage(word), false, word)
  const l = manualLead({ mobile: '09121112255' })
  const client = makeClient({ config: settings(WA_LIVE), leads: [l], messages: [queuedRow(l, 0)] })
  const r = await handleWhatsAppWebhook(client, messagePayload('wamid.IN1', '989121112255', 'لغو'))
  assert.equal(r.optOuts, 1)
  assert.equal(client.tables.sales_leads[0].do_not_contact, true, 'the existing CRM opt-out flag')
  assert.equal(client.tables.inbound_replies.length, 1)
  assert.equal(client.tables.inbound_replies[0].final_intent, 'do_not_contact')
  assert.equal(waRows(client)[0].status, 'opted_out')
  assert.equal((await handleWhatsAppWebhook(client, messagePayload('wamid.IN1', '989121112255', 'لغو'))).duplicates, 1)
  assert.equal(client.tables.inbound_replies.length, 1, 'a retried delivery is not stored twice')
  const e = client.tables.whatsapp_provider_events.find((x) => x.kind === 'message')
  assert.equal(e.applied, 'opted_out')
  assert.equal(e.raw_payload, undefined, 'no raw payload or message text is kept in the event log')
  // An ordinary reply goes to the inbox through the usual rules - not an opt-out.
  const m = manualLead({ mobile: '09121112266' })
  client.tables.sales_leads.push(m)
  await handleWhatsAppWebhook(client, messagePayload('wamid.IN2', '989121112266', 'سلام، قیمت را بفرستید'))
  assert.equal(client.tables.sales_leads[1].do_not_contact, false)
  assert.notEqual(client.tables.inbound_replies[1].final_intent, 'do_not_contact')
})

await check('webhook: Meta signature and subscription handshake are verified', async () => {
  const body = JSON.stringify(statusPayload('wamid.X', 'sent'))
  const signature = await signMetaPayload({ appSecret: 's3cret', body })
  assert.deepEqual(await verifyMetaSignature({ appSecret: 's3cret', body, signature }), { ok: true })
  assert.equal((await verifyMetaSignature({ appSecret: 's3cret', body: body + ' ', signature })).ok, false)
  assert.equal((await verifyMetaSignature({ appSecret: 'other', body, signature })).ok, false)
  assert.equal((await verifyMetaSignature({ appSecret: 's3cret', body, signature: null })).ok, false)
  assert.equal(verifySubscription({ mode: 'subscribe', token: 'vt', challenge: '42', verifyToken: 'vt' }), '42')
  assert.equal(verifySubscription({ mode: 'subscribe', token: 'nope', challenge: '42', verifyToken: 'vt' }), null)
  assert.equal(verifySubscription({ mode: 'subscribe', token: '', challenge: '42', verifyToken: '' }), null)
})

await check('test send: one template message to the configured test number only - no lead, no queue', async () => {
  const l = manualLead({ mobile: '09121112277' })
  const client = makeClient({ config: settings({ whatsapp_test_mode: true }), leads: [l], messages: [queuedRow(l, 0, 'waiting_provider')] })
  const { calls, providers } = mockProviders()
  const missing = await runWhatsAppTestSend(client, { credentials: WHATSAPP_READY, providers, testRecipient: null })
  assert.deepEqual(missing.missing, ['test_recipient_missing'])
  assert.equal(calls.whatsapp.length, 0)
  const r = await runWhatsAppTestSend(client, { credentials: WHATSAPP_READY, providers, testRecipient: '09350000000' })
  assert.equal(r.outcome, 'accepted')
  assert.deepEqual(calls.whatsapp.map((c) => c.recipient), ['+989350000000'])
  assert.equal(waRows(client)[0].status, 'waiting_provider', 'the queue is untouched')
  assert.equal(client.tables.channel_outreach_runs.length, 2)
})

console.log(`\n${passed} check(s) passed.`)
