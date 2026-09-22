-- Phase 25 - Autonomous Outreach SHADOW MODE: daily scheduler.
--
-- Phase 25.5: ACTIVATED - all prerequisites below were verified first:
--   1. supabase/sql/phase25_shadow_outreach.sql applied and verified.
--   2. supabase/functions/outreach-shadow deployed (v1).
--   3. A manual server-side test run (manualTest) was performed TWICE and
--      verified: zero real outbound communications, dedupe/idempotency held
--      on the second run (Phase 25 STEP 14).
-- This activates ONLY suggestion generation - outreach_enabled stays false,
-- and no channel adapter's execute() can be called regardless (see
-- src/outreach/channels/*.js).
--
-- Same pattern as supabase/sql/phase23_prospecting_cron.sql: pg_cron ->
-- pg_net -> the deployed Edge Function -> a secret read from Vault at call
-- time (never written into cron.job's own text). A DEDICATED secret name
-- (outreach_shadow_cron_secret) - never reused from prospecting_cron_secret
-- or automation_cron_secret.

-- =============================================================================
-- 1. Extensions (idempotent - harmless if already enabled)
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- =============================================================================
-- 2. MANUAL STEP REQUIRED - store the scheduler secret in Vault.
--
-- The Edge Function secret OUTREACH_SHADOW_CRON_SECRET must be set first:
--   supabase secrets set OUTREACH_SHADOW_CRON_SECRET=<value>
-- (generate with `openssl rand -hex 32` - a value DIFFERENT from every
-- other secret in this project).
--
-- Then, in the Supabase Dashboard -> Project Settings -> Vault: add a new
-- secret named `outreach_shadow_cron_secret` with that exact same value.
--
-- Confirm it without ever revealing the value:

select id, name, created_at
from vault.secrets
where name = 'outreach_shadow_cron_secret';

-- If this returns zero rows, stop here and complete the Dashboard step
-- above first.

-- =============================================================================
-- 3. SECURITY DEFINER wrapper function pg_cron schedules.
-- =============================================================================

create or replace function public.trigger_outreach_shadow()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'outreach_shadow_cron_secret';

  if v_secret is null then
    raise exception 'outreach_shadow_cron_secret is not set in Vault';
  end if;

  perform net.http_post(
    url := 'https://xgdwswagpcaviwpbfysm.supabase.co/functions/v1/outreach-shadow',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-outreach-shadow-secret', v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_outreach_shadow() from public, anon, authenticated;

-- =============================================================================
-- 4. Schedule once daily, AFTER daily prospecting.
--
-- Daily prospecting runs at 05:00 UTC (08:30 Asia/Tehran, fixed +03:30, no
-- DST - see phase23_prospecting_cron.sql). This job is offset 30 minutes
-- later, 05:30 UTC (09:00 Asia/Tehran, Phase 25.5), so newly promoted leads
-- from that run are already in sales_leads before this scans for them.
-- Verified directly against the database before choosing this expression:
-- `current_setting('TIMEZONE')` = UTC, `current_setting('cron.timezone')` =
-- GMT, so pg_cron evaluates this schedule in UTC/GMT - 09:00 - 03:30 = 05:30.
-- =============================================================================

select cron.schedule(
  'hinza-daily-outreach-shadow',
  '30 5 * * *',
  $$select public.trigger_outreach_shadow();$$
);

-- =============================================================================
-- Verification (once activated)
-- =============================================================================

-- select jobid, jobname, schedule, active
-- from cron.job
-- where jobname = 'hinza-daily-outreach-shadow';

-- select runid, status, return_message, start_time, end_time
-- from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname = 'hinza-daily-outreach-shadow')
-- order by start_time desc
-- limit 20;

-- =============================================================================
-- Rollback - unschedule ONLY this job. Never touches
-- prospect_outreach_suggestions/prospect_outreach_runs data.
-- =============================================================================

-- select cron.unschedule('hinza-daily-outreach-shadow');
-- drop function if exists public.trigger_outreach_shadow();
