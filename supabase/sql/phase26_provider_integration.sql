-- Phase 26 - Real Provider Integration Foundation (WhatsApp + Email).
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, reviewed and run by hand in
-- the SQL editor, statement by statement" pattern as every prior phase's
-- SQL file in this directory.
--
-- IMPORTANT: this file was written against the ACTUAL current production
-- schema (queried directly before writing this), not the original Phase 19
-- migration file alone - outreach_attempts/automation_settings have both
-- drifted from supabase/sql/phase19_outreach_hub.sql since (extra columns/
-- constraint values already exist in production that this repo's tracked
-- SQL never added). Every ALTER below uses `add column if not exists` /
-- checks-before-adding, so it is safe to run regardless of that drift.
--
-- Everything here is additive: new columns + one relaxed CHECK constraint
-- (channel status enum gains 'sent'; lead_activities gains 'email'). No
-- existing table is dropped, no existing row is touched, no existing
-- column/constraint is removed. Nothing here can cause a real send -
-- outreach_enabled/whatsapp_provider_enabled/email_provider_enabled all
-- default to false, and provider_test_mode defaults to TRUE (fail-safe).

-- =============================================================================
-- 1. automation_settings - per-channel provider kill switches + test mode.
-- =============================================================================

alter table public.automation_settings
  add column if not exists whatsapp_provider_enabled boolean not null default false;

comment on column public.automation_settings.whatsapp_provider_enabled is
  'Phase 26: must be true, ALONGSIDE outreach_enabled, before a WhatsApp send can ever be attempted. Defaults false.';

alter table public.automation_settings
  add column if not exists email_provider_enabled boolean not null default false;

comment on column public.automation_settings.email_provider_enabled is
  'Phase 26: must be true, ALONGSIDE outreach_enabled, before an email send can ever be attempted. Defaults false.';

alter table public.automation_settings
  add column if not exists provider_test_mode boolean not null default true;

comment on column public.automation_settings.provider_test_mode is
  'Phase 26: defaults TRUE (fail-safe) - while true, every send is redirected to the configured WHATSAPP_TEST_RECIPIENT/EMAIL_TEST_RECIPIENT Edge Function secret regardless of the lead''s real contact info; a real customer destination is never used until this is explicitly turned off AND a real send is separately approved.';

-- =============================================================================
-- 2. prospect_outreach_suggestions - the SEND lifecycle, separate from the
--    existing admin-decision `status` column (pending/approved/edited/...).
--    A suggestion can be `status='approved'` while its send_status is still
--    'not_sent' (waiting on gates/credentials) or 'failed' (a provider
--    error) - these are two different, independently-tracked concerns.
-- =============================================================================

alter table public.prospect_outreach_suggestions
  add column if not exists send_status text not null default 'not_sent';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prospect_outreach_suggestions_send_status_check'
  ) then
    alter table public.prospect_outreach_suggestions
      add constraint prospect_outreach_suggestions_send_status_check
      check (send_status in ('not_sent', 'ready_to_send', 'sending', 'sent', 'failed'));
  end if;
end $$;

-- =============================================================================
-- 3. outreach_attempts - provider send audit columns. Reuses this EXISTING
--    table (never a parallel one) - it already anticipated this in Phase 19
--    (execution_mode already includes 'provider', external_message_id and
--    failure_reason already exist for exactly this purpose).
-- =============================================================================

alter table public.outreach_attempts add column if not exists provider text;
comment on column public.outreach_attempts.provider is 'Phase 26: which provider actually handled this attempt, e.g. whatsapp_cloud_api / resend. Null for manual (non-provider) attempts.';

alter table public.outreach_attempts add column if not exists error_code text;
comment on column public.outreach_attempts.error_code is 'Phase 26: normalized provider/gate error code (see errorCode in the provider adapter result shape). Never a raw stack trace.';

alter table public.outreach_attempts add column if not exists idempotency_key text;
comment on column public.outreach_attempts.idempotency_key is 'Phase 26: stable per-suggestion key (send:<suggestion_id>) - the retry-safety mechanism. A suggestion can only ever reach a successful send once; see the partial unique index below.';

alter table public.outreach_attempts add column if not exists test_mode boolean not null default false;
comment on column public.outreach_attempts.test_mode is 'Phase 26: true when this attempt was redirected to the configured test recipient rather than the lead''s real contact info. A test send NEVER stamps sales_leads.last_contact_at / lead_activities.';

alter table public.outreach_attempts add column if not exists suggestion_id uuid references public.prospect_outreach_suggestions(id) on delete set null;
create index if not exists outreach_attempts_suggestion_id_idx on public.outreach_attempts (suggestion_id);

alter table public.outreach_attempts add column if not exists approved_by uuid;
alter table public.outreach_attempts add column if not exists approved_at timestamptz;
comment on column public.outreach_attempts.approved_by is 'Phase 26: snapshot of who approved the source suggestion at the moment this attempt was made - durable even if the suggestion row changes later.';

alter table public.outreach_attempts add column if not exists recipient_masked text;
comment on column public.outreach_attempts.recipient_masked is 'Phase 26: a masked fingerprint of the actual destination used (e.g. 0912***4567, i***@domain.com) - never the full raw contact value, and never the secret/token used to send it.';

-- A given suggestion may only ever reach a successful ('sent') send once -
-- enforced here at the database level, not just in application logic.
create unique index if not exists outreach_attempts_idempotency_key_sent_idx
  on public.outreach_attempts (idempotency_key)
  where idempotency_key is not null and status = 'sent';

-- Relax the status check to allow 'sent' (a genuine provider-confirmed
-- delivery-to-provider event, distinct from 'completed' which represents a
-- MANUAL admin action completion) - every value production already had
-- (including ones this repo's original Phase 19 file never listed) is kept.
do $$
begin
  alter table public.outreach_attempts drop constraint if exists outreach_attempts_status_check;
  alter table public.outreach_attempts
    add constraint outreach_attempts_status_check
    check (status in ('prepared', 'approved', 'edited', 'opened', 'copied', 'completed', 'sent', 'failed', 'cancelled', 'dismissed', 'snoozed'));
end $$;

-- =============================================================================
-- 4. lead_activities - add 'email' as a real contact-activity type (it was
--    never possible to log an email contact before; every other real
--    provider channel this app already sends manually already has one).
-- =============================================================================

do $$
begin
  alter table public.lead_activities drop constraint if exists lead_activities_type_check;
  alter table public.lead_activities
    add constraint lead_activities_type_check
    check (activity_type in ('phone', 'whatsapp', 'email', 'meeting', 'note', 'sample', 'quote', 'followup', 'status_change'));
end $$;

-- =============================================================================
-- Verification (safe to run any time, reveals no secrets)
-- =============================================================================

-- select column_name, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'automation_settings'
-- and column_name in ('whatsapp_provider_enabled', 'email_provider_enabled', 'provider_test_mode');

-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'public.outreach_attempts'::regclass and contype = 'c';

-- =============================================================================
-- Rollback - removes ONLY what this file added. Never touches sales_leads/
-- lead_activities data, prospect_outreach_suggestions data, or any existing
-- outreach_attempts row.
-- =============================================================================

-- alter table public.lead_activities drop constraint if exists lead_activities_type_check;
-- alter table public.lead_activities add constraint lead_activities_type_check
--   check (activity_type in ('phone', 'whatsapp', 'meeting', 'note', 'sample', 'quote', 'followup', 'status_change'));
-- drop index if exists public.outreach_attempts_idempotency_key_sent_idx;
-- alter table public.outreach_attempts drop column if exists recipient_masked;
-- alter table public.outreach_attempts drop column if exists approved_at;
-- alter table public.outreach_attempts drop column if exists approved_by;
-- alter table public.outreach_attempts drop column if exists suggestion_id;
-- alter table public.outreach_attempts drop column if exists test_mode;
-- alter table public.outreach_attempts drop column if exists idempotency_key;
-- alter table public.outreach_attempts drop column if exists error_code;
-- alter table public.outreach_attempts drop column if exists provider;
-- alter table public.prospect_outreach_suggestions drop constraint if exists prospect_outreach_suggestions_send_status_check;
-- alter table public.prospect_outreach_suggestions drop column if exists send_status;
-- alter table public.automation_settings drop column if exists provider_test_mode;
-- alter table public.automation_settings drop column if exists email_provider_enabled;
-- alter table public.automation_settings drop column if exists whatsapp_provider_enabled;
