// Simple CRM - regression checks for the page helpers, the navigation and
// what the migration can be seen to guarantee. Run with `npm run check:crm`.
// Database behaviour is checked by scripts/checkSimpleCrm.sql (one
// transaction, rolled back).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { crmErrorMessage, crmFormFromLead, crmFormFromRecord, crmPayload, guessCrmSource, matchesCrmSearch } from '../src/crm/simpleCrm.js'
import { FLOW, GROUPS, HIDDEN_TOOLS, MORE_TOOLS, PAGE_LABELS, routeFromPathname } from '../src/components/admin/adminSections.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

const sql = readFileSync(new URL('../supabase/sql/phase39_simple_crm.sql', import.meta.url), 'utf8')
const body = sql.split('-- Rollback:')[0].replace(/--.*$/gm, '')

check('prefill from a lead copies contact fields and guesses the source', () => {
  const lead = { company_name: 'Acme', contact_name: 'Ali', mobile: '09121234567', phone: '021', email: 'a@acme.ir', city: null, province: 'Tehran' }
  const form = crmFormFromLead(lead, { manualContacted: true, emailed: true })
  assert.equal(form.company_name, 'Acme')
  assert.equal(form.phone, '09121234567')
  assert.equal(form.city, 'Tehran')
  assert.equal(form.source, 'manual_outreach')
  assert.equal(form.notes, '')
  assert.equal(guessCrmSource({ emailed: true }), 'email_outreach')
  assert.equal(guessCrmSource({}), 'manual_entry')
})

check('payload trims, blanks become null, notes keep line breaks', () => {
  const row = crmPayload({ ...crmFormFromRecord({ company_name: '  Acme ', source: 'manual_entry' }), notes: 'line 1\nline 2\n\n' })
  assert.equal(row.company_name, 'Acme')
  assert.equal(row.contact_name, null)
  assert.equal(row.notes, 'line 1\nline 2')
  assert.equal(Object.hasOwn(row, 'linked_lead_id'), false)
})

check('payload rejects a missing company and a bad email', () => {
  assert.throws(() => crmPayload({ company_name: '  ' }), /شرکت/)
  assert.throws(() => crmPayload({ company_name: 'A', email: 'nope' }), /ایمیل/)
  assert.equal(crmPayload({ company_name: 'A', source: 'bogus' }).source, 'manual_entry')
})

check('search matches text and phone digits (Persian digits too)', () => {
  const r = { company_name: 'Hinza Poly', phone: '0912 123 4567', product_interest: 'Masterbatch White', notes: 'call back' }
  assert.ok(matchesCrmSearch(r, 'poly'))
  assert.ok(matchesCrmSearch(r, 'white'))
  assert.ok(matchesCrmSearch(r, '۱۲۳۴۵'))
  assert.ok(matchesCrmSearch(r, ''))
  assert.ok(!matchesCrmSearch(r, 'black'))
})

check('duplicate linked lead gets a clear message', () => {
  assert.match(crmErrorMessage({ code: '23505' }), /قبلاً/)
})

check('menu: CRM is a top-level page at /admin/crm; advanced CRM hidden but routable', () => {
  assert.ok(GROUPS.some((g) => g.key === 'crm'))
  assert.equal(routeFromPathname('/admin/crm').key, 'crm')
  assert.ok(FLOW.some((p) => p.key === 'manualOutreach'))
  for (const key of ['crmAdvanced', 'customers', 'followUps', 'automation', 'today', 'dashboard', 'reports']) {
    assert.ok(!MORE_TOOLS.some((t) => t.key === key), `${key} still in menu`)
    assert.ok(HIDDEN_TOOLS.some((t) => t.key === key), `${key} not preserved`)
    assert.equal(routeFromPathname(`/admin/${key}`).key, key)
    assert.ok(PAGE_LABELS[key])
  }
})

check('migration: additive, separate table, no writes to leads, no delete path', () => {
  assert.match(body, /create table if not exists public\.crm_records/)
  assert.match(body, /constraint crm_records_linked_lead_unique unique \(linked_lead_id\)/)
  assert.match(body, /references public\.sales_leads\(id\) on delete set null/)
  assert.doesNotMatch(body, /(update|insert into|delete from|alter table)\s+public\.sales_leads/i)
  assert.doesNotMatch(body, /\b(drop table|drop column|truncate|delete from)\b/i)
  assert.doesNotMatch(body, /for delete|grant [^;]*delete/i)
  assert.equal((body.match(/private\.is_admin\(\)/g) || []).length, 4)
  assert.match(body, /revoke all on public\.crm_records from anon, authenticated/)
})

console.log(`\n${passed} checks passed`)
