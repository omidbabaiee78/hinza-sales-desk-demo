-- Phase 24 - Autonomous Daily Prospecting Pipeline: settings + concurrency
-- guard additions on top of Phase 23's prospect_* tables.
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, review and run by hand in the
-- SQL editor, statement by statement" pattern as every prior phase's SQL
-- file in this directory.
--
-- This file is purely ADDITIVE: new prospect_settings columns (all with
-- conservative production defaults - the daily schedule itself STAYS OFF,
-- see supabase/sql/phase23_prospecting_cron.sql, until an admin explicitly
-- activates it after reviewing at least one real server-side test run) and
-- one new partial unique index. No existing table, column, row, or RLS
-- policy is altered, dropped, or renamed. Nothing here touches sales_leads,
-- companies, or any messaging/outreach table.

-- =============================================================================
-- 1. prospect_settings - new columns for the daily pipeline's hard limits.
--
-- max_candidates_per_source_per_run and max_promotions_per_run already exist
-- from Phase 23 and are reused as-is for "discovery batch size" and
-- "maximum auto-promotions per run" - not duplicated here.
-- =============================================================================

alter table public.prospect_settings
  add column if not exists daily_run_enabled boolean not null default false;

comment on column public.prospect_settings.daily_run_enabled is
  'A SEPARATE kill switch for just the unattended scheduled/cron path, independent of `enabled` (which also gates every manual/admin-triggered run). Defaults OFF - an admin must explicitly turn this on after reviewing at least one real server-side test run (Phase 24 STEP 8/10). The pg_cron schedule itself (supabase/sql/phase23_prospecting_cron.sql, section 4) stays commented out independently of this flag - both must be true for the daily job to actually run unattended.';

alter table public.prospect_settings
  add column if not exists max_external_requests_per_run integer not null default 20;

comment on column public.prospect_settings.max_external_requests_per_run is
  'Run-wide cap on external SEARCH/discovery requests (Serper/OSM-style sources) - a source whose estimated request cost no longer fits is skipped BEFORE its adapter.discover() is ever called, so this can only ever be under-used, never exceeded. Independent of the separate, already-existing MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN constant in discoveryPipeline.js, which covers only the tightly-scoped live-website identity-verification fetch.';

alter table public.prospect_settings
  add column if not exists run_timeout_ms integer not null default 240000;

comment on column public.prospect_settings.run_timeout_ms is
  'Soft, application-level execution budget (default 4 minutes) checked between sources during a run - once exceeded, remaining sources are skipped and the run finishes with status=partial rather than left to hit the Supabase Edge Function platform''s own hard execution ceiling.';

alter table public.prospect_settings
  add column if not exists dry_run boolean not null default false;

comment on column public.prospect_settings.dry_run is
  'When true, runDiscovery() runs the ENTIRE pipeline (discovery, dedupe, enrichment, qualification, candidate/evidence bookkeeping, run logging) exactly as normal, but never writes to sales_leads - candidates_promoted stays a true zero and what WOULD have promoted is reported separately (run.summary.wouldPromoteCount). Independent of the per-call dryRun argument runDiscovery() also accepts (see discoveryPipeline.js and the manualTest request field in supabase/functions/prospect-discovery/index.ts) - either one alone is enough to force a dry run.';

-- =============================================================================
-- 2. prospect_discovery_runs - concurrency guard backstop.
--
-- discoveryPipeline.js's guardConcurrentScheduledRun() is the PRIMARY,
-- regression-tested mechanism (a SELECT-based check-and-reclaim, run before
-- the new run row is even inserted). This partial unique index is a REAL-DB
-- backstop for the narrow true-simultaneous-race case that check alone
-- cannot fully close (two invocations both passing the SELECT in the same
-- instant) - it can never be exercised by the in-memory fake client the JS
-- regression suite uses, the same as every other real DB constraint in this
-- codebase (e.g. prospect_candidates_source_external_idx from Phase 23).
-- =============================================================================

create unique index if not exists prospect_discovery_runs_one_running_scheduled
  on public.prospect_discovery_runs (run_type)
  where run_type = 'scheduled' and status = 'running';

-- =============================================================================
-- Verification (safe to run any time, reveals no secrets)
-- =============================================================================

-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'prospect_settings'
-- order by ordinal_position;

-- select * from public.prospect_settings;

-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'prospect_discovery_runs';

-- =============================================================================
-- Rollback - removes ONLY what this file added. Never touches sales_leads/
-- companies/prospect_candidates data, and never touches any Phase 23 column.
-- =============================================================================

-- drop index if exists public.prospect_discovery_runs_one_running_scheduled;
-- alter table public.prospect_settings drop column if exists dry_run;
-- alter table public.prospect_settings drop column if exists run_timeout_ms;
-- alter table public.prospect_settings drop column if exists max_external_requests_per_run;
-- alter table public.prospect_settings drop column if exists daily_run_enabled;
