-- Phase 23 - Autonomous Prospecting Engine: daily scheduler.
--
-- PREPARED ONLY. NOT APPLIED. NOT ACTIVATED.
--
-- Do NOT run section 4 (the actual cron.schedule call) until:
--   1. supabase/sql/phase23_autonomous_prospecting.sql has been applied and
--      verified.
--   2. supabase/functions/prospect-discovery has been deployed.
--   3. A manual invocation of that function has been tested and its
--      idempotency verified (run it twice, confirm no duplicate
--      candidates/leads - see the Phase 23 report's manual test list).
--   4. At least one real source's behavior has been checked (today, that
--      means the uploaded_dataset flow from /admin/prospecting - there is
--      no live external source configured yet).
--
-- Same pattern as supabase/sql/phase18a_automation_cron.sql: pg_cron -> pg_net
-- -> the deployed Edge Function -> a secret read from Vault at call time
-- (never written into cron.job's own text).

-- =============================================================================
-- 1. Extensions (idempotent - harmless if already enabled by Phase 18)
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- =============================================================================
-- 2. MANUAL STEP REQUIRED - store the scheduler secret in Vault.
--
-- The Edge Function secret PROSPECTING_CRON_SECRET must be set first:
--   supabase secrets set PROSPECTING_CRON_SECRET=<value>
-- (generate a value with `openssl rand -hex 32` - a DIFFERENT value than
-- AUTOMATION_CRON_SECRET, never reused across functions).
--
-- Then, in the Supabase Dashboard -> Project Settings -> Vault (NOT here,
-- NOT in chat): add a new secret named `prospecting_cron_secret` with that
-- exact same value.
--
-- Confirm it without ever revealing the value:

select id, name, created_at
from vault.secrets
where name = 'prospecting_cron_secret';

-- If this returns zero rows, stop here and complete the Dashboard step
-- above first.

-- =============================================================================
-- 3. SECURITY DEFINER wrapper function pg_cron schedules - the secret is
--    looked up INSIDE this function at call time, so it never appears in
--    cron.job or cron.job_run_details.
-- =============================================================================

create or replace function public.trigger_prospect_discovery()
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
  where name = 'prospecting_cron_secret';

  if v_secret is null then
    raise exception 'prospecting_cron_secret is not set in Vault';
  end if;

  perform net.http_post(
    url := 'https://xgdwswagpcaviwpbfysm.supabase.co/functions/v1/prospect-discovery',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-prospecting-secret', v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_prospect_discovery() from public, anon, authenticated;

-- =============================================================================
-- 4. DO NOT RUN YET - schedule once daily.
--
-- 01:30 UTC = 05:00 Asia/Tehran (fixed +03:30, no DST) - a low-traffic early
-- morning slot, matching "once per day initially" from the spec. Adjust the
-- hour if a different time is preferred; pg_cron schedules are always UTC.
--
-- Idempotent by job name: cron.schedule() updates an existing job with the
-- same name in place rather than duplicating it, so this is safe to re-run
-- once you DO activate it (e.g. to change the time later).
-- =============================================================================

-- select cron.schedule(
--   'hinza-prospect-discovery-daily',
--   '30 1 * * *',
--   $$select public.trigger_prospect_discovery();$$
-- );

-- =============================================================================
-- Verification (once activated)
-- =============================================================================

-- select jobid, jobname, schedule, active
-- from cron.job
-- where jobname = 'hinza-prospect-discovery-daily';

-- select runid, status, return_message, start_time, end_time
-- from cron.job_run_details
-- where jobid = (select jobid from cron.job where jobname = 'hinza-prospect-discovery-daily')
-- order by start_time desc
-- limit 20;

-- =============================================================================
-- Rollback - unschedule ONLY this job. Never touches prospect_candidates/
-- sales_leads data.
-- =============================================================================

-- select cron.unschedule('hinza-prospect-discovery-daily');
-- drop function if exists public.trigger_prospect_discovery();
