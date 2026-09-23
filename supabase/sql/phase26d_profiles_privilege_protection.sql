-- Phase 26d - profiles privilege-escalation fix (confirmed live finding).
--
-- PREPARED ONLY. NOT APPLIED. VERIFY BEFORE RUNNING ANYTHING BELOW. Same
-- "prepared, reviewed and run by hand in the SQL editor, statement by
-- statement" convention as every prior phase's SQL file in this directory.
--
-- CONFIRMED LIVE FINDING (queried directly against production, not
-- guessed): public.profiles has RLS enabled, and its one authenticated
-- UPDATE policy reads:
--   USING:      auth.uid() = id OR private.is_admin()
--   WITH CHECK: auth.uid() = id OR private.is_admin()
-- That policy governs which ROW may be targeted/written, not which COLUMNS
-- change within it - so today, ANY signed-in user can run
--   update profiles set role = 'admin' where id = auth.uid()
-- or
--   update profiles set approval_status = 'approved' where id = auth.uid()
-- and it passes, because auth.uid() = id is satisfied regardless of what
-- the statement's SET list contains. This is a genuine, live privilege-
-- escalation path (self-promotion to admin, and self-approval bypassing
-- whatever the real registration-approval flow is meant to be) - not a
-- theoretical one.
--
-- WHY A TRIGGER, NOT A REWRITTEN POLICY: Postgres RLS policies (USING /
-- WITH CHECK) only ever see the row being read/written - there is no OLD
-- vs NEW comparison available inside a policy expression the way a normal
-- CHECK constraint might imply. Detecting "did role or approval_status
-- specifically CHANGE" requires OLD/NEW, which only a trigger has. This is
-- also why THE EXISTING authenticated UPDATE policy is left completely
-- untouched below - it is not wrong for what it governs (row ownership /
-- admin row access), it is simply not the right mechanism for a
-- column-change rule, and this file never even needs to know that
-- policy's name to add the missing protection on top of it.
--
-- WHY private.is_admin() ITSELF IS NOT TOUCHED: it already exists, is
-- SECURITY DEFINER with search_path='', and already encodes the correct,
-- stricter bar (role='admin' AND approval_status='approved') - this file
-- only CALLS it (as a black box, per its documented contract), never
-- redefines it. Same reasoning applies to the existing authenticated
-- UPDATE policy and to the pre-existing set_profiles_updated_at trigger -
-- neither is touched.
--
-- TRUSTED SERVER OPERATIONS ARE PRESERVED STRUCTURALLY, NOT BY GUESSING
-- WHAT THEY DO: whatever currently reconciles registration_requests.status
-- = 'approved' into profiles.approval_status (untracked in this repo, so
-- its exact definition was not inspected or assumed) almost certainly runs
-- under the service-role key or an equivalent trusted context, which is
-- why the guard below explicitly exempts auth.role() = 'service_role' -
-- not because this file knows what that flow does, but because ANY
-- legitimate trusted-server write already goes through that role, and
-- auth.role() reflects the JWT's own role claim regardless of this
-- function's SECURITY DEFINER context.

-- =============================================================================
-- Verify BEFORE applying anything below, in this order.
-- =============================================================================

-- 1. Re-confirm the current authenticated UPDATE policy is still the one
--    described above (it is NOT modified by this file, but if it has
--    since changed to something narrower, this trigger becomes purely
--    additive defense-in-depth rather than the primary fix):
-- select policyname, cmd, qual, with_check
-- from pg_policies where tablename = 'profiles';

-- 2. Confirm private.is_admin()'s existing behavior is what this file
--    assumes (SECURITY DEFINER, search_path='', checks role='admin' AND
--    approval_status='approved' on the CALLER's own row):
-- select proname, prosecdef, proconfig
-- from pg_proc where proname = 'is_admin' and pronamespace = 'private'::regnamespace;

-- 3. Confirm profiles.role's current grantees (the live finding this file
--    exists to fix):
-- select grantee, privilege_type
-- from information_schema.role_column_grants
-- where table_schema = 'public' and table_name = 'profiles' and column_name in ('role', 'approval_status');

-- =============================================================================
-- Fix, part 1: close the unnecessary anon UPDATE grant on profiles.
--
-- anon (never signed in) has no legitimate reason to update ANY profile
-- row - every genuine self-edit requires being authenticated. The existing
-- RLS policy (auth.uid() = id OR private.is_admin()) already blocks anon
-- in practice (auth.uid() is null for anon, and private.is_admin() looks
-- up the caller's own row by that same null uid), but relying solely on
-- that is fragile defense - a wide-open GRANT is unnecessary attack
-- surface regardless of what RLS currently does. This does not affect
-- authenticated, service_role, or any existing self-edit flow.
-- =============================================================================

revoke update on public.profiles from anon;

-- =============================================================================
-- Fix, part 2: the actual privilege-escalation guard.
--
-- A BEFORE UPDATE trigger, not a policy - see the header comment for why.
-- It ONLY ever blocks a statement that is CHANGING role or
-- approval_status; every ordinary self-edit (full_name, phone, or whatever
-- other columns exist) that leaves both of those columns unchanged is
-- completely unaffected and continues to work exactly as it does today,
-- regardless of what those other columns are - this file does not need to
-- (and does not) enumerate or guess the full profiles schema.
-- =============================================================================

create or replace function private.protect_profiles_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trusted server-side operations (the service-role key - what every Edge
  -- Function in this project uses, and almost certainly what reconciles
  -- registration_requests -> profiles.approval_status) are never subject
  -- to this guard; RLS itself is already bypassed for service_role, and
  -- this trigger deliberately mirrors that same trust boundary rather than
  -- introducing a new, narrower one.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (new.role is distinct from old.role) or (new.approval_status is distinct from old.approval_status) then
    -- `is not true`, not bare `not ...` - NULL-safe: if is_admin() were ever
    -- to return NULL (e.g. the caller's own profiles row is missing), a
    -- bare `not null` evaluates to NULL, and plpgsql's `if null then`
    -- silently skips the branch - the exception would never fire and the
    -- change would go through. `null is not true` evaluates to true, so
    -- this raises in that case too, exactly as it does for a plain false.
    if private.is_admin() is not true then
      raise exception 'Only an approved admin may change role or approval_status.'
        using errcode = '42501'; -- insufficient_privilege
    end if;
  end if;

  return new;
end;
$$;

comment on function private.protect_profiles_privileged_columns() is
  'Phase 26d: blocks any change to profiles.role/approval_status from a non-service-role session unless the CALLER (not the row owner) is currently an approved admin per private.is_admin(). Prevents self-promotion (a customer setting their own role=admin) and self-approval (a pending user setting their own approval_status=approved) while leaving every other column, and every other existing policy/trigger on this table, untouched.';

drop trigger if exists protect_profiles_privileged_columns on public.profiles;
create trigger protect_profiles_privileged_columns
  before update on public.profiles
  for each row
  execute function private.protect_profiles_privileged_columns();

-- =============================================================================
-- Verification (safe to run any time, reveals no secrets/customer data)
-- =============================================================================

-- select tgname, tgrelid::regclass as table_name, pg_get_triggerdef(oid) as definition
-- from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'profiles' and grantee = 'anon';

-- =============================================================================
-- Rollback - removes ONLY what this file added. Never touches the
-- pre-existing authenticated UPDATE policy, private.is_admin(), or
-- set_profiles_updated_at.
-- =============================================================================

-- drop trigger if exists protect_profiles_privileged_columns on public.profiles;
-- drop function if exists private.protect_profiles_privileged_columns();
-- grant update on public.profiles to anon; -- only if anon genuinely needs it again - it should not
