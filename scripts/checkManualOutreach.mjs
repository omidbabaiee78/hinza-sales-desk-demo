// Daily Manual Outreach - regression checks for the page helpers and the
// migration's guarantees that can be read statically. Run with
// `npm run check:manual`. The database behaviour itself is checked by
// scripts/checkManualOutreach.sql (runs in a transaction and rolls back).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MANUAL_DAILY_LIMIT, applyContacted, bestCandidateByLead, displayPhone, splitManualRows } from '../src/outreach/manualOutreach.js'
import { GROUPS, routeFromPathname } from '../src/components/admin/adminSections.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

const sql = readFileSync(new URL('../supabase/sql/phase38_daily_manual_outreach.sql', import.meta.url), 'utf8')
// Statements only: comments and the rollback notes are not checked.
const body = sql.split('-- Rollback:')[0].replace(/--.*$/gm, '')

check('daily limit is 20', () => {
  assert.equal(MANUAL_DAILY_LIMIT, 20)
  assert.match(body, /v_count < 20/)
  assert.match(body, /limit 20 - v_count/)
})

check('displayPhone turns E.164 into the local form', () => {
  assert.equal(displayPhone('+989121234567'), '09121234567')
  assert.equal(displayPhone('+982188776655'), '02188776655')
  assert.equal(displayPhone(''), '')
})

check('bestCandidateByLead keeps the highest score per lead', () => {
  const map = bestCandidateByLead([
    { promoted_lead_id: 'a', overall_score: 40 },
    { promoted_lead_id: 'a', overall_score: 80 },
    { promoted_lead_id: 'b', overall_score: null },
    { promoted_lead_id: null, overall_score: 99 },
  ])
  assert.equal(map.get('a').overall_score, 80)
  assert.ok(map.has('b'))
  assert.equal(map.size, 2)
})

check('splitManualRows: pending first, contacted counted', () => {
  const rows = [
    { id: '1', status: 'pending' },
    { id: '2', status: 'contacted', contacted_at: '2026-09-28T08:00:00Z' },
    { id: '3', status: 'contacted', contacted_at: '2026-09-28T09:00:00Z' },
  ]
  const s = splitManualRows(rows)
  assert.deepEqual(
    s.pending.map((r) => r.id),
    ['1'],
  )
  assert.deepEqual(
    s.done.map((r) => r.id),
    ['3', '2'],
  )
  assert.equal(s.total, 3)
  assert.equal(s.contacted, 2)
})

check('applyContacted flips one row (optimistic UI)', () => {
  const rows = [{ id: '1', status: 'pending', contacted_at: null }, { id: '2', status: 'pending' }]
  const ticked = applyContacted(rows, '1', true, 'T')
  assert.equal(ticked[0].status, 'contacted')
  assert.equal(ticked[0].contacted_at, 'T')
  assert.equal(ticked[1].status, 'pending')
  const unticked = applyContacted(ticked, '1', false)
  assert.equal(unticked[0].status, 'pending')
  assert.equal(unticked[0].contacted_at, null)
})

check('page is reachable at /admin/manualOutreach under ارتباط اولیه', () => {
  const contact = GROUPS.find((g) => g.key === 'contact')
  assert.ok(contact.tabs.some((t) => t.key === 'manualOutreach'))
  assert.equal(routeFromPathname('/admin/manualOutreach').key, 'manualOutreach')
})

check('migration: one row per lead ever, no sending, email untouched', () => {
  assert.match(body, /unique \(lead_id\)/)
  assert.match(body, /on conflict \(lead_id\) do nothing/)
  assert.doesNotMatch(body, /net\.http|pg_net|functions\/v1/i)
  assert.doesNotMatch(body, /update public\.sales_leads/i)
  assert.doesNotMatch(body, /lead_activities|email_outreach_recipients|channel_outreach_messages|automation_settings/)
  assert.doesNotMatch(body, /\b(drop table|drop column|truncate)\b/i)
})

check('migration: do_not_contact and closed leads are excluded and withdrawn', () => {
  assert.match(body, /p_lead\.do_not_contact/)
  assert.match(body, /status in \('converted', 'lost'\)/)
  assert.match(body, /final_intent = 'do_not_contact'/)
  assert.match(body, /after update of do_not_contact, status on public\.sales_leads/)
})

check('migration: RPCs are admin-only, table writes only via RPCs', () => {
  assert.equal((body.match(/if not private\.is_admin\(\) then/g) || []).length, 2)
  assert.match(body, /revoke all on public\.manual_outreach_contacts from anon, authenticated/)
  assert.match(body, /revoke all on function private\.manual_outreach_fill\(date, uuid\[\]\) from public, anon, authenticated/)
})

console.log(`\n${passed} checks passed`)
