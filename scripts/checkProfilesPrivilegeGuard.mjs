// Phase 26d - profiles privilege-escalation fix: mocked LOGIC simulation.
//
// IMPORTANT / HONESTY NOTE: this sandbox has no local Postgres/Docker
// available (checked: no `docker`, no `psql`, no `supabase` CLI, no
// SUPABASE_DB_URL). The actual SQL in
// supabase/sql/phase26d_profiles_privilege_protection.sql has therefore
// NOT been executed against any real Postgres engine - it is UNTESTED at
// the SQL/trigger-execution level. What follows is a plain-JS re-encoding
// of the EXACT SAME conditional logic the trigger function and the
// outreach-send authorization check express, run as a decision-table
// unit test. It verifies the LOGIC is correct; it cannot verify Postgres
// actually executes it the way this file assumes (trigger firing order,
// auth.role()/auth.uid() availability in the real request context, etc.).
// No real provider/network calls are made anywhere in this file.

import assert from 'node:assert/strict'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

// ---------------------------------------------------------------------------
// Mirrors private.protect_profiles_privileged_columns() from
// phase26d_profiles_privilege_protection.sql, statement for statement:
//
//   if auth.role() = 'service_role' then return new; end if;
//   if (new.role is distinct from old.role) or (new.approval_status is distinct from old.approval_status) then
//     if private.is_admin() is not true then raise exception ...; end if;
//   end if;
//   return new;
//
// `is not true` (not bare `not ...`) is NULL-safe: `null is not true`
// evaluates to true, so a NULL from is_admin() still raises, matching
// `callerIsApprovedAdmin: null` below to `allowed: false`.
//
// `callerIsApprovedAdmin` stands in for whatever private.is_admin() would
// return for the CALLING session (documented contract: role='admin' AND
// approval_status='approved' on the caller's OWN row) - this file does not
// re-derive that from a caller profile object, since private.is_admin()
// itself is an existing, unmodified, already-verified function.
// ---------------------------------------------------------------------------
function protectProfilesPrivilegedColumns({ authRole, callerIsApprovedAdmin, oldRow, newRow }) {
  if (authRole === 'service_role') return { allowed: true }
  const roleChanged = newRow.role !== oldRow.role
  const approvalChanged = newRow.approval_status !== oldRow.approval_status
  if (roleChanged || approvalChanged) {
    // `callerIsApprovedAdmin is not true` - mirrors `is_admin() is not
    // true` exactly, including the NULL case (unlike a bare `!x`, which in
    // SQL's three-valued-logic equivalent would let a NULL slip through).
    if (callerIsApprovedAdmin !== true) {
      return { allowed: false, errorCode: '42501', errorMessage: 'Only an approved admin may change role or approval_status.' }
    }
  }
  return { allowed: true }
}

check('ordinary self-edit (full_name only, role/approval_status unchanged) is ALLOWED for a non-admin', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: false,
    oldRow: { id: 'u1', role: 'customer', approval_status: 'approved', full_name: 'Old Name' },
    newRow: { id: 'u1', role: 'customer', approval_status: 'approved', full_name: 'New Name' },
  })
  assert.equal(result.allowed, true)
})

check('self-promotion (customer sets own role=admin) is REJECTED', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: false, // the caller, checking their OWN current admin status, is not one
    oldRow: { id: 'u1', role: 'customer', approval_status: 'approved' },
    newRow: { id: 'u1', role: 'admin', approval_status: 'approved' },
  })
  assert.equal(result.allowed, false)
  assert.equal(result.errorCode, '42501')
})

check('self-approval (pending user sets own approval_status=approved) is REJECTED', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: false,
    oldRow: { id: 'u1', role: 'customer', approval_status: 'pending' },
    newRow: { id: 'u1', role: 'customer', approval_status: 'approved' },
  })
  assert.equal(result.allowed, false)
})

check('a non-admin changing role AND an ordinary field in the same statement is still REJECTED', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: false,
    oldRow: { id: 'u1', role: 'customer', approval_status: 'approved', full_name: 'x' },
    newRow: { id: 'u1', role: 'admin', approval_status: 'approved', full_name: 'y' },
  })
  assert.equal(result.allowed, false, 'bundling an innocuous field change must never smuggle a privileged column change through')
})

check('an approved admin changing ANOTHER user\'s role is ALLOWED (legitimate admin operation preserved)', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: true, // the CALLER is an approved admin, distinct from the row being modified
    oldRow: { id: 'other-user', role: 'customer', approval_status: 'approved' },
    newRow: { id: 'other-user', role: 'admin', approval_status: 'approved' },
  })
  assert.equal(result.allowed, true)
})

check('an approved admin approving another user\'s approval_status is ALLOWED', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: true,
    oldRow: { id: 'other-user', role: 'customer', approval_status: 'pending' },
    newRow: { id: 'other-user', role: 'customer', approval_status: 'approved' },
  })
  assert.equal(result.allowed, true)
})

check('an approved admin demoting themselves is ALLOWED (not a privilege-escalation risk)', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: true,
    oldRow: { id: 'u1', role: 'admin', approval_status: 'approved' },
    newRow: { id: 'u1', role: 'customer', approval_status: 'approved' },
  })
  assert.equal(result.allowed, true)
})

check('a trusted server (service_role) operation changing approval_status is ALLOWED regardless of is_admin()', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'service_role',
    callerIsApprovedAdmin: false, // deliberately false - must still pass, since service_role is exempt structurally
    oldRow: { id: 'new-customer', role: 'customer', approval_status: 'pending' },
    newRow: { id: 'new-customer', role: 'customer', approval_status: 'approved' },
  })
  assert.equal(result.allowed, true, 'a trusted server-side reconciliation (e.g. registration_requests -> profiles.approval_status) must never be blocked by this guard')
})

check('NULL-safety: if is_admin() ever returned NULL (not just false), the guard still blocks a role/approval_status change ("is not true", not bare "not ...")', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'authenticated',
    callerIsApprovedAdmin: null,
    oldRow: { id: 'u1', role: 'customer', approval_status: 'approved' },
    newRow: { id: 'u1', role: 'admin', approval_status: 'approved' },
  })
  assert.equal(result.allowed, false, 'a bare `not null` is NULL in three-valued logic and would silently skip the raise - `is not true` must not')
})

check('anon has no meaningful path here (authRole never service_role/authenticated) - non-admin rule still applies if reached', () => {
  const result = protectProfilesPrivilegedColumns({
    authRole: 'anon',
    callerIsApprovedAdmin: false,
    oldRow: { id: 'u1', role: 'customer', approval_status: 'approved' },
    newRow: { id: 'u1', role: 'admin', approval_status: 'approved' },
  })
  assert.equal(result.allowed, false)
})

// ---------------------------------------------------------------------------
// Mirrors the outreach-send Edge Function's authenticateAdmin() check
// (supabase/functions/outreach-send/index.ts) exactly:
//   if (profile?.role !== 'admin' || profile?.approval_status !== 'approved') return null
// ---------------------------------------------------------------------------
function isAuthorizedForOutreachSend(profile) {
  return profile?.role === 'admin' && profile?.approval_status === 'approved'
}

check('outreach-send: role=admin + approval_status=approved is AUTHORIZED', () => {
  assert.equal(isAuthorizedForOutreachSend({ role: 'admin', approval_status: 'approved' }), true)
})

check('outreach-send: role=admin + approval_status=pending is REJECTED (the exact gap this fix closes)', () => {
  assert.equal(isAuthorizedForOutreachSend({ role: 'admin', approval_status: 'pending' }), false)
})

check('outreach-send: role=admin + approval_status=suspended/rejected is REJECTED', () => {
  assert.equal(isAuthorizedForOutreachSend({ role: 'admin', approval_status: 'rejected' }), false)
  assert.equal(isAuthorizedForOutreachSend({ role: 'admin', approval_status: 'suspended' }), false)
})

check('outreach-send: role=customer + approval_status=approved is REJECTED', () => {
  assert.equal(isAuthorizedForOutreachSend({ role: 'customer', approval_status: 'approved' }), false)
})

check('outreach-send: no profile row found is REJECTED', () => {
  assert.equal(isAuthorizedForOutreachSend(null), false)
  assert.equal(isAuthorizedForOutreachSend(undefined), false)
})

console.log(`\n${passed} check(s) passed.`)
console.log('\nNOTE: the above verifies LOGIC only (plain JS decision tables mirroring the SQL/TS conditionals).')
console.log('The actual SQL trigger in phase26d_profiles_privilege_protection.sql has NOT been executed against')
console.log('any real Postgres engine - no local Postgres/Docker/Supabase CLI was available in this sandbox.')
