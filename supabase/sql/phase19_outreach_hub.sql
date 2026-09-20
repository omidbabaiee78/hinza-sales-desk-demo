-- Phase 19 - Prospecting & Outreach Hub: database additions.
--
-- PREPARED ONLY. Not applied automatically (no supabase/migrations/ pipeline
-- exists in this project - every prior phase's schema change has been run
-- by hand in the SQL editor, same as supabase/sql/phase18a_automation_cron.sql).
-- Review and run statement-by-statement.
--
-- Everything here is additive:
--   - new nullable/defaulted columns on automation_settings (existing row
--     id=1 is backfilled by the DEFAULT automatically, nothing else changes)
--   - one new table, outreach_attempts, admin-only via RLS
-- No existing table is altered destructively, no existing row is deleted,
-- no existing column is dropped/renamed.

-- =============================================================================
-- 1. automation_settings - contact window + anti-spam config, centralized
--    here instead of scattered magic numbers in the frontend.
-- =============================================================================

-- contact_window_start/contact_window_end already exist in production as
-- `time without time zone` (default 09:00/18:00) - added here with the same
-- type only so a fresh/other environment without them yet gets the correct
-- type too; on production this is a true no-op (column already exists).
alter table public.automation_settings
  add column if not exists timezone text not null default 'Asia/Tehran';

alter table public.automation_settings
  add column if not exists contact_window_start time without time zone not null default '09:00';

alter table public.automation_settings
  add column if not exists contact_window_end time without time zone not null default '18:00';

alter table public.automation_settings
  add column if not exists outreach_cooldown_hours integer not null default 20;

alter table public.automation_settings
  add column if not exists max_contact_attempts integer not null default 6;

do $$
begin
  -- No separate 0-23 range check needed for either column - `time without
  -- time zone` already only ever holds a valid time of day, by the type
  -- itself. The only business rule worth enforcing here is ordering.
  if not exists (
    select 1 from pg_constraint where conname = 'automation_settings_contact_window_end_check'
  ) then
    alter table public.automation_settings
      add constraint automation_settings_contact_window_end_check
      check (contact_window_end > contact_window_start);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'automation_settings_outreach_cooldown_hours_check'
  ) then
    alter table public.automation_settings
      add constraint automation_settings_outreach_cooldown_hours_check
      check (outreach_cooldown_hours > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'automation_settings_max_contact_attempts_check'
  ) then
    alter table public.automation_settings
      add constraint automation_settings_max_contact_attempts_check
      check (max_contact_attempts > 0);
  end if;
end $$;

-- =============================================================================
-- 2. outreach_attempts - audit trail of real admin actions taken from the
--    Outreach Hub (WhatsApp opened / SMS copied / phone call completed /
--    email opened). Never written automatically by reconciliation - only by
--    an explicit admin action. Generic enough (lead_id OR company_id) to
--    later cover customer outreach too, without a schema rewrite.
-- =============================================================================

create table if not exists public.outreach_attempts (
  id uuid primary key default gen_random_uuid(),
  source_task_id uuid references public.automation_tasks(id) on delete set null,
  lead_id uuid references public.sales_leads(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'phone', 'sms', 'email')),
  purpose text not null,
  message_snapshot text,
  subject_snapshot text,
  execution_mode text not null default 'manual' check (execution_mode in ('manual', 'provider')),
  status text not null default 'prepared' check (status in ('prepared', 'opened', 'copied', 'completed', 'failed', 'cancelled')),
  external_message_id text,
  failure_reason text,
  opened_at timestamptz,
  acted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_attempts_has_target check (lead_id is not null or company_id is not null)
);

create index if not exists outreach_attempts_lead_id_idx on public.outreach_attempts (lead_id, created_at desc);
create index if not exists outreach_attempts_source_task_id_idx on public.outreach_attempts (source_task_id);
create index if not exists outreach_attempts_company_id_idx on public.outreach_attempts (company_id, created_at desc);

alter table public.outreach_attempts enable row level security;

-- Admin-only, same "profiles.role = 'admin'" shape the app's existing
-- admin/customer split already relies on (see src/hooks/useProfile.js).
drop policy if exists outreach_attempts_admin_all on public.outreach_attempts;
create policy outreach_attempts_admin_all
  on public.outreach_attempts
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- =============================================================================
-- Verification (safe to run any time)
-- =============================================================================

-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'automation_settings'
-- order by ordinal_position;

-- select * from public.outreach_attempts order by created_at desc limit 20;

-- =============================================================================
-- Rollback - removes ONLY what this file added, never automation_tasks/
-- sales_leads data. timezone/contact_window_start/contact_window_end are
-- NOT dropped here - production already had them before this file ever ran,
-- so they are not this file's to remove.
-- =============================================================================

-- drop table if exists public.outreach_attempts;
-- alter table public.automation_settings drop column if exists outreach_cooldown_hours;
-- alter table public.automation_settings drop column if exists max_contact_attempts;
-- alter table public.automation_settings drop constraint if exists automation_settings_contact_window_end_check;
-- alter table public.automation_settings drop constraint if exists automation_settings_outreach_cooldown_hours_check;
-- alter table public.automation_settings drop constraint if exists automation_settings_max_contact_attempts_check;
