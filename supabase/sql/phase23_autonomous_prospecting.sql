-- Phase 23 - Autonomous Prospecting Engine: database additions.
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, run by hand in the SQL
-- editor, statement by statement" pattern as every prior phase's SQL file
-- in this directory - review before running, do not apply to production
-- until reviewed and do not activate any related cron until this and the
-- Edge Function have both been verified.
--
-- Everything here is additive: five new tables, all admin-only via RLS.
-- No existing table/column is altered, dropped, or renamed. Discovery is
-- kept entirely separate from sales_leads - a prospect_candidates row is
-- NEVER a real lead until it is explicitly promoted (see
-- src/prospecting/promotion.js), at which point it becomes an ordinary
-- sales_leads row and the existing Automation Engine takes over exactly as
-- it already does for any other lead.

-- =============================================================================
-- 1. prospect_sources - configuration and health of each discovery source.
-- =============================================================================

create table if not exists public.prospect_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type in (
    'uploaded_dataset', 'public_directory', 'industrial_directory', 'search_result',
    'company_website', 'trade_show_directory', 'association_directory',
    'government_registry', 'existing_database', 'custom_api'
  )),
  enabled boolean not null default true,
  base_url text,
  country text not null default 'IR',
  -- Per-source knobs (limits, field mappings, auth reference - NEVER a
  -- secret value itself, only e.g. {"apiKeyEnvVar": "SOME_PROVIDER_KEY"} so
  -- the actual key stays a server-side Edge Function secret).
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists prospect_sources_name_idx on public.prospect_sources (name);

-- =============================================================================
-- 2. prospect_discovery_runs - one audit row per discovery run (manual or
--    scheduled), across all sources it touched.
-- =============================================================================

create table if not exists public.prospect_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.prospect_sources(id) on delete set null,
  run_type text not null default 'manual' check (run_type in ('manual', 'scheduled')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  candidates_found integer not null default 0,
  candidates_created integer not null default 0,
  candidates_updated integer not null default 0,
  candidates_promoted integer not null default 0,
  duplicates_detected integer not null default 0,
  errors_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists prospect_discovery_runs_started_at_idx on public.prospect_discovery_runs (started_at desc);
create index if not exists prospect_discovery_runs_source_id_idx on public.prospect_discovery_runs (source_id);

-- =============================================================================
-- 3. prospect_candidates - a discovered company BEFORE it is a real lead.
--    Deliberately separate from sales_leads (see file header).
-- =============================================================================

create table if not exists public.prospect_candidates (
  id uuid primary key default gen_random_uuid(),

  canonical_name text not null,
  raw_name text,
  normalized_name_key text, -- deterministic dedupe key, see src/prospecting/normalization.js

  website text,
  domain text,
  phone text,
  mobile text,
  email text,

  province text,
  city text,
  address text,

  industry_guess text,
  business_description text,

  source_id uuid references public.prospect_sources(id) on delete set null,
  source_url text,
  source_external_id text,
  discovery_run_id uuid references public.prospect_discovery_runs(id) on delete set null,
  raw_data jsonb,

  status text not null default 'new' check (status in (
    'new', 'enriching', 'qualified', 'rejected', 'duplicate', 'promoted', 'manual_review'
  )),

  relevance_score integer,
  contact_quality_score integer,
  overall_score integer,
  confidence text check (confidence in ('high', 'medium', 'low', 'manual_review')),

  qualification_reason text,
  rejection_reason text,

  matched_lead_id uuid references public.sales_leads(id) on delete set null,
  matched_company_id uuid references public.companies(id) on delete set null,
  duplicate_of_candidate_id uuid references public.prospect_candidates(id) on delete set null,
  match_explanation text,

  promoted_lead_id uuid references public.sales_leads(id) on delete set null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent re-discovery from a source that supplies a stable external id -
-- a repeated run updates the SAME row instead of creating a duplicate.
create unique index if not exists prospect_candidates_source_external_idx
  on public.prospect_candidates (source_id, source_external_id)
  where source_external_id is not null;

create index if not exists prospect_candidates_status_idx on public.prospect_candidates (status, overall_score desc);
create index if not exists prospect_candidates_domain_idx on public.prospect_candidates (domain) where domain is not null;
create index if not exists prospect_candidates_normalized_name_idx on public.prospect_candidates (normalized_name_key) where normalized_name_key is not null;
create index if not exists prospect_candidates_phone_idx on public.prospect_candidates (phone) where phone is not null;
create index if not exists prospect_candidates_mobile_idx on public.prospect_candidates (mobile) where mobile is not null;
create index if not exists prospect_candidates_discovery_run_idx on public.prospect_candidates (discovery_run_id);
create index if not exists prospect_candidates_last_seen_idx on public.prospect_candidates (last_seen_at desc);

-- =============================================================================
-- 4. prospect_evidence - WHY the engine believes a candidate is relevant.
--    One row per evidence item, never a single opaque blob - every reason
--    shown to the admin traces back to exactly one of these rows.
-- =============================================================================

create table if not exists public.prospect_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.prospect_candidates(id) on delete cascade,
  evidence_type text not null,
  value text not null,
  source_url text,
  weight numeric not null default 1,
  confidence text check (confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now()
);

create index if not exists prospect_evidence_candidate_id_idx on public.prospect_evidence (candidate_id);

-- =============================================================================
-- 5. prospect_settings - singleton config row (same shape as
--    automation_settings id=1) for the operational limits the spec requires
--    to be configurable, not hardcoded: per-source run limits, promotion
--    caps, and the score/confidence thresholds that gate auto-promotion.
--    Scoring WEIGHTS (how evidence adds up to a score) live in
--    src/prospecting/scoringConfig.js - this table only holds the
--    operational knobs an admin might reasonably want to tune without a
--    deploy.
-- =============================================================================

create table if not exists public.prospect_settings (
  id smallint primary key default 1,
  enabled boolean not null default true,
  max_candidates_per_source_per_run integer not null default 100,
  max_promotions_per_run integer not null default 10,
  min_score_auto_promote integer not null default 80,
  min_confidence_auto_promote text not null default 'high' check (min_confidence_auto_promote in ('high', 'medium')),
  min_score_manual_review integer not null default 50,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint prospect_settings_singleton check (id = 1)
);

insert into public.prospect_settings (id)
values (1)
on conflict (id) do nothing;

-- =============================================================================
-- 6. RLS - admin-only on every table above, same shape as
--    outreach_attempts/inbound_replies (Phase 19/20).
-- =============================================================================

alter table public.prospect_sources enable row level security;
alter table public.prospect_discovery_runs enable row level security;
alter table public.prospect_candidates enable row level security;
alter table public.prospect_evidence enable row level security;
alter table public.prospect_settings enable row level security;

drop policy if exists prospect_sources_admin_all on public.prospect_sources;
create policy prospect_sources_admin_all on public.prospect_sources for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists prospect_discovery_runs_admin_all on public.prospect_discovery_runs;
create policy prospect_discovery_runs_admin_all on public.prospect_discovery_runs for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists prospect_candidates_admin_all on public.prospect_candidates;
create policy prospect_candidates_admin_all on public.prospect_candidates for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists prospect_evidence_admin_all on public.prospect_evidence;
create policy prospect_evidence_admin_all on public.prospect_evidence for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists prospect_settings_admin_all on public.prospect_settings;
create policy prospect_settings_admin_all on public.prospect_settings for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- =============================================================================
-- Verification (safe to run any time)
-- =============================================================================

-- select table_name from information_schema.tables
-- where table_schema = 'public'
-- and table_name in ('prospect_sources','prospect_discovery_runs','prospect_candidates','prospect_evidence','prospect_settings');

-- select * from public.prospect_settings;

-- select conname from pg_constraint where conrelid = 'public.prospect_candidates'::regclass;

-- =============================================================================
-- Rollback - removes ONLY what this file added. Never touches sales_leads/
-- companies data (their rows are merely referenced here, never owned by
-- these tables).
-- =============================================================================

-- drop table if exists public.prospect_evidence;
-- drop table if exists public.prospect_candidates;
-- drop table if exists public.prospect_discovery_runs;
-- drop table if exists public.prospect_settings;
-- drop table if exists public.prospect_sources;
