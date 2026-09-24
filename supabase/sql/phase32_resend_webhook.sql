-- Phase 32 - Resend delivery webhooks (resend-webhook Edge Function).
-- Additive only. Replaces status polling, which the send-only Resend key
-- cannot do (HTTP 401).

-- 1. Every verified event, once (svix-id is unique) - audit trail and the
--    "last webhook event" line on the email page. Written by the function
--    (service role); admins can read it.
create table if not exists public.email_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  email_id text,
  recipients text[] not null default '{}',
  status text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists email_provider_events_email_id_idx on public.email_provider_events (email_id);
create index if not exists email_provider_events_received_at_idx on public.email_provider_events (received_at desc);
alter table public.email_provider_events enable row level security;
drop policy if exists email_provider_events_admin_read on public.email_provider_events;
create policy email_provider_events_admin_read on public.email_provider_events for select using (private.is_admin());

-- 2. Delivery status and suppression per address. A suppressed address
--    (hard bounce or complaint) is refused by the send gate on every path.
alter table public.email_outreach_recipients add column if not exists delivery_status text;
alter table public.email_outreach_recipients add column if not exists delivery_status_at timestamptz;
alter table public.email_outreach_recipients add column if not exists suppressed_at timestamptz;
alter table public.email_outreach_recipients add column if not exists suppression_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'email_outreach_recipients_suppression_reason_check') then
    alter table public.email_outreach_recipients
      add constraint email_outreach_recipients_suppression_reason_check
      check (suppression_reason is null or suppression_reason in ('hard_bounce', 'complaint'));
  end if;
end $$;

-- Rollback:
-- alter table public.email_outreach_recipients drop constraint if exists email_outreach_recipients_suppression_reason_check;
-- alter table public.email_outreach_recipients drop column if exists suppression_reason, drop column if exists suppressed_at,
--   drop column if exists delivery_status_at, drop column if exists delivery_status;
-- drop table if exists public.email_provider_events;
