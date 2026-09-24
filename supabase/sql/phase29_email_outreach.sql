-- Phase 29 - Email outreach: one intro per ADDRESS, run log, provider
-- delivery status, schedule visibility. Additive only - no table is
-- dropped and no existing row is deleted or rewritten (the only UPDATE is
-- the per-run limit, see 4.).

-- 1. One row per normalized recipient address that has ever been claimed
--    for an automatic intro. The PRIMARY KEY is the cross-lead, cross-run,
--    cross-job duplicate guard: a send is only attempted by whoever inserts
--    the row. Written by the outreach-auto-email function (service role);
--    admins can read it.
create table if not exists public.email_outreach_recipients (
  normalized_email text primary key check (normalized_email = lower(btrim(normalized_email)) and normalized_email like '%@%'),
  lead_id uuid references public.sales_leads(id) on delete set null,
  suggestion_id uuid references public.prospect_outreach_suggestions(id) on delete set null,
  status text not null check (status in ('claimed', 'sent', 'failed', 'uncertain')),
  provider_message_id text,
  note text,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_outreach_recipients enable row level security;
drop policy if exists email_outreach_recipients_admin_read on public.email_outreach_recipients;
create policy email_outreach_recipients_admin_read on public.email_outreach_recipients for select using (private.is_admin());

-- Seed from real (non-test) email send history so an address that was
-- already emailed - or whose delivery is unknown - is never emailed again.
insert into public.email_outreach_recipients (normalized_email, lead_id, suggestion_id, status, provider_message_id, note, claimed_at)
select distinct on (lower(btrim(l.email)))
  lower(btrim(l.email)),
  a.lead_id,
  a.suggestion_id,
  case when a.status = 'sent' then 'sent' else 'uncertain' end,
  a.external_message_id,
  'seeded from outreach_attempts (phase29)',
  a.created_at
from public.outreach_attempts a
join public.sales_leads l on l.id = a.lead_id
where a.channel = 'email'
  and coalesce(a.test_mode, false) = false
  and a.status in ('sent', 'prepared')
  and a.idempotency_key like 'send:%'
  and l.email is not null
  and lower(btrim(l.email)) like '%@%'
order by lower(btrim(l.email)), (a.status = 'sent') desc, a.created_at
on conflict (normalized_email) do nothing;

-- 2. One row per run (cron or admin "Run now") - what the Overview shows.
create table if not exists public.email_outreach_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'admin')),
  status text not null default 'running' check (status in ('running', 'completed', 'skipped', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  leads_scanned integer not null default 0,
  queued integer not null default 0,
  sent integer not null default 0,
  duplicates_skipped integer not null default 0,
  failed integer not null default 0,
  uncertain integer not null default 0,
  report jsonb not null default '{}'::jsonb
);

create index if not exists email_outreach_runs_started_at_idx on public.email_outreach_runs (started_at desc);
alter table public.email_outreach_runs enable row level security;
drop policy if exists email_outreach_runs_admin_read on public.email_outreach_runs;
create policy email_outreach_runs_admin_read on public.email_outreach_runs for select using (private.is_admin());

-- 3. Provider delivery status (Resend last_event: delivered, bounced, ...).
alter table public.outreach_attempts add column if not exists provider_status text;
alter table public.outreach_attempts add column if not exists provider_status_at timestamptz;

-- 4. Per-run limit: default 1 until the workflow has been observed live.
alter table public.automation_settings alter column auto_email_max_per_run set default 1;
update public.automation_settings set auto_email_max_per_run = 1 where id = 1;

-- 5. Admin-only view of the email cron job (the cron schema is not
--    exposed to the API).
create or replace function public.email_outreach_schedule()
returns table (schedule text, active boolean, last_run_at timestamptz, last_run_status text)
language plpgsql
security definer
set search_path = public, cron
as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed';
  end if;
  return query
    select j.schedule::text, j.active,
      (select d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
      (select d.status::text from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1)
    from cron.job j
    where j.jobname = 'hinza-auto-intro-email';
end;
$$;

revoke all on function public.email_outreach_schedule() from public, anon;
grant execute on function public.email_outreach_schedule() to authenticated;

-- Rollback (keeps data unless you drop the tables yourself):
-- drop function if exists public.email_outreach_schedule();
-- alter table public.outreach_attempts drop column if exists provider_status_at;
-- alter table public.outreach_attempts drop column if exists provider_status;
-- drop table if exists public.email_outreach_runs;
-- drop table if exists public.email_outreach_recipients;
