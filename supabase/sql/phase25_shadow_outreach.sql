-- Phase 25 - Autonomous Outreach SHADOW MODE: database additions.
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, reviewed and run by hand in
-- the SQL editor, statement by statement" pattern as every prior phase's SQL
-- file in this directory.
--
-- Everything here is additive: two new tables (admin-only via RLS, same
-- shape as outreach_attempts/prospect_* from Phase 19/23) plus three new
-- automation_settings columns, all with SAFE, FAIL-CLOSED defaults. No
-- existing table/column/row is altered, dropped, or renamed. Nothing here
-- can ever cause a real message to be sent - every outreach channel adapter
-- (src/outreach/channels/*.js) has its execute() function structurally
-- disabled (it throws) regardless of any setting in this file; that has
-- been true since Phase 19 and Phase 25 does not change it.

-- =============================================================================
-- 1. automation_settings - three new SHADOW MODE columns.
-- =============================================================================

alter table public.automation_settings
  add column if not exists shadow_mode boolean not null default true;

comment on column public.automation_settings.shadow_mode is
  'Phase 25: when true (the only supported value today), the autonomous outreach runner only ever generates/persists suggestions - it never calls any channel adapter''s execute(). Kept as an explicit, visible flag even though execute() is ALSO structurally disabled at the code level (defense in depth, not the only safeguard).';

alter table public.automation_settings
  add column if not exists outreach_enabled boolean not null default false;

comment on column public.automation_settings.outreach_enabled is
  'Phase 25: real outreach SENDING kill switch. Defaults false and MUST stay false until a real provider is actually connected (Phase 26+) - no code in this repository currently does anything with this flag other than read it, since no send path exists yet. Fail closed: this being true does NOT by itself enable sending anything.';

alter table public.automation_settings
  add column if not exists max_suggestions_per_run integer not null default 20;

comment on column public.automation_settings.max_suggestions_per_run is
  'Phase 25: hard cap on how many NEW prospect_outreach_suggestions rows one shadow run may insert - a safety limit, independent of how many leads were scanned/eligible.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'automation_settings_max_suggestions_per_run_check'
  ) then
    alter table public.automation_settings
      add constraint automation_settings_max_suggestions_per_run_check
      check (max_suggestions_per_run > 0);
  end if;
end $$;

-- =============================================================================
-- 2. prospect_outreach_runs - one audit row per shadow evaluation run
--    (manual or scheduled), same shape/spirit as prospect_discovery_runs.
-- =============================================================================

create table if not exists public.prospect_outreach_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null default 'manual' check (run_type in ('manual', 'scheduled')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  leads_scanned integer not null default 0,
  eligible_count integer not null default 0,
  waiting_count integer not null default 0,
  blocked_count integer not null default 0,
  manual_review_count integer not null default 0,
  suggestions_created integer not null default 0,
  duplicates_skipped integer not null default 0,
  errors_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists prospect_outreach_runs_started_at_idx on public.prospect_outreach_runs (started_at desc);

-- Concurrency guard, same pattern as Phase 24's
-- prospect_discovery_runs_one_running_scheduled - the PRIMARY guard is the
-- application-level check in outreachShadowPipeline.js; this is a real-DB
-- backstop for the true-simultaneous-race case, never exercised by the
-- in-memory fake-client regression suite.
create unique index if not exists prospect_outreach_runs_one_running_scheduled
  on public.prospect_outreach_runs (run_type)
  where run_type = 'scheduled' and status = 'running';

-- =============================================================================
-- 3. prospect_outreach_suggestions - the persisted SHADOW MODE outreach
--    queue for prospecting-sourced leads. Deliberately a SEPARATE table from
--    crm_message_suggestions (that table is company/order/invoice-scoped -
--    the "Messaging Brain" for EXISTING customers - a different domain with
--    a different engine, src/messagingRules/*). This table is lead-scoped,
--    prospecting-shadow-specific, and every row here can ONLY ever reach
--    'approved'/'edited' (approved-for-future-send) - nothing in this
--    codebase can flip a row here into an actually-sent state.
-- =============================================================================

create table if not exists public.prospect_outreach_suggestions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  candidate_id uuid references public.prospect_candidates(id) on delete set null,
  run_id uuid references public.prospect_outreach_runs(id) on delete set null,

  dedupe_key text not null,

  outreach_status text not null check (outreach_status in ('eligible', 'waiting', 'blocked', 'manual_review')),
  reasons text[] not null default '{}',

  channel text check (channel in ('whatsapp', 'phone', 'sms', 'email')),
  fallback_channel text check (fallback_channel in ('whatsapp', 'phone', 'sms', 'email')),
  priority integer,

  message_draft text,
  message_final text,
  subject_draft text,
  evidence_used text,
  evidence_snapshot jsonb not null default '{}'::jsonb,

  within_contact_window boolean,
  suggested_send_at timestamptz,
  next_available_at timestamptz,

  status text not null default 'pending' check (status in (
    'pending', 'approved', 'edited', 'dismissed', 'snoozed', 'acted', 'expired'
  )),
  snoozed_until timestamptz,
  feedback text,

  approved_at timestamptz,
  approved_by uuid,
  acted_at timestamptz,
  acted_by uuid,

  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same "dedupe by a stable key, insert-only via ON CONFLICT DO NOTHING"
-- pattern crm_message_suggestions already uses - a repeated shadow run for
-- the same lead+reason never creates a second pending suggestion (Phase 25
-- STEP 7). The key encodes the lead and a coarse reason bucket, never a
-- timestamp, so it stays stable across runs.
create unique index if not exists prospect_outreach_suggestions_dedupe_key_idx
  on public.prospect_outreach_suggestions (dedupe_key);

create index if not exists prospect_outreach_suggestions_lead_id_idx on public.prospect_outreach_suggestions (lead_id, created_at desc);
create index if not exists prospect_outreach_suggestions_status_idx on public.prospect_outreach_suggestions (status, priority);
create index if not exists prospect_outreach_suggestions_run_id_idx on public.prospect_outreach_suggestions (run_id);

-- =============================================================================
-- 4. RLS - admin-only on both new tables, same shape as every other
--    prospecting/outreach table in this project.
-- =============================================================================

alter table public.prospect_outreach_runs enable row level security;
alter table public.prospect_outreach_suggestions enable row level security;

drop policy if exists prospect_outreach_runs_admin_all on public.prospect_outreach_runs;
create policy prospect_outreach_runs_admin_all on public.prospect_outreach_runs for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists prospect_outreach_suggestions_admin_all on public.prospect_outreach_suggestions;
create policy prospect_outreach_suggestions_admin_all on public.prospect_outreach_suggestions for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- =============================================================================
-- Verification (safe to run any time)
-- =============================================================================

-- select column_name, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'automation_settings'
-- and column_name in ('shadow_mode', 'outreach_enabled', 'max_suggestions_per_run');

-- select * from public.prospect_outreach_runs order by started_at desc limit 10;
-- select * from public.prospect_outreach_suggestions order by created_at desc limit 20;

-- =============================================================================
-- Rollback - removes ONLY what this file added. Never touches sales_leads/
-- prospect_candidates/automation_tasks/crm_message_suggestions data.
-- =============================================================================

-- drop table if exists public.prospect_outreach_suggestions;
-- drop table if exists public.prospect_outreach_runs;
-- alter table public.automation_settings drop column if exists max_suggestions_per_run;
-- alter table public.automation_settings drop column if exists outreach_enabled;
-- alter table public.automation_settings drop column if exists shadow_mode;
