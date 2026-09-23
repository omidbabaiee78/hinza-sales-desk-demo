-- Phase 26c - automation_settings RLS gap check (safety review follow-up).
--
-- PREPARED ONLY. NOT APPLIED. VERIFY BEFORE RUNNING ANYTHING BELOW.
--
-- WHY: no migration file anywhere in this repo's supabase/sql history
-- enables row level security on public.automation_settings, and none
-- creates a policy for it either - unlike outreach_attempts /
-- prospect_outreach_suggestions / prospect_sources / prospect_candidates /
-- prospect_evidence / prospect_settings / prospect_discovery_runs /
-- prospect_outreach_runs, which EACH explicitly `enable row level security`
-- plus an admin-only policy (see phase19_outreach_hub.sql,
-- phase23_autonomous_prospecting.sql, phase25_shadow_outreach.sql).
--
-- automation_settings holds outreach_enabled, provider_test_mode,
-- whatsapp_provider_enabled, email_provider_enabled, outreach_cooldown_hours
-- and max_contact_attempts - i.e. EVERY application-layer safety gate
-- src/outreach/sendGate.js reads comes straight from this one row. If RLS
-- is not already enabled on it in the live database (it may well have been
-- set up by hand in the Supabase dashboard when the table was first
-- created, outside anything tracked in this repo - this could not be
-- verified from this sandbox, which has no live DB/CLI access), then any
-- authenticated (non-admin) user could read AND WRITE this table directly
-- via PostgREST - e.g. flipping outreach_enabled=true or
-- provider_test_mode=false - completely bypassing every gate this phase
-- built, without ever touching the outreach-send Edge Function at all.
--
-- Likewise, this repo has NO tracked CREATE TABLE or RLS policy for
-- public.profiles at all - every "admin-only" policy in every phase
-- (including the one below) trusts `profiles.role = 'admin'` implicitly,
-- but nothing here defines who is allowed to WRITE profiles.role in the
-- first place. That must be verified directly against the live schema; a
-- policy was not drafted here without first seeing the table's real
-- definition (this repo has never tracked it, so a guessed policy risks
-- being wrong or overly permissive/restrictive).
--
-- RUN THIS FIRST, to check whether the automation_settings gap actually
-- exists in production, before applying anything below:
--
-- select relrowsecurity from pg_class where relname = 'automation_settings';
-- select polname, polcmd from pg_policy where polrelid = 'public.automation_settings'::regclass;
--
-- And separately, for profiles (run manually, review the result - do not
-- apply a policy here blind):
--
-- select relrowsecurity from pg_class where relname = 'profiles';
-- select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as with_check_expr
-- from pg_policy where polrelid = 'public.profiles'::regclass;

-- =============================================================================
-- Fix (idempotent - safe to run even if RLS is already enabled by hand;
-- `enable row level security` and `drop policy if exists` are both no-ops
-- in that case). Only run this AFTER the verification queries above
-- confirm the gap is real.
-- =============================================================================

alter table public.automation_settings enable row level security;

drop policy if exists automation_settings_admin_all on public.automation_settings;
create policy automation_settings_admin_all
  on public.automation_settings
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- =============================================================================
-- Rollback
-- =============================================================================

-- drop policy if exists automation_settings_admin_all on public.automation_settings;
-- Do NOT blindly `disable row level security` on rollback - only do so if
-- you are certain nothing else now depends on RLS being enabled here.
