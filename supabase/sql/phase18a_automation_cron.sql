-- Phase 18B - Automation Reconciliation Cron wiring.
--
-- PREPARED ONLY. NOT APPLIED. This file lives outside supabase/migrations/
-- on purpose, so it is never picked up automatically by `supabase db push`
-- / CI - it is meant to be reviewed and run by hand, statement by
-- statement, in the SQL editor, ONLY after the manual Vault step below has
-- been completed (see "MANUAL STEP REQUIRED").
--
-- Target: every 30 minutes, call the automation-reconcile Edge Function via
-- pg_net, authenticated with a shared secret stored in Vault (never in the
-- cron job's own SQL text, which is visible to anyone who can read
-- cron.job).
--
-- Project ref: xgdwswagpcaviwpbfysm (from supabase/.temp/linked-project.json
-- - this is the project's public URL segment, not a credential).

-- =============================================================================
-- 1. Extensions (idempotent - safe to run even if already enabled)
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- =============================================================================
-- 2. MANUAL STEP REQUIRED - store the scheduler secret in Vault.
--
-- Do NOT paste the secret value into any SQL file or into Claude chat.
-- The Edge Function secret AUTOMATION_CRON_SECRET already exists; Vault
-- needs the SAME value under its own name (the Vault entry's "name" below
-- is just an arbitrary label used to look it up from SQL - it does not
-- need to match the Edge Function secret's name).
--
-- Do this once, by hand, in the Supabase Dashboard:
--   1. Open the project (hinza-sales-desk) -> Project Settings -> Vault.
--      (Older dashboard versions: Database -> Vault.)
--   2. Click "Add new secret".
--   3. Name:  automation_cron_secret
--      Value: the exact same value you set with
--             `supabase secrets set AUTOMATION_CRON_SECRET=<value>`
--             (if you no longer have that value handy, rotate both sides
--             together: generate a new value with `openssl rand -hex 32`,
--             set it in Vault via the Dashboard, then run
--             `supabase secrets set AUTOMATION_CRON_SECRET=<new value>`
--             and redeploy the function so both sides match again).
--   4. Save.
--
-- This is a UI action, not SQL - nothing about it gets committed to the
-- repo. Only continue to section 3+ below after this is done.
--
-- To confirm it worked WITHOUT ever revealing the value, run:

select id, name, created_at
from vault.secrets
where name = 'automation_cron_secret';

-- If this returns zero rows, stop here and complete the Dashboard step
-- above first. Everything below assumes it returns exactly one row.

-- =============================================================================
-- 3. A SECURITY DEFINER wrapper function that pg_cron schedules.
--
-- pg_cron jobs are scheduled by TEXT, and that text (and any http_post
-- payload written directly into it) is visible via cron.job to anyone with
-- sufficient catalog access. Keeping the secret lookup INSIDE this function
-- (reading it fresh from Vault at call time) means the secret itself never
-- appears in cron.job or cron.job_run_details.
-- =============================================================================

create or replace function public.trigger_automation_reconcile()
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
  where name = 'automation_cron_secret';

  if v_secret is null then
    raise exception 'automation_cron_secret is not set in Vault';
  end if;

  perform net.http_post(
    url := 'https://xgdwswagpcaviwpbfysm.supabase.co/functions/v1/automation-reconcile',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-automation-secret', v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- Only allow this to be invoked by the cron job itself / privileged roles -
-- never grant execute to anon/authenticated.
revoke all on function public.trigger_automation_reconcile() from public, anon, authenticated;

-- =============================================================================
-- 4. Schedule it every 30 minutes.
--
-- DO NOT RUN THIS until section 2's verification query returns one row
-- (i.e. the Vault secret has been confirmed via the Dashboard). Activating
-- the schedule before that just produces 30-minute-interval failures with
-- nothing valid to authenticate with.
--
-- cron.schedule() is idempotent by job name: as of pg_cron 1.4+, calling it
-- again with the same jobname updates the existing job in place instead of
-- creating a duplicate, so this is safe to re-run.
-- =============================================================================

select cron.schedule(
  'hinza-automation-reconcile-30m',
  '*/30 * * * *',
  $$select public.trigger_automation_reconcile();$$
);

-- =============================================================================
-- 5. Verification queries (safe to run any time, reveal no secrets)
-- =============================================================================

-- Job exists, is active, and has the expected schedule:
select jobid, jobname, schedule, active
from cron.job
where jobname = 'hinza-automation-reconcile-30m';

-- Recent run history / failures (most recent first):
select runid, jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'hinza-automation-reconcile-30m')
order by start_time desc
limit 20;

-- Recent pg_net request outcomes (status_code only - never logs headers/body,
-- so the secret is never exposed here either). Available once pg_net has
-- processed at least one request from this job:
select id, status_code, created, error_msg
from net._http_response
order by created desc
limit 20;

-- =============================================================================
-- 6. Rollback - unschedule ONLY this cron job. Does not touch
--    automation_tasks/automation_task_events or any other automation data.
-- =============================================================================

select cron.unschedule('hinza-automation-reconcile-30m');

-- Optional, only if you also want to remove the trigger function and its
-- Vault entry (not required for a simple pause/rollback of the schedule):
-- drop function if exists public.trigger_automation_reconcile();
-- select vault.delete_secret((select id from vault.secrets where name = 'automation_cron_secret'));
