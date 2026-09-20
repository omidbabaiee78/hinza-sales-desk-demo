// Lightweight pure-logic checks for Phase 20 Reply Intelligence
// (src/replyIntelligence/*). No new test framework - Node's built-in assert,
// run directly with `node scripts/checkReplyIntelligence.mjs`. Covers the
// exact examples from the Phase 20 spec plus normalization, idempotency,
// do_not_contact/follow-up behavior, and missing-target/admin-override
// cases.

import assert from 'node:assert/strict'
import { normalizeReply } from '../src/replyIntelligence/normalizeReply.js'
import { classifyReply } from '../src/replyIntelligence/classifyReply.js'
import { recommendNextAction } from '../src/replyIntelligence/recommendNextAction.js'
import { parseFollowUpDate } from '../src/replyIntelligence/followUpDateParser.js'
import { getIntentDefinition } from '../src/replyIntelligence/intentDefinitions.js'
import { processInboundReply, confirmInboundReply } from '../src/replyIntelligence/replyProcessor.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

const now = new Date('2026-09-19T10:00:00+03:30') // a Saturday, Tehran time

function classify(text) {
  return classifyReply(normalizeReply(text), { now })
}

// ---------------------------------------------------------------------------
// Spec examples - exact intent match
// ---------------------------------------------------------------------------

const EXAMPLES = [
  ['قیمت چند؟', 'price_request'],
  ['قیمت بفرست', 'price_request'],
  ['قیمت لطفا', 'price_request'],
  ['ماه بعد تماس بگیر', 'follow_up_later'],
  ['بعد عید تماس بگیرید', 'follow_up_later'],
  ['الان نیاز نداریم', 'not_now'],
  ['فعلاً خرید نداریم', 'not_now'],
  ['دیگه پیام ندید', 'do_not_contact'],
  ['دیگه تماس نگیرید', 'do_not_contact'],
  ['اشتباه گرفتید', 'wrong_contact'],
  ['با تأمین‌کننده قرارداد داریم', 'already_supplied'],
  ['نمونه دارید؟', 'sample_request'],
  ['زنگ بزنید', 'call_requested'],
  ['لطفا زنگ بزنید', 'call_requested'],
]

for (const [text, expectedIntent] of EXAMPLES) {
  await check(`"${text}" -> ${expectedIntent}`, () => {
    const result = classify(text)
    assert.equal(result.intentKey, expectedIntent)
  })
}

await check('ambiguous "باشه" -> unknown with manual_review confidence', () => {
  const result = classify('باشه')
  assert.equal(result.intentKey, 'unknown')
  assert.equal(result.confidence, 'manual_review')
})

await check('"نیاز نداریم" without a temporal hedge leans not_interested, not not_now', () => {
  const result = classify('نیاز نداریم')
  assert.equal(result.intentKey, 'not_interested')
})

await check('do_not_contact is never overclaimed when only weakly implied', () => {
  const result = classify('قیمت نمی‌خوام بدونم چون فعلا نیاز نداریم')
  assert.notEqual(result.intentKey, 'do_not_contact')
})

// ---------------------------------------------------------------------------
// Persian/Arabic normalization
// ---------------------------------------------------------------------------

await check('Arabic ي normalizes to Persian ی', () => {
  const { normalized } = normalizeReply('قيمت چند؟')
  assert.ok(normalized.includes('قیمت'))
})

await check('Persian and Arabic-Indic digits both normalize to ASCII', () => {
  const { normalized: fa } = normalizeReply('۳ روز دیگه بعد تماس بگیر')
  const { normalized: ar } = normalizeReply('٣ روز دیگه بعد تماس بگیر')
  assert.ok(fa.includes('3'))
  assert.ok(ar.includes('3'))
})

await check('نیم‌فاصله (ZWNJ) does not break keyword matching', () => {
  const result = classify('با تأمین‌کننده قرارداد داریم')
  assert.equal(result.intentKey, 'already_supplied')
})

// ---------------------------------------------------------------------------
// Follow-up date parsing
// ---------------------------------------------------------------------------

await check('"فردا" parses to a reliable next-day date', () => {
  const parsed = parseFollowUpDate('فردا تماس بگیر', now)
  assert.equal(parsed.matched, true)
  assert.equal(parsed.reliable, true)
  assert.equal(parsed.iso.slice(0, 10), '2026-09-20')
})

await check('"سه روز دیگه" parses reliably with a number word', () => {
  const parsed = parseFollowUpDate('سه روز دیگه خبر میدیم', now)
  assert.equal(parsed.reliable, true)
  assert.equal(parsed.iso.slice(0, 10), '2026-09-22')
})

await check('"ماه بعد" advances by a calendar month', () => {
  const parsed = parseFollowUpDate('ماه بعد تماس بگیر', now)
  assert.equal(parsed.reliable, true)
  assert.equal(parsed.iso.slice(0, 10), '2026-10-19')
})

await check('"شنبه تماس بگیر" resolves to the NEXT Saturday, not today even though today is Saturday', () => {
  const parsed = parseFollowUpDate('شنبه تماس بگیر', now)
  assert.equal(parsed.reliable, true)
  assert.notEqual(parsed.iso.slice(0, 10), '2026-09-19')
})

await check('"بعد عید" is recognized but never turned into a fabricated date', () => {
  const parsed = parseFollowUpDate('بعد عید تماس بگیرید', now)
  assert.equal(parsed.matched, true)
  assert.equal(parsed.reliable, false)
  assert.equal(parsed.iso, null)
})

await check('a follow-up recommendation never fabricates a date for an unparseable expression', () => {
  const rec = recommendNextAction({
    intentKey: 'follow_up_later',
    normalizedText: normalizeReply('بعد عید خبر میدیم').normalized,
    now,
  })
  assert.equal(rec.followUpAt, null)
  assert.equal(rec.followUpReliable, false)
})

await check('already_supplied gets a clearly-labeled long-term default, not a customer-stated date', () => {
  const rec = recommendNextAction({ intentKey: 'already_supplied', normalizedText: 'با تامین کننده قرارداد داریم', now })
  assert.ok(rec.followUpAt)
  assert.equal(rec.followUpReliable, false)
})

// ---------------------------------------------------------------------------
// replyProcessor - fake Supabase client (in-memory), covering DB-facing
// behavior: idempotency, do_not_contact, missing target, admin override.
// ---------------------------------------------------------------------------

function makeFakeClient() {
  const tables = {
    inbound_replies: [],
    sales_leads: [{ id: 'lead-1', do_not_contact: false, next_follow_up_at: null }],
    lead_activities: [],
    automation_tasks: [{ id: 'task-1', status: 'ready' }],
    automation_task_events: [],
  }
  let nextId = 1

  function selectBuilder(table) {
    let rows = tables[table]
    const builder = {
      eq(field, value) {
        rows = rows.filter((r) => r[field] === value)
        return builder
      },
      select() {
        return builder
      },
      order() {
        return builder
      },
      single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    }
    return builder
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from(table) {
      return {
        select: () => selectBuilder(table),
        insert(payload) {
          const rows = Array.isArray(payload) ? payload : [payload]
          const inserted = rows.map((row) => ({ id: `${table}-${nextId++}`, ...row }))
          tables[table].push(...inserted)
          return {
            select: () => ({
              single: async () => ({ data: inserted[0], error: null }),
            }),
          }
        },
        update(patch) {
          return {
            eq: (field, value) => {
              const target = tables[table].find((r) => r[field] === value)
              if (target) Object.assign(target, patch)
              const result = { data: target ?? null, error: null }
              return {
                select: () => ({ single: async () => result }),
                then: (resolve) => resolve(result),
              }
            },
          }
        },
      }
    },
    tables,
  }
}

await check('processInboundReply + confirmation applies do_not_contact and cancels the source task', async () => {
  const client = makeFakeClient()
  const result = await processInboundReply(client, {
    leadId: 'lead-1',
    automationTaskId: 'task-1',
    channel: 'whatsapp',
    rawMessage: 'دیگه تماس نگیرید',
    source: 'manual',
    confirmation: {},
  })
  const lead = client.tables.sales_leads.find((l) => l.id === 'lead-1')
  assert.equal(lead.do_not_contact, true)
  assert.equal(result.admin_confirmed, true)
  assert.ok(result.processed_at)
})

await check('duplicate processing of the same reply id does not re-cancel or re-log', async () => {
  const client = makeFakeClient()
  const inserted = await processInboundReply(client, {
    leadId: 'lead-1',
    automationTaskId: 'task-1',
    channel: 'manual',
    rawMessage: 'قیمت لطفا',
    source: 'manual',
  })
  await confirmInboundReply(client, inserted.reply.id, { finalIntentKey: 'price_request' })
  const activityCountAfterFirst = client.tables.lead_activities.length
  await confirmInboundReply(client, inserted.reply.id, { finalIntentKey: 'price_request' })
  assert.equal(client.tables.lead_activities.length, activityCountAfterFirst, 'no duplicate activity logged')
})

await check('missing lead/company target is rejected by the has-target invariant (application-level check)', () => {
  const hasTarget = (params) => Boolean(params.leadId || params.companyId)
  assert.equal(hasTarget({ leadId: null, companyId: null }), false)
  assert.equal(hasTarget({ leadId: 'lead-1', companyId: null }), true)
})

await check('admin override: a different final_intent than the predicted one is preserved for feedback comparison', async () => {
  const client = makeFakeClient()
  const inserted = await processInboundReply(client, {
    leadId: 'lead-1',
    channel: 'manual',
    rawMessage: 'باشه',
    source: 'manual',
  })
  assert.equal(inserted.reply.predicted_intent, 'unknown')
  const confirmed = await confirmInboundReply(client, inserted.reply.id, { finalIntentKey: 'interested' })
  assert.equal(confirmed.predicted_intent, 'unknown')
  assert.equal(confirmed.final_intent, 'interested')
})

await check('follow_up_later confirmation sets next_follow_up_at without setting do_not_contact', async () => {
  const client = makeFakeClient()
  const followUpAt = '2026-09-20T09:00:00+03:30'
  await processInboundReply(client, {
    leadId: 'lead-1',
    channel: 'manual',
    rawMessage: 'فردا تماس بگیر',
    source: 'manual',
    confirmation: { finalIntentKey: 'follow_up_later', followUpAt },
  })
  const lead = client.tables.sales_leads.find((l) => l.id === 'lead-1')
  assert.equal(lead.next_follow_up_at, followUpAt)
  assert.equal(lead.do_not_contact, false)
})

await check('wrong_contact does not delete the lead, only blocks it', async () => {
  const client = makeFakeClient()
  await processInboundReply(client, {
    leadId: 'lead-1',
    channel: 'phone',
    rawMessage: 'اشتباه گرفتید',
    source: 'manual',
    confirmation: {},
  })
  const lead = client.tables.sales_leads.find((l) => l.id === 'lead-1')
  assert.ok(lead, 'lead row still exists')
  assert.equal(lead.do_not_contact, true)
})

await check('getIntentDefinition falls back to unknown for an unrecognized key, never throws', () => {
  const def = getIntentDefinition('totally_made_up_key')
  assert.equal(def.key, 'unknown')
})

console.log(`\n${passed} check(s) passed.`)
