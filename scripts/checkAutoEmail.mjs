// Email outreach (automatic intro email) - regression checks. Node's
// built-in assert, run with `npm run check:auto-email`. Every provider call
// goes to a mocked fetch - nothing here can reach Resend or a real inbox.

import assert from 'node:assert/strict'
import { buildEmailOutreachState, composeAutoIntroEmail, nextCronRun, resolveAutoEmailLimit, summarizeEmailOutreach } from '../src/outreach/autoEmail.js'
import { runAutoEmailCycle } from '../src/outreach/autoEmailPipeline.js'
import { EMAIL_OPT_OUT_FOOTER, evaluateSendGate } from '../src/outreach/sendGate.js'
import { attemptSend } from '../src/outreach/sendPipeline.js'
import { applyResendEvent, signResendPayload, verifyResendSignature } from '../src/outreach/resendWebhook.js'
import { lookupCompanyEmail, pickCompanyEmail } from '../src/outreach/emailDiscovery.js'
import { tehranDateKey } from '../src/utils/leadFollowUp.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

const noon = new Date('2026-09-24T11:00:00+03:30')
const night = new Date('2026-09-24T22:00:00+03:30')
const credentials = { email: { apiKey: 'key', fromAddress: 'sales@hinzapolymer.com' } }

function settings(overrides = {}) {
  return {
    id: 1,
    contact_window_start: '09:00:00',
    contact_window_end: '18:00:00',
    outreach_cooldown_hours: 24,
    max_contact_attempts: 3,
    outreach_enabled: true,
    email_provider_enabled: true,
    whatsapp_provider_enabled: false,
    provider_test_mode: false,
    auto_email_enabled: true,
    auto_email_max_per_run: 10,
    auto_email_daily_cap: 20,
    ...overrides,
  }
}

let seq = 0
function lead(overrides = {}) {
  seq += 1
  return {
    id: `lead-${seq}`,
    company_name: `شرکت نمونه ${seq}`,
    contact_name: null,
    mobile: null,
    phone: null,
    email: `info@company${seq}.ir`,
    status: 'new',
    do_not_contact: false,
    preferred_channel: null,
    last_contact_at: null,
    tags: [],
    created_at: new Date(Date.UTC(2026, 8, 1, 0, seq)).toISOString(),
    ...overrides,
  }
}

// In-memory Supabase with the shapes the runner and attemptSend() use:
// eq-chains, in, joins on sales_leads, upsert(onConflict, ignoreDuplicates),
// update/delete with filters. Every await yields, so concurrent runs
// genuinely interleave.
function makeClient({ config = settings(), leads = [], suggestions = [], attempts = [], recipients = [], replies = [] } = {}) {
  const tables = {
    automation_settings: [config],
    sales_leads: leads,
    prospect_outreach_suggestions: suggestions,
    outreach_attempts: attempts,
    outreach_send_claims: [],
    email_outreach_recipients: recipients,
    email_outreach_runs: [],
    prospect_candidates: [],
    inbound_replies: replies,
    lead_activities: [],
  }
  const primaryKey = { email_outreach_recipients: 'normalized_email' }
  let nextId = 1
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const matches = (row, filters) => filters.every(([f, v, op]) => (op === 'in' ? v.includes(row[f]) : row[f] === v))
  const clone = (x) => structuredClone(x)

  function select(table, columns) {
    const filters = []
    const rows = () =>
      tables[table]
        .filter((r) => matches(r, filters))
        .map((r) => {
          const copy = clone(r)
          if (columns?.includes('sales_leads')) copy.sales_leads = clone(tables.sales_leads.find((l) => l.id === r.lead_id) || null)
          return copy
        })
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

  function insert(table, payload) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `${table}-${nextId++}`, created_at: new Date().toISOString(), ...clone(r) }))
    const key = primaryKey[table]
    if (key && rows.some((r) => tables[table].some((x) => x[key] === r[key]))) {
      const dup = { data: null, error: { code: '23505', message: 'duplicate key value' } }
      return { select: () => ({ single: async () => dup, then: (res) => res(dup) }), then: (res) => res(dup) }
    }
    tables[table].push(...rows)
    const result = { data: rows.map(clone), error: null }
    return { select: () => ({ single: async () => ({ data: clone(rows[0]), error: null }), then: (res) => res(result) }), then: (res) => res(result) }
  }

  function upsert(table, payload, { onConflict, ignoreDuplicates } = {}) {
    const run = async () => {
      await tick()
      const written = []
      for (const row of Array.isArray(payload) ? payload : [payload]) {
        const existing = tables[table].find((r) => r[onConflict] === row[onConflict])
        if (existing) {
          if (!ignoreDuplicates) Object.assign(existing, clone(row))
          continue
        }
        const created = { id: row.id || `${table}-${nextId++}`, created_at: new Date().toISOString(), ...clone(row) }
        if (table === 'prospect_outreach_suggestions' && !created.send_status) created.send_status = 'not_sent'
        tables[table].push(created)
        written.push(clone(created))
      }
      return { data: written, error: null }
    }
    return { select: () => ({ then: (res, rej) => run().then(res, rej) }), then: (res, rej) => run().then(res, rej) }
  }

  function mutate(table, apply) {
    const filters = []
    const run = async () => {
      await tick()
      const rows = tables[table].filter((r) => matches(r, filters))
      apply(rows)
      return { data: rows.map(clone), error: null }
    }
    const chain = {
      eq: (f, v) => (filters.push([f, v]), chain),
      select: () => ({ single: async () => ({ data: (await run()).data[0] || null, error: null }), then: (res, rej) => run().then(res, rej) }),
      then: (res, rej) => run().then(res, rej),
    }
    return chain
  }

  // Mirrors public.claim_email_outreach_recipient(): the whole check-and-
  // insert runs inside one tick, i.e. atomically - like the advisory lock.
  async function rpc(name, args) {
    await tick()
    if (name !== 'claim_email_outreach_recipient') return { data: null, error: { message: `unknown rpc ${name}` } }
    const email = args.p_email.trim().toLowerCase()
    if (tables.email_outreach_recipients.some((r) => r.normalized_email === email)) return { data: 'duplicate', error: null }
    const cap = tables.automation_settings[0].auto_email_daily_cap ?? 20
    const today = tehranDateKey(new Date())
    const used = tables.email_outreach_recipients.filter((r) => ['claimed', 'sent', 'uncertain'].includes(r.status) && r.claimed_at && tehranDateKey(new Date(r.claimed_at)) === today).length
    if (used >= cap) return { data: 'cap_reached', error: null }
    tables.email_outreach_recipients.push({ normalized_email: email, lead_id: args.p_lead_id, suggestion_id: args.p_suggestion_id, status: 'claimed', claimed_at: new Date().toISOString() })
    return { data: 'claimed', error: null }
  }

  return {
    tables,
    rpc,
    from: (table) => ({
      select: (columns) => select(table, columns),
      insert: (payload) => insert(table, payload),
      upsert: (payload, options) => upsert(table, payload, options),
      update: (patch) => mutate(table, (rows) => rows.forEach((r) => Object.assign(r, clone(patch)))),
      delete: () =>
        mutate(table, (rows) => {
          tables[table] = tables[table].filter((r) => !rows.includes(r))
        }),
    }),
  }
}

// Mocked Resend: records every request body; never reaches the network.
const originalFetch = globalThis.fetch
async function withResend({ mode = 'accept' } = {}, fn) {
  const sent = []
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails', 'only the mocked email provider may be called')
    const body = JSON.parse(init.body)
    sent.push(body)
    if (mode === 'reject' || (mode === 'rejectFirst' && sent.length === 1)) return { ok: false, status: 422, json: async () => ({ name: 'invalid_parameter', message: 'bad' }) }
    if (mode === 'unknown') return { ok: false, status: 500, json: async () => ({ name: 'internal_server_error' }) }
    return { ok: true, status: 200, json: async () => ({ id: `resend-${sent.length}` }) }
  }
  try {
    await fn(sent)
  } finally {
    globalThis.fetch = originalFetch
  }
}

const run = (client, options = {}) => runAutoEmailCycle(client, { credentials, now: noon, ...options })
const stateOf = (client, leadId) =>
  buildEmailOutreachState({
    leads: client.tables.sales_leads,
    suggestions: client.tables.prospect_outreach_suggestions,
    attempts: client.tables.outreach_attempts,
    recipients: client.tables.email_outreach_recipients,
    replies: client.tables.inbound_replies,
  }).find((e) => e.lead.id === leadId)

// ---------------------------------------------------------------------------

await check('switch off: nothing queued or sent, and the run is recorded as skipped', async () => {
  const client = makeClient({ config: settings({ auto_email_enabled: false }), leads: [lead()] })
  await withResend({}, async (sent) => {
    const report = await run(client)
    assert.equal(report.status, 'skipped')
    assert.equal(sent.length, 0)
    assert.equal(client.tables.prospect_outreach_suggestions.length, 0)
    assert.equal(client.tables.email_outreach_runs[0].status, 'skipped')
  })
})

await check('a discovered lead and a manually added lead both get one intro automatically - no approval step', async () => {
  const discovered = lead({ tags: ['prospecting'] })
  const manual = lead({ company_name: 'نقش تندیس آریا', email: 'Info@AryaCompany.ir ' })
  const client = makeClient({ leads: [discovered, manual] })
  await withResend({}, async (sent) => {
    const report = await run(client)
    assert.equal(report.queued, 2)
    assert.equal(report.sent, 2)
    assert.deepEqual(sent.map((b) => b.to[0]).sort(), [discovered.email, 'Info@AryaCompany.ir'].sort())
    const arya = sent.find((b) => b.subject.includes('نقش تندیس آریا'))
    assert.equal(arya.subject, 'معرفی هینزا پلیمر به نقش تندیس آریا')
    assert.doesNotMatch(arya.text, /عزیز/)
    assert.ok(arya.text.includes(EMAIL_OPT_OUT_FOOTER))
    assert.equal(stateOf(client, manual.id).state, 'sent')
    assert.equal(stateOf(client, manual.id).source, 'manual')
    assert.equal(stateOf(client, discovered.id).source, 'discovered')
    const claim = client.tables.email_outreach_recipients.find((r) => r.normalized_email === 'info@aryacompany.ir')
    assert.equal(claim.status, 'sent')
    assert.ok(claim.provider_message_id)
    const runRow = client.tables.email_outreach_runs[0]
    assert.equal(runRow.sent, 2)
    assert.equal(runRow.queued, 2)
  })
})

await check('per-run limit: default 3, max 10; the rest stays queued for the next run', async () => {
  assert.equal(resolveAutoEmailLimit({}), 3)
  assert.equal(resolveAutoEmailLimit({ auto_email_max_per_run: 50 }), 10)
  const client = makeClient({ config: settings({ auto_email_max_per_run: 1 }), leads: [lead(), lead(), lead()] })
  await withResend({}, async (sent) => {
    const first = await run(client)
    assert.equal(first.queued, 3)
    assert.equal(sent.length, 1)
    const counts = summarizeEmailOutreach(buildEmailOutreachState({ ...client.tables, leads: client.tables.sales_leads, suggestions: client.tables.prospect_outreach_suggestions, attempts: client.tables.outreach_attempts, recipients: client.tables.email_outreach_recipients }))
    assert.equal(counts.sent, 1)
    assert.equal(counts.queued, 2)
    await run(client)
    assert.equal(sent.length, 2)
  })
})

await check('outside the contact window: queued, not sent, with the reason reported', async () => {
  const client = makeClient({ leads: [lead()] })
  await withResend({}, async (sent) => {
    const report = await run(client, { now: night })
    assert.equal(report.queued, 1)
    assert.equal(sent.length, 0)
    assert.match(report.notSending, /بازه زمانی/)
  })
})

await check('provider test mode: nothing is sent automatically', async () => {
  const client = makeClient({ config: settings({ provider_test_mode: true }), leads: [lead()] })
  await withResend({}, async (sent) => {
    const report = await run(client)
    assert.equal(sent.length, 0)
    assert.match(report.notSending, /آزمایشی/)
  })
})

// ---------------------------------------------------------------------------
// One intro per address
// ---------------------------------------------------------------------------

await check('an address already emailed (e.g. info@aryacompany.ir, seeded from history) is never emailed again - by any lead', async () => {
  const again = lead({ company_name: 'نقش تندیس آریا (تکراری)', email: 'INFO@aryacompany.ir' })
  const client = makeClient({ leads: [again], recipients: [{ normalized_email: 'info@aryacompany.ir', lead_id: 'old-lead', status: 'sent', provider_message_id: '01a0d244' }] })
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 0)
    assert.equal(stateOf(client, again.id).kind, 'duplicate_address')
  })
})

await check('two leads with the same address: exactly one email', async () => {
  const a = lead({ email: 'sales@shared.ir' })
  const b = lead({ email: ' Sales@Shared.ir' })
  const client = makeClient({ leads: [a, b] })
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 1)
    assert.equal(stateOf(client, b.id).kind, 'duplicate_address')
  })
})

await check('repeated and concurrent runs never send the same address twice', async () => {
  const client = makeClient({ leads: [lead(), lead(), lead()] })
  await withResend({}, async (sent) => {
    await Promise.all([run(client), run(client), run(client)])
    await run(client)
    const recipients = sent.map((b) => b.to[0].toLowerCase())
    assert.equal(recipients.length, 3)
    assert.equal(new Set(recipients).size, 3)
  })
})

await check('the address claim alone blocks a send, even if the queue says otherwise (e.g. a concurrent job claimed it first)', async () => {
  const l = lead()
  const client = makeClient({ leads: [l] })
  await withResend({}, async (sent) => {
    await run(client, { now: night }) // queue only
    client.tables.email_outreach_recipients.push({ normalized_email: l.email, lead_id: 'someone-else', status: 'claimed' })
    const report = await run(client)
    assert.equal(sent.length, 0)
    assert.equal(report.sent, 0)
  })
})

// ---------------------------------------------------------------------------
// Who is never emailed, and what the admin sees
// ---------------------------------------------------------------------------

await check('never emails: do_not_contact, opt-out reply, address opted out on another lead, converted/lost, already in contact', async () => {
  const dnc = lead({ do_not_contact: true, email: 'info@optout.ir' })
  const sameAsDnc = lead({ email: 'INFO@optout.ir' })
  const replied = lead()
  const converted = lead({ status: 'converted' })
  const contacted = lead({ status: 'negotiating', last_contact_at: '2026-09-23T18:00:00Z' })
  const client = makeClient({ leads: [dnc, sameAsDnc, replied, converted, contacted], replies: [{ lead_id: replied.id, predicted_intent: 'do_not_contact', final_intent: 'do_not_contact' }] })
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 0)
    assert.equal(stateOf(client, dnc.id).kind, 'opted_out')
    assert.equal(stateOf(client, sameAsDnc.id).kind, 'opted_out')
    assert.equal(stateOf(client, replied.id).kind, 'opted_out')
    assert.equal(stateOf(client, converted.id).kind, 'closed')
    assert.equal(stateOf(client, contacted.id).kind, 'already_in_contact')
  })
})

await check('no email -> "no_email"; several addresses in one field -> "invalid_email"; nothing is marked sent', async () => {
  const none = lead({ email: null })
  const messy = lead({ email: 'a@x.ir، b@x.ir' })
  const client = makeClient({ leads: [none, messy] })
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 0)
    assert.equal(stateOf(client, none.id).kind, 'no_email')
    assert.equal(stateOf(client, messy.id).kind, 'invalid_email')
    assert.equal(client.tables.outreach_attempts.length, 0)
  })
})

await check('a free-mail or evidence-less business address is not blocked', async () => {
  const gmail = lead({ email: 'kargahplastic@gmail.com' })
  const client = makeClient({ leads: [gmail] })
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 1)
  })
})

await check('a lead that only has a phone suggestion still gets its email intro (separate key)', async () => {
  const l = lead()
  const client = makeClient({
    leads: [l],
    suggestions: [{ id: 's-phone', lead_id: l.id, channel: 'phone', status: 'approved', send_status: 'not_sent', dedupe_key: `prospect_outreach:${l.id}` }],
  })
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 1)
    assert.ok(client.tables.prospect_outreach_suggestions.some((s) => s.dedupe_key === `email_intro:${l.id}`))
    assert.equal(client.tables.prospect_outreach_suggestions.find((s) => s.id === 's-phone').status, 'approved', 'the phone suggestion is untouched')
  })
})

await check('an undecided email draft is adopted (original draft kept); a dismissed one is respected', async () => {
  const adopt = lead()
  const dismissed = lead()
  const client = makeClient({
    leads: [adopt, dismissed],
    suggestions: [
      { id: 's-draft', lead_id: adopt.id, channel: 'email', status: 'pending', send_status: 'not_sent', message_draft: 'سلام وقت بخیر، مزاحم می‌شوم.', dedupe_key: `prospect_outreach:${adopt.id}`, evidence_snapshot: {} },
      { id: 's-no', lead_id: dismissed.id, channel: 'email', status: 'dismissed', send_status: 'not_sent', dedupe_key: `prospect_outreach:${dismissed.id}` },
    ],
  })
  await withResend({}, async (sent) => {
    await run(client)
    assert.deepEqual(sent.map((b) => b.to[0]), [adopt.email])
    const row = client.tables.prospect_outreach_suggestions.find((s) => s.id === 's-draft')
    assert.equal(row.message_draft, 'سلام وقت بخیر، مزاحم می‌شوم.')
    assert.doesNotMatch(sent[0].text, /مزاحم/)
    assert.equal(stateOf(client, dismissed.id).kind, 'dismissed')
  })
})

// ---------------------------------------------------------------------------
// Failures, uncertainty, delivery status
// ---------------------------------------------------------------------------

await check('provider rejection -> "failed" in Needs attention, address stays claimed, never retried', async () => {
  const l = lead()
  const client = makeClient({ leads: [l] })
  await withResend({ mode: 'reject' }, async (sent) => {
    const report = await run(client)
    assert.equal(report.failed, 1)
    await run(client)
    assert.equal(sent.length, 1)
    assert.equal(stateOf(client, l.id).kind, 'failed')
  })
})

await check('uncertain provider outcome -> "uncertain", never retried (no duplicate risk)', async () => {
  const l = lead()
  const client = makeClient({ leads: [l] })
  await withResend({ mode: 'unknown' }, async (sent) => {
    const report = await run(client)
    assert.equal(report.uncertain, 1)
    await run(client)
    await run(client)
    assert.equal(sent.length, 1)
    assert.equal(stateOf(client, l.id).kind, 'uncertain')
  })
})

await check('a gate block before any provider call releases the address; the next good run sends once', async () => {
  const l = lead()
  const client = makeClient({ leads: [l] })
  await withResend({}, async (sent) => {
    const blocked = await run(client, { credentials: {} })
    assert.equal(blocked.blocked, 1)
    assert.equal(client.tables.email_outreach_recipients.length, 0)
    assert.equal(stateOf(client, l.id).state, 'queued')
    await run(client)
    await run(client)
    assert.equal(sent.length, 1)
  })
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

await check('message: company name, formal greeting, hedged products only from evidence', () => {
  const plain = composeAutoIntroEmail({ companyName: 'نقش تندیس آریا' })
  assert.match(plain.message, /^با سلام و احترام،/)
  assert.doesNotMatch(plain.message, /عزیز|ممکن است/)
  const fit = composeAutoIntroEmail({ companyName: 'صنایع نمونه', industryLabels: ['قالب‌گیری تزریقی', 'works'], products: ['مستربچ رنگی', 'مستربچ سفید'] })
  assert.match(fit.message, /صنایع نمونه در حوزه قالب‌گیری تزریقی، مستربچ رنگی و مستربچ سفید ممکن است/)
  assert.doesNotMatch(fit.message, /works/)
})

await check('nextCronRun: "45 6-12 * * *" (UTC)', () => {
  assert.equal(nextCronRun('45 6-12 * * *', new Date('2026-09-24T07:20:00Z')).toISOString(), '2026-09-24T07:45:00.000Z')
  assert.equal(nextCronRun('45 6-12 * * *', new Date('2026-09-24T12:50:00Z')).toISOString(), '2026-09-25T06:45:00.000Z')
  assert.equal(nextCronRun('*/5 * * * 1', new Date()), null)
})

// ---------------------------------------------------------------------------
// Daily cap (Tehran calendar day, across all runs)
// ---------------------------------------------------------------------------

await check('daily cap: never more than the cap per day across runs; the report says the cap was reached', async () => {
  const client = makeClient({ config: settings({ auto_email_max_per_run: 3, auto_email_daily_cap: 2 }), leads: [lead(), lead(), lead(), lead(), lead()] })
  await withResend({}, async (sent) => {
    const first = await run(client)
    assert.equal(first.sent, 2)
    assert.equal(first.capReached, true)
    assert.equal(first.sentToday, 2)
    assert.equal(first.remainingToday, 0)
    const second = await run(client)
    assert.equal(second.sent, 0)
    assert.equal(second.capReached, true)
    assert.match(second.notSending, /سقف روزانه/)
    assert.equal(sent.length, 2)
  })
})

await check('daily cap holds under concurrent runs (cron + Run now at the same time)', async () => {
  const client = makeClient({ config: settings({ auto_email_max_per_run: 3, auto_email_daily_cap: 2 }), leads: [lead(), lead(), lead(), lead(), lead(), lead()] })
  await withResend({}, async (sent) => {
    await Promise.all([run(client), run(client), run(client)])
    assert.equal(sent.length, 2)
    assert.equal(new Set(sent.map((b) => b.to[0])).size, 2)
  })
})

await check('an email already sent today (e.g. info@aryacompany.ir) counts toward the cap; a definite failure does not', async () => {
  const client = makeClient({
    config: settings({ auto_email_max_per_run: 3, auto_email_daily_cap: 2 }),
    leads: [lead(), lead(), lead()],
    recipients: [{ normalized_email: 'info@aryacompany.ir', lead_id: 'arya', status: 'sent', claimed_at: new Date().toISOString() }],
  })
  await withResend({ mode: 'rejectFirst' }, async (sent) => {
    const report = await run(client)
    assert.equal(report.sentTodayBefore, 1)
    assert.equal(report.failed, 1)
    assert.equal(report.sent, 1, 'the failed one freed its slot for the next address')
    assert.equal(report.sentToday, 2)
    assert.ok(!sent.some((b) => b.to[0] === 'info@aryacompany.ir'))
  })
})

await check('an uncertain delivery counts toward the cap and is never retried', async () => {
  const l = lead()
  const client = makeClient({ config: settings({ auto_email_daily_cap: 1 }), leads: [l, lead()] })
  await withResend({ mode: 'unknown' }, async (sent) => {
    const report = await run(client)
    assert.equal(report.uncertain, 1)
    assert.equal(report.sentToday, 1)
    await run(client)
    assert.equal(sent.length, 1)
  })
})

await check('fewer eligible leads than the cap: only the real number is sent and reported', async () => {
  const client = makeClient({ config: settings({ auto_email_max_per_run: 3, auto_email_daily_cap: 20 }), leads: [lead(), lead({ email: null })] })
  await withResend({}, async (sent) => {
    const report = await run(client)
    assert.equal(report.sent, 1)
    assert.equal(report.remainingToday, 19)
    assert.equal(sent.length, 1)
  })
})

// ---------------------------------------------------------------------------
// Email lookup on the company's own website. fetchPage is always a fake -
// nothing here reaches the network.
// ---------------------------------------------------------------------------

function fakeSite(pages) {
  const fetched = []
  const fetchPage = async (url) => {
    fetched.push(url)
    return url in pages ? { ok: true, text: pages[url] } : { ok: false, reason: 'HTTP 404' }
  }
  return { fetchPage, fetched }
}

await check('lookup: a discovered lead is found on the site it was discovered on even when its "name" is only the page title', async () => {
  const { fetchPage } = fakeSite({
    'https://www.pespipe.com/': '<title>شرکت تولید لوله و اتصالات پی ای اس</title> info@pespipe.com',
    'https://www.pespipe.com/fa-ir/': '<title>x</title>',
  })
  const websites = ['https://www.pespipe.com/fa-ir/']
  const asManual = await lookupCompanyEmail({ websites, companyName: 'تولید لوله پلی اتیلن', fetchPage })
  assert.equal(asManual.status, 'identity_mismatch')
  const asDiscovered = await lookupCompanyEmail({ websites, companyName: 'تولید لوله پلی اتیلن', discoveredOn: 'https://www.pespipe.com/fa-ir/', fetchPage })
  assert.equal(asDiscovered.status, 'found')
  assert.equal(asDiscovered.email, 'info@pespipe.com')
  assert.equal(asDiscovered.sourceUrl, 'https://www.pespipe.com/')
})

await check("lookup: a news/other site linked as a manual lead's website is never used", async () => {
  const { fetchPage } = fakeSite({ 'https://www.ilna.ir/': '<title>خبرگزاری کار ایران - ایلنا</title> info@ilna.ir' })
  const result = await lookupCompanyEmail({ websites: ['https://www.ilna.ir/article-1'], companyName: 'تولی‌پرس', fetchPage })
  assert.equal(result.status, 'identity_mismatch')
  assert.equal(result.email, null)
})

await check('lookup: related-name addresses published on the company site are accepted; unrelated domains and www.-typos are not', () => {
  assert.equal(pickCompanyEmail(['info@psgharn.co'], 'gharn.ir'), 'info@psgharn.co')
  assert.equal(pickCompanyEmail(['info@denizgroup.co'], 'denizshimi.com'), 'info@denizgroup.co')
  assert.equal(pickCompanyEmail(['charmara.golshad@gmail.com'], 'igolshad.ir'), 'charmara.golshad@gmail.com')
  assert.equal(pickCompanyEmail(['hello@webdesign-studio.ir'], 'gharn.ir'), null)
  assert.equal(pickCompanyEmail(['www.saniplastco@gmail.com'], 'saniplastmehr.com'), null)
  assert.equal(pickCompanyEmail(['info@othercorp.ir', 'sales@acme.ir', 'info@acme.ir'], 'acme.ir'), 'sales@acme.ir')
})

await check('lookup: when the homepage links no contact page, /contact-us/ is tried', async () => {
  const { fetchPage, fetched } = fakeSite({
    'https://acmeplast.ir/': '<title>آکمه پلاست</title>',
    'https://acmeplast.ir/contact-us/': 'sales@acmeplast.ir',
  })
  const result = await lookupCompanyEmail({ websites: ['acmeplast.ir'], companyName: 'آکمه پلاست', fetchPage })
  assert.equal(result.status, 'found')
  assert.equal(result.email, 'sales@acmeplast.ir')
  assert.equal(result.sourceUrl, 'https://acmeplast.ir/contact-us/')
  assert.ok(fetched.includes('https://acmeplast.ir/contact-us/'))
})

await check('pipeline: a lead without email gets its address found, saved with its source, and one intro sent in the same run', async () => {
  const noEmail = lead({ email: null, website: 'https://pouyaplastco.com/making-custom-plastic-parts/', company_name: 'ساخت قطعات پلاستیکی سفارشی', tags: ['prospecting'] })
  const client = makeClient({ leads: [noEmail] })
  client.tables.prospect_candidates.push({ id: 'cand-1', promoted_lead_id: noEmail.id, website: noEmail.website, canonical_name: noEmail.company_name })
  const { fetchPage } = fakeSite({ 'https://pouyaplastco.com/': '<title>پویا پلاست</title> <a href="mailto:info@pouyaplastco.com">info@pouyaplastco.com</a>' })
  await withResend({}, async (sent) => {
    const report = await run(client, { fetchPage })
    const saved = client.tables.sales_leads.find((l) => l.id === noEmail.id)
    assert.equal(saved.email, 'info@pouyaplastco.com')
    assert.equal(saved.email_source_url, 'https://pouyaplastco.com/')
    assert.equal(saved.email_lookup_status, 'found')
    assert.equal(report.emailLookup.found, 1)
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].to, ['info@pouyaplastco.com'])
    assert.equal(stateOf(client, noEmail.id).state, 'sent')
  })
})

await check('pipeline: a found address that was already emailed (by another lead) is recorded but never emailed again', async () => {
  const noEmail = lead({ email: null, website: 'https://aryacompany.ir/', company_name: 'آریا کمپانی' })
  const client = makeClient({ leads: [noEmail], recipients: [{ normalized_email: 'info@aryacompany.ir', lead_id: 'other', status: 'sent', claimed_at: '2026-09-24T07:14:47Z' }] })
  const { fetchPage } = fakeSite({ 'https://aryacompany.ir/': '<title>آریا کمپانی</title> info@aryacompany.ir' })
  await withResend({}, async (sent) => {
    await run(client, { fetchPage })
    assert.equal(sent.length, 0)
    assert.equal(stateOf(client, noEmail.id).kind, 'duplicate_address')
  })
})

await check('a lead already being worked (negotiating, no logged contact) is skipped with a reason', async () => {
  const working = lead({ status: 'negotiating' })
  const client = makeClient({ leads: [working] })
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 0)
    assert.equal(stateOf(client, working.id).kind, 'already_in_contact')
  })
})

// ---------------------------------------------------------------------------
// Resend webhook: signature, status updates, suppression. No network.
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = `whsec_${Buffer.from('hinza-test-webhook-secret-32bytes!').toString('base64')}`

async function signedEvent(event, { id = `msg_${Math.random().toString(36).slice(2)}`, at = noon, secret = WEBHOOK_SECRET } = {}) {
  const body = JSON.stringify(event)
  const timestamp = String(Math.floor(at.getTime() / 1000))
  const signature = `v1,${await signResendPayload({ secret, id, timestamp, body })}`
  return { id, timestamp, signature, body }
}

function resendEvent(type, emailId, to, extra = {}) {
  return { type, created_at: '2026-09-24T11:00:00.000Z', data: { email_id: emailId, to: [to], ...extra } }
}

// A lead whose intro was really sent by the runner; returns its message id.
async function sentLead(client, l) {
  await withResend({}, async () => {
    await run(client)
  })
  return client.tables.outreach_attempts.find((a) => a.lead_id === l.id && a.status === 'sent').external_message_id
}

async function deliver(client, event, id) {
  return applyResendEvent(client, { eventId: id || `evt-${Math.random()}`, event, payloadText: JSON.stringify(event), now: noon })
}

await check('webhook signature: valid accepted; tampered body, wrong secret, stale timestamp and missing headers rejected', async () => {
  const s = await signedEvent(resendEvent('email.delivered', 'e1', 'info@acme.ir'))
  assert.deepEqual(await verifyResendSignature({ secret: WEBHOOK_SECRET, ...s, now: noon }), { ok: true })
  assert.equal((await verifyResendSignature({ secret: WEBHOOK_SECRET, ...s, body: s.body.replace('delivered', 'bounced'), now: noon })).reason, 'bad_signature')
  const other = `whsec_${Buffer.from('another-secret-another-secret-xx').toString('base64')}`
  assert.equal((await verifyResendSignature({ secret: other, ...s, now: noon })).reason, 'bad_signature')
  assert.equal((await verifyResendSignature({ secret: WEBHOOK_SECRET, ...s, now: new Date(noon.getTime() + 10 * 60 * 1000) })).reason, 'stale_timestamp')
  assert.equal((await verifyResendSignature({ secret: WEBHOOK_SECRET, ...s, signature: null, now: noon })).reason, 'missing_headers')
  assert.equal((await verifyResendSignature({ secret: null, ...s, now: noon })).reason, 'no_secret')
  // Several signatures (secret rotation): any valid v1 is enough.
  assert.equal((await verifyResendSignature({ secret: WEBHOOK_SECRET, ...s, signature: `v1,AAAA ${s.signature}`, now: noon })).ok, true)
})

await check('webhook: delivered updates the existing send record once; a repeated event id changes nothing', async () => {
  const l = lead()
  const client = makeClient({ leads: [l] })
  client.tables.email_provider_events = []
  const messageId = await sentLead(client, l)
  const event = resendEvent('email.delivered', messageId, l.email)
  const first = await deliver(client, event, 'evt-1')
  assert.equal(first.attemptsUpdated, 1)
  const attempt = client.tables.outreach_attempts.find((a) => a.external_message_id === messageId)
  assert.equal(attempt.provider_status, 'delivered')
  assert.equal(client.tables.email_outreach_recipients.find((r) => r.normalized_email === l.email).delivery_status, 'delivered')
  const again = await deliver(client, event, 'evt-1')
  assert.equal(again.duplicate, true)
  assert.equal(client.tables.email_provider_events.length, 1)
  assert.equal(stateOf(client, l.id).kind, null)
})

await check('webhook: a hard bounce suppresses the address, shows as bounced, and a late "delivered" never hides it', async () => {
  const l = lead()
  const client = makeClient({ leads: [l] })
  client.tables.email_provider_events = []
  const messageId = await sentLead(client, l)
  const result = await deliver(client, resendEvent('email.bounced', messageId, l.email, { bounce: { type: 'Permanent', subType: 'General' } }))
  assert.deepEqual(result.suppressed, [l.email])
  await deliver(client, resendEvent('email.delivered', messageId, l.email))
  const attempt = client.tables.outreach_attempts.find((a) => a.external_message_id === messageId)
  assert.equal(attempt.provider_status, 'bounced')
  const recipient = client.tables.email_outreach_recipients.find((r) => r.normalized_email === l.email)
  assert.equal(recipient.suppression_reason, 'hard_bounce')
  assert.equal(recipient.delivery_status, 'bounced')
  assert.equal(stateOf(client, l.id).kind, 'bounced')
})

await check('webhook: a transient bounce is recorded but does not suppress the address', async () => {
  const l = lead()
  const client = makeClient({ leads: [l] })
  client.tables.email_provider_events = []
  const messageId = await sentLead(client, l)
  const result = await deliver(client, resendEvent('email.bounced', messageId, l.email, { bounce: { type: 'Transient' } }))
  assert.deepEqual(result.suppressed, [])
  assert.equal(client.tables.outreach_attempts.find((a) => a.external_message_id === messageId).provider_status, 'bounced_transient')
  assert.equal(client.tables.email_outreach_recipients.find((r) => r.normalized_email === l.email).suppressed_at, undefined)
})

await check('webhook: a complaint suppresses the address and marks every lead with it do_not_contact', async () => {
  const l = lead({ email: 'Info@Complain.ir' })
  const twin = lead({ email: 'info@complain.ir ', status: 'negotiating' })
  const client = makeClient({ leads: [l, twin] })
  client.tables.email_provider_events = []
  const messageId = await sentLead(client, l)
  const result = await deliver(client, resendEvent('email.complained', messageId, 'Info@Complain.ir'))
  assert.equal(result.leadsOptedOut, 2)
  assert.ok(client.tables.sales_leads.every((x) => x.do_not_contact === true))
  assert.equal(client.tables.email_outreach_recipients.find((r) => r.normalized_email === 'info@complain.ir').suppression_reason, 'complaint')
})

await check('send gate: a suppressed address is refused on a real send, whichever lead or path asks', async () => {
  const other = lead({ email: 'sales@bounced.ir' })
  const client = makeClient({
    leads: [other],
    recipients: [{ normalized_email: 'sales@bounced.ir', lead_id: 'old-lead', status: 'sent', suppressed_at: '2026-09-24T11:00:00Z', suppression_reason: 'hard_bounce', claimed_at: '2026-09-20T08:00:00Z' }],
  })
  client.tables.prospect_outreach_suggestions.push({ id: 'manual-1', lead_id: other.id, channel: 'email', status: 'approved', send_status: 'not_sent', message_final: 'متن', subject_draft: 'موضوع' })
  await withResend({}, async (sent) => {
    const result = await attemptSend(client, { suggestionId: 'manual-1', actorUserId: 'admin', testMode: false, credentials, now: noon })
    assert.equal(result.ok, false)
    assert.ok(result.reasons.some((r) => r.includes('برگشت خورده')))
    assert.equal(sent.length, 0)
  })
  const gate = evaluateSendGate({ suggestion: { channel: 'email', status: 'approved', message_final: 'x' }, lead: other, settings: settings(), credentialsConfigured: true, emailSuppression: 'complaint', testMode: false, now: noon })
  assert.ok(gate.reasons.some((r) => r.includes('هرزنامه')))
})

await check('webhook: an event for an address never auto-emailed is recorded so the address is never auto-emailed', async () => {
  const l = lead({ email: 'owner@manual.ir' })
  const client = makeClient({ leads: [l] })
  client.tables.email_provider_events = []
  await deliver(client, resendEvent('email.bounced', 'manual-msg', 'owner@manual.ir', { bounce: { type: 'Permanent' } }))
  const recipient = client.tables.email_outreach_recipients.find((r) => r.normalized_email === 'owner@manual.ir')
  assert.equal(recipient.status, 'sent')
  assert.equal(recipient.suppression_reason, 'hard_bounce')
  await withResend({}, async (sent) => {
    await run(client)
    assert.equal(sent.length, 0)
  })
})

console.log(`\n${passed} check(s) passed.`)
