// Manual lead form source rule - sales_leads.source is NOT NULL with a fixed
// enum, so the form's payload must always carry an allowed value.
// Run with `node scripts/checkLeadPayload.mjs`.

import assert from 'node:assert/strict'
import { normalizeSourceForDb, serializeLeadForCreate } from '../src/services/leadPayload.js'
import { LEAD_SOURCES } from '../src/utils/leadStatus.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

check('a blank/missing source becomes "other", never null', () => {
  for (const raw of ['', '   ', null, undefined]) assert.equal(normalizeSourceForDb(raw), 'other')
})

check('every selectable source is kept as-is', () => {
  for (const s of LEAD_SOURCES) assert.equal(normalizeSourceForDb(s), s)
})

check('an unknown value never reaches the DB verbatim', () => {
  assert.ok(LEAD_SOURCES.includes(normalizeSourceForDb('something-else')))
})

check('create payload always has an allowed source', () => {
  assert.equal(serializeLeadForCreate({ company_name: 'نقش تندیس آریا' }).source, 'other')
})

console.log(`\n${passed} check(s) passed.`)
