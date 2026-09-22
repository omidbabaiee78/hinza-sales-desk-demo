-- Phase 23D-FINAL, section N - DECISION VERSIONING.
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, run by hand in the SQL
-- editor, statement by statement" pattern as every prior phase's SQL file
-- in this directory - review before running.
--
-- Purely additive, idempotent, backward-compatible: adds ONE nullable
-- integer column to an existing table. Never drops, renames, or alters any
-- existing column; never touches a single existing row's data. Safe to run
-- on the live database at any time, including with the prospect-discovery
-- Edge Function already deployed and in use - existing rows simply keep
-- qualification_version = NULL ("predates versioning") until the next time
-- they're (re-)evaluated.
--
-- Why this matters: several rounds of qualification-logic tuning (Phase
-- 23D through 23D-FINAL) each changed what status/score/reason a candidate
-- ends up with. Without a version stamp there is no way to answer "which
-- candidates were evaluated under an OLDER, since-improved brain and are
-- therefore worth a fresh look" except by remembering it by hand - which is
-- exactly what this column is for.
--
-- src/prospecting/qualification.js exports QUALIFICATION_VERSION (an
-- integer, bumped whenever qualification/entity/buyer-fit logic changes in
-- a way that could change a decision). Once this migration has been
-- applied, reEvaluateCandidate()/processCandidate() in discoveryPipeline.js
-- can be updated to stamp candidate.qualification_version =
-- QUALIFICATION_VERSION on every write - deliberately NOT done yet (see the
-- 23D-FINAL report): writing to a column that does not exist yet would
-- error out the already-deployed, already-working re-evaluation path, and
-- this repository has no way to apply this migration and deploy that code
-- change atomically together.

-- =============================================================================
-- 1. The column itself.
-- =============================================================================

alter table public.prospect_candidates
  add column if not exists qualification_version integer;

comment on column public.prospect_candidates.qualification_version is
  'Which QUALIFICATION_VERSION (src/prospecting/qualification.js) produced this row''s current status/score/reason. NULL = predates versioning (Phase 23 through 23D.3). Stamped by reEvaluateCandidate()/processCandidate() once this migration has been applied and that code is updated to write it.';

-- =============================================================================
-- 2. Verification (safe to run any time).
-- =============================================================================

-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'prospect_candidates' and column_name = 'qualification_version';

-- A quick "how stale is my data" check once some rows have been stamped:
-- select qualification_version, count(*) from public.prospect_candidates group by 1 order by 1 nulls first;

-- =============================================================================
-- Rollback - removes ONLY this column. Never touches any other column or
-- any row's data.
-- =============================================================================

-- alter table public.prospect_candidates drop column if exists qualification_version;
