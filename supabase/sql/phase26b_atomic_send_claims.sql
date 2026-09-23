-- Phase 26b - atomic send claims (concurrency-safety follow-up).
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, reviewed and run by hand in
-- the SQL editor, statement by statement" pattern as every prior phase's
-- SQL file in this directory.
--
-- WHY THIS EXISTS: the original Phase 26 design (phase26_provider_
-- integration.sql) only had a partial unique index on outreach_attempts
-- (idempotency_key) WHERE status = 'sent'. That protects the DATABASE ROW,
-- but not the provider call itself - two concurrent requests for the same
-- suggestion can both pass the pre-send "already sent?" check (neither has
-- written a 'sent' row yet) and BOTH reach the WhatsApp/email provider,
-- double-messaging a real customer. This file adds a small table used as an
-- ATOMIC CLAIM, taken BEFORE the provider is ever called (see
-- src/outreach/sendPipeline.js's claimSend()) - only one concurrent request
-- can ever win it for a given idempotency key.
--
-- A claim starts 'claimed' and is only ever resolved to 'sent' or 'failed'
-- for a DEFINITE provider outcome. A timeout/network (unknown) outcome
-- deliberately leaves it 'claimed' forever - the application layer never
-- auto-releases or auto-retries an unknown outcome; a human must reconcile
-- the real outcome with the provider directly (see the reconciliation
-- section below, which is deliberately strict about what counts as safe).
--
-- Test and production sends use DIFFERENT idempotency_key prefixes
-- (test-send:<id> / send:<id> - see idempotencyKeyFor() in sendPipeline.js),
-- so this table naturally keeps them from ever blocking one another.
--
-- Additive only: a new table, nothing existing is touched.

-- =============================================================================
-- 1. outreach_send_claims
-- =============================================================================

create table if not exists public.outreach_send_claims (
  idempotency_key text primary key,
  suggestion_id uuid references public.prospect_outreach_suggestions(id) on delete set null,
  channel text,
  test_mode boolean not null default false,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  claimed_at timestamptz not null default now(),
  claimed_by uuid,
  resolved_at timestamptz
);

comment on table public.outreach_send_claims is
  'Phase 26b: one row per idempotency key (send:<suggestion_id> / test-send:<suggestion_id>). status=claimed means a send is in flight OR its outcome is unknown (timeout/network/provider-accepted-pending-delivery) - it is NEVER safe to reclaim. Only status=failed (a CONFIRMED non-acceptance, with no possibility the original request can still complete) may ever be reclaimed for a retry. status=sent is terminal - that key can never send again. Server-managed only: no client (anon/authenticated) role has any privilege on this table - see the grants/revokes below.';

comment on column public.outreach_send_claims.status is
  'claimed = in flight, or an outcome that is not a confirmed non-acceptance (never auto-retried/released); sent = confirmed provider acceptance/delivery (terminal); failed = confirmed non-acceptance of this specific attempt (safe to reclaim/retry).';

create index if not exists outreach_send_claims_suggestion_id_idx on public.outreach_send_claims (suggestion_id);

-- =============================================================================
-- 2. Access control - SERVER-MANAGED ONLY.
--
-- Unlike every other Phase 26 table (which is admin-readable/writable
-- through the browser via an admin-only RLS policy), this table is never
-- read or written by any browser session - it exists purely as an internal
-- concurrency primitive for src/outreach/sendPipeline.js's claimSend(),
-- called ONLY from the outreach-send Edge Function under the service-role
-- key. It intentionally has NO policy at all (RLS enabled + zero policies =
-- deny-all for every role that does not bypass RLS), and table privileges
-- are explicitly revoked from public/anon/authenticated on top of that, as
-- defense-in-depth - same "revoke all ... from public, anon, authenticated"
-- convention already used for the cron-trigger functions in
-- phase18a_automation_cron.sql / phase23_prospecting_cron.sql /
-- phase25_outreach_shadow_cron.sql, applied here to a TABLE instead of a
-- function. Supabase's service_role already bypasses RLS by design, and
-- normally already holds default table privileges on public. schema
-- objects - the explicit grant below exists so access does not silently
-- depend on that default, only on what is declared right here.
-- =============================================================================

alter table public.outreach_send_claims enable row level security;

-- No policy is created for any role - RLS with zero policies denies every
-- row to every role that does not bypass RLS (service_role does).

revoke all on public.outreach_send_claims from public, anon, authenticated;
grant select, insert, update on public.outreach_send_claims to service_role;

-- =============================================================================
-- Verification (safe to run any time, reveals no secrets)
-- =============================================================================

-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'outreach_send_claims';

-- Confirm no client role has any privilege and RLS is enabled:
-- select grantee, privilege_type from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'outreach_send_claims';
-- select relrowsecurity from pg_class where relname = 'outreach_send_claims';

-- Rows stuck in 'claimed' with no resolution for an unusually long time are
-- exactly the "outcome not confirmed, needs manual reconciliation" case
-- this design deliberately produces instead of guessing:
-- select * from public.outreach_send_claims
-- where status = 'claimed' and claimed_at < now() - interval '1 hour'
-- order by claimed_at asc;

-- =============================================================================
-- Manual reconciliation - READ THIS CAREFULLY BEFORE TOUCHING A ROW.
--
-- A stuck 'claimed' row means we genuinely do not know the outcome. "The
-- provider dashboard doesn't show it delivered yet" is NOT the same as
-- "the provider never received/accepted this request" - acceptance and
-- delivery are SEPARATE, and delivery can still complete AFTER you looked.
-- NEVER reclassify a claim as 'failed' (retryable) from "not delivered
-- yet", "pending", "queued", or any other outcome where the original
-- request could still complete. The ONLY safe basis for 'failed' is a
-- CONFIRMED NON-ACCEPTANCE of THIS SPECIFIC attempt - e.g. the provider's
-- own API/dashboard, queried by the associated outreach_attempts row's own
-- external_message_id, returns a definitive "no such request"/hard
-- rejection, not a transient or in-progress state.
--
-- Step 1 - find the claim TOGETHER WITH its associated attempt and
-- provider message id (never reconcile from this table alone):
-- select c.idempotency_key, c.status, c.suggestion_id, c.channel, c.claimed_at,
--        a.id as attempt_id, a.provider, a.external_message_id, a.status as attempt_status, a.error_code
-- from public.outreach_send_claims c
-- left join public.outreach_attempts a on a.idempotency_key = c.idempotency_key
-- where c.status = 'claimed' and c.claimed_at < now() - interval '1 hour'
-- order by c.claimed_at asc;
--
-- Step 2 - look up a.external_message_id (and a.provider) DIRECTLY with the
-- provider (WhatsApp Business Manager / Cloud API message status; the
-- Resend dashboard/API) BEFORE touching this table. Proceed only on a
-- definitive, terminal answer - never on an absence of evidence.
--
-- Step 3a - ONLY on a CONFIRMED non-acceptance (the provider has no record
-- of this specific request ever being accepted, and it cannot still
-- complete): mark it retryable. The `and status = 'claimed'` guard makes
-- this a no-op if the row was already resolved by the application itself
-- (e.g. a slow response finally landed) in the time since Step 1 - it never
-- blindly overwrites whatever the row's current state happens to be:
-- update public.outreach_send_claims set status = 'failed', resolved_at = now()
-- where idempotency_key = '<key>' and status = 'claimed';
--
-- Step 3b - CONFIRMED the provider DID accept/deliver it: keep it
-- terminal, guarded the same way, and reconcile outreach_attempts /
-- prospect_outreach_suggestions to match (this table alone is not the full
-- audit trail):
-- update public.outreach_send_claims set status = 'sent', resolved_at = now()
-- where idempotency_key = '<key>' and status = 'claimed';

-- =============================================================================
-- Rollback - removes ONLY what this file added.
-- =============================================================================

-- revoke select, insert, update on public.outreach_send_claims from service_role;
-- drop table if exists public.outreach_send_claims;
