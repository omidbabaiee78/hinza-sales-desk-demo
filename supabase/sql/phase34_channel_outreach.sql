-- Phase 34 - WhatsApp / Bale introduction queue for registered leads.
--
-- Additive only. The email pipeline (email_outreach_recipients,
-- claim_email_outreach_recipient, outreach-auto-email, its cron and 20/day
-- cap) is not touched. WhatsApp and Bale stay OFF: whatsapp_provider_enabled
-- (existing) and bale_provider_enabled (new) default false, and without the
-- provider secrets the runner only records "waiting for provider".
--
-- Order: 1) run this file, 2) deploy outreach-channels, 3) set its cron
-- secret + Vault secret, 4) schedule (section 6, commented out).

-- 1. A Bale chat id, only when one is actually known ------------------------
-- The Bale Bot API accepts only a chat id the bot received after the person
-- started a chat with it; a phone number is not one.
alter table public.sales_leads add column if not exists bale_chat_id text;
alter table public.sales_leads add column if not exists bale_chat_id_source text;
comment on column public.sales_leads.bale_chat_id is 'Phase 34: Bale chat id (Bot API recipient) - only when actually known; a phone number is never stored here.';

-- 2. Settings (channels stay disabled) -----------------------------------------
alter table public.automation_settings add column if not exists bale_provider_enabled boolean not null default false;
alter table public.automation_settings add column if not exists channel_daily_cap integer not null default 20;
alter table public.automation_settings add column if not exists channel_max_per_run integer not null default 5;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_settings_channel_limits_check') then
    alter table public.automation_settings add constraint automation_settings_channel_limits_check
      check (channel_daily_cap between 1 and 100 and channel_max_per_run between 1 and 20);
  end if;
end $$;

-- 3. One introduction per (channel, normalized destination) ------------------
create table if not exists public.channel_outreach_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'bale')),
  normalized_destination text not null check (normalized_destination = btrim(normalized_destination) and normalized_destination <> ''),
  destination_kind text not null check (destination_kind in ('mobile', 'mobile_unverified', 'bale_chat_id')),
  lead_id uuid references public.sales_leads(id) on delete set null,
  contact_source text,
  contact_source_detail text,
  status text not null check (status in ('waiting_provider', 'queued', 'sending', 'sent', 'delivered', 'failed', 'uncertain', 'opted_out')),
  provider text,
  provider_message_id text,
  error_code text,
  error_message text,
  message_snapshot text,
  queued_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, normalized_destination)
);
create index if not exists channel_outreach_messages_lead_idx on public.channel_outreach_messages (lead_id);
create index if not exists channel_outreach_messages_status_idx on public.channel_outreach_messages (channel, status);

-- Append-only history of every change (the attempt record).
create table if not exists public.channel_outreach_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.channel_outreach_messages(id) on delete cascade,
  lead_id uuid,
  channel text not null,
  event text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists channel_outreach_events_message_idx on public.channel_outreach_events (message_id, created_at);

create table if not exists public.channel_outreach_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'admin')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  registered integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  report jsonb not null default '{}'::jsonb
);
create index if not exists channel_outreach_runs_started_at_idx on public.channel_outreach_runs (started_at desc);

-- Admins read; only the service role (the Edge Function) writes.
alter table public.channel_outreach_messages enable row level security;
alter table public.channel_outreach_events enable row level security;
alter table public.channel_outreach_runs enable row level security;
drop policy if exists channel_outreach_messages_admin_read on public.channel_outreach_messages;
create policy channel_outreach_messages_admin_read on public.channel_outreach_messages for select using (private.is_admin());
drop policy if exists channel_outreach_events_admin_read on public.channel_outreach_events;
create policy channel_outreach_events_admin_read on public.channel_outreach_events for select using (private.is_admin());
drop policy if exists channel_outreach_runs_admin_read on public.channel_outreach_runs;
create policy channel_outreach_runs_admin_read on public.channel_outreach_runs for select using (private.is_admin());

-- 4. Atomic claim: queued -> sending, with the per-channel daily cap ---------
-- Same pattern as claim_email_outreach_recipient: one lock, so concurrent
-- runs can neither send one row twice nor exceed the cap.
create or replace function public.claim_channel_outreach_message(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_cap integer;
  v_today integer;
begin
  perform pg_advisory_xact_lock(hashtext('hinza_channel_outreach_claim'));
  select channel into v_channel from public.channel_outreach_messages where id = p_id and status = 'queued';
  if v_channel is null then
    return 'not_queued';
  end if;
  select coalesce(channel_daily_cap, 20) into v_cap from public.automation_settings where id = 1;
  select count(*) into v_today
  from public.channel_outreach_messages
  where channel = v_channel
    and status in ('sending', 'sent', 'delivered', 'uncertain')
    and (claimed_at at time zone 'Asia/Tehran')::date = (now() at time zone 'Asia/Tehran')::date;
  if v_today >= v_cap then
    return 'cap_reached';
  end if;
  update public.channel_outreach_messages set status = 'sending', claimed_at = now(), updated_at = now() where id = p_id;
  return 'claimed';
end;
$$;
revoke all on function public.claim_channel_outreach_message(uuid) from public, anon, authenticated;
grant execute on function public.claim_channel_outreach_message(uuid) to service_role;

-- 5. Cron trigger (secret read from Vault at call time) ---------------------
-- Store first (value never committed):
--   supabase secrets set OUTREACH_CHANNELS_CRON_SECRET=<value>
--   select vault.create_secret('<value>', 'outreach_channels_cron_secret');
create or replace function public.trigger_outreach_channels()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'outreach_channels_cron_secret';
  if v_secret is null then
    raise exception 'outreach_channels_cron_secret is not set in Vault';
  end if;
  perform net.http_post(
    url := 'https://xgdwswagpcaviwpbfysm.supabase.co/functions/v1/outreach-channels',
    headers := jsonb_build_object('content-type', 'application/json', 'x-outreach-channels-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;
revoke all on function public.trigger_outreach_channels() from public, anon, authenticated;

-- 6. Schedule - hourly at :50, 06:50-12:50 UTC (10:20-16:20 Tehran), after the
-- email run at :45. With both providers disabled a run only records
-- "waiting for provider"; it never sends.
-- select cron.schedule('hinza-channel-intro', '50 6-12 * * *', $$select public.trigger_outreach_channels();$$);

-- Rollback:
-- select cron.unschedule('hinza-channel-intro');
-- drop function if exists public.trigger_outreach_channels();
-- drop function if exists public.claim_channel_outreach_message(uuid);
-- drop table if exists public.channel_outreach_events, public.channel_outreach_runs, public.channel_outreach_messages;
-- alter table public.automation_settings drop constraint if exists automation_settings_channel_limits_check,
--   drop column if exists channel_max_per_run, drop column if exists channel_daily_cap, drop column if exists bale_provider_enabled;
-- alter table public.sales_leads drop column if exists bale_chat_id_source, drop column if exists bale_chat_id;
