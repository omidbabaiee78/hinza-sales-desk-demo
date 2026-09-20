-- Phase 20 - Reply Intelligence: database additions.
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, run by hand in the SQL
-- editor, statement by statement" pattern as
-- supabase/sql/phase18a_automation_cron.sql and
-- supabase/sql/phase19_outreach_hub.sql - review before running, and do not
-- apply to production until it has been reviewed.
--
-- Everything here is additive: one new table, inbound_replies, admin-only
-- via RLS. No existing table/column is altered, dropped, or renamed.

-- =============================================================================
-- 1. inbound_replies - a recorded customer/prospect reply, its deterministic
--    classification, and the resulting business decision. Works for both a
--    prospect (lead_id) and, later, a customer (company_id) - never a
--    separate reply model per audience.
--
--    predicted_intent/final_intent are constrained to the reply-intent
--    taxonomy currently defined in src/replyIntelligence/
--    intentDefinitions.js (REPLY_INTENT_KEYS). Adding a new intent later
--    means updating that registry AND running a small follow-up migration
--    to extend this CHECK constraint (DROP CONSTRAINT + ADD CONSTRAINT with
--    the new list) - a deliberate trade of a little future migration work
--    for real DB-level integrity today.
-- =============================================================================

create table if not exists public.inbound_replies (
  id uuid primary key default gen_random_uuid(),

  lead_id uuid references public.sales_leads(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  outreach_attempt_id uuid references public.outreach_attempts(id) on delete set null,
  automation_task_id uuid references public.automation_tasks(id) on delete set null,

  channel text not null check (channel in ('whatsapp', 'sms', 'phone', 'email', 'manual', 'other')),
  source text not null default 'manual' check (source in ('manual', 'provider_webhook', 'import')),

  -- The customer's actual words - never overwritten, never truncated, the
  -- single source of truth every classification is derived from.
  raw_message text not null,
  normalized_message text,

  predicted_intent text not null,
  final_intent text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low', 'manual_review')),
  classification_source text not null default 'rules' check (classification_source in ('rules', 'manual', 'ai', 'provider')),

  recommended_action text,
  recommended_follow_up_at timestamptz,

  admin_confirmed boolean not null default false,
  admin_notes text,

  processed_at timestamptz,
  created_by uuid,

  external_message_id text,
  provider_payload jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inbound_replies_has_target check (lead_id is not null or company_id is not null)
);

-- Guarded (not an inline column CHECK) so this is safe to re-run whether
-- the table above was just created fresh or already existed from an
-- earlier run of this same file - either way, ends up with exactly these
-- two constraints, never a duplicate-constraint error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inbound_replies_predicted_intent_check'
  ) then
    alter table public.inbound_replies
      add constraint inbound_replies_predicted_intent_check
      check (predicted_intent in (
        'interested', 'price_request', 'product_question', 'sample_request', 'call_requested',
        'follow_up_later', 'not_now', 'not_interested', 'do_not_contact', 'wrong_contact',
        'already_supplied', 'needs_more_information', 'unknown'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inbound_replies_final_intent_check'
  ) then
    alter table public.inbound_replies
      add constraint inbound_replies_final_intent_check
      check (final_intent in (
        'interested', 'price_request', 'product_question', 'sample_request', 'call_requested',
        'follow_up_later', 'not_now', 'not_interested', 'do_not_contact', 'wrong_contact',
        'already_supplied', 'needs_more_information', 'unknown'
      ));
  end if;
end $$;

create index if not exists inbound_replies_lead_id_idx on public.inbound_replies (lead_id, created_at desc);
create index if not exists inbound_replies_company_id_idx on public.inbound_replies (company_id, created_at desc);
create index if not exists inbound_replies_automation_task_id_idx on public.inbound_replies (automation_task_id);
create index if not exists inbound_replies_outreach_attempt_id_idx on public.inbound_replies (outreach_attempt_id);
create index if not exists inbound_replies_unconfirmed_idx on public.inbound_replies (created_at desc) where admin_confirmed = false;

alter table public.inbound_replies enable row level security;

-- Admin-only, same shape as outreach_attempts' policy (see
-- supabase/sql/phase19_outreach_hub.sql) and the app's existing
-- profiles.role admin/customer split (src/hooks/useProfile.js).
drop policy if exists inbound_replies_admin_all on public.inbound_replies;
create policy inbound_replies_admin_all
  on public.inbound_replies
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- =============================================================================
-- Verification (safe to run any time)
-- =============================================================================

-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'inbound_replies'
-- order by ordinal_position;

-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.inbound_replies'::regclass
-- order by conname;

-- select id, lead_id, channel, predicted_intent, final_intent, confidence,
--        admin_confirmed, processed_at, created_at
-- from public.inbound_replies
-- order by created_at desc
-- limit 20;

-- =============================================================================
-- Rollback - removes ONLY this table. Never touches sales_leads,
-- automation_tasks or outreach_attempts data (their own rows are merely
-- referenced here, never owned by this table).
-- =============================================================================

-- drop table if exists public.inbound_replies;
