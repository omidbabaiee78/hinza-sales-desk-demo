-- Phase 37 - WhatsApp introductions: one shared send claim, per-channel test
-- mode, a 24-hour first-touch gap between email and WhatsApp, and the Meta
-- webhook (delivery status + inbound opt-out).
--
-- Additive only: no row is deleted or reset. The 134 waiting WhatsApp rows
-- stay as they are; nothing is sent while whatsapp_provider_enabled is off
-- (it is) or whatsapp_test_mode is on (the new default).
--
-- Order: 1) run this file, 2) deploy outreach-channels, outreach-send,
-- outreach-auto-email and whatsapp-webhook (--no-verify-jwt).

-- 1. Settings --------------------------------------------------------------
-- whatsapp_test_mode: WhatsApp's own test mode. provider_test_mode keeps
-- governing email (and Bale), so testing WhatsApp never touches email.
alter table public.automation_settings add column if not exists whatsapp_test_mode boolean not null default true;
alter table public.automation_settings add column if not exists channel_first_touch_gap_hours integer not null default 24;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_settings_first_touch_gap_check') then
    alter table public.automation_settings add constraint automation_settings_first_touch_gap_check
      check (channel_first_touch_gap_hours between 24 and 720);
  end if;
end $$;
comment on column public.automation_settings.whatsapp_test_mode is 'Phase 37: WhatsApp-only test mode (true = no automatic WhatsApp sends; admin test sends go to WHATSAPP_TEST_RECIPIENT). Email uses provider_test_mode.';
comment on column public.automation_settings.channel_first_touch_gap_hours is 'Phase 37: minimum hours between a lead''s first email and its first WhatsApp introduction (either order). At least 24.';

-- 2. Message rows: provider status and who claimed them --------------------
alter table public.channel_outreach_messages add column if not exists provider_status text;
alter table public.channel_outreach_messages add column if not exists provider_status_at timestamptz;
alter table public.channel_outreach_messages add column if not exists claim_source text;
alter table public.channel_outreach_messages add column if not exists suggestion_id uuid references public.prospect_outreach_suggestions(id) on delete set null;
create index if not exists channel_outreach_messages_provider_message_idx on public.channel_outreach_messages (provider_message_id) where provider_message_id is not null;

-- 3. WhatsApp webhook events (dedupe + debugging, masked numbers only) -----
create table if not exists public.whatsapp_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  kind text not null check (kind in ('status', 'message')),
  provider_message_id text,
  status text,
  number_masked text,
  error_code text,
  error_title text,
  opt_out boolean not null default false,
  lead_ids uuid[] not null default '{}',
  applied text,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists whatsapp_provider_events_message_idx on public.whatsapp_provider_events (provider_message_id);
alter table public.whatsapp_provider_events enable row level security;
drop policy if exists whatsapp_provider_events_admin_read on public.whatsapp_provider_events;
create policy whatsapp_provider_events_admin_read on public.whatsapp_provider_events for select using (private.is_admin());

-- 4. The ONE claim for a real WhatsApp/Bale introduction --------------------
-- Used by the automatic runner (outreach-channels) AND the manual send
-- (outreach-send). Under one lock it checks, in order:
--   duplicate   - this destination was already claimed/sent (or belongs to
--                 another lead), or this lead already got this channel's intro
--   no_lead / opted_out / closed - lead missing, do_not_contact or a
--                 do_not_contact reply, converted/lost
--   gap         - the lead's first email was less than
--                 channel_first_touch_gap_hours ago
--   cap_reached - today's (Tehran) per-channel cap; WhatsApp never above 20
-- then moves the row to 'sending' (creating it for a manual send if needed).
-- The shared 'hinza_first_touch_gap' lock is also taken by the email claim,
-- so an email and a WhatsApp claim for one lead can never both slip through.
create or replace function public.claim_channel_send(
  p_channel text,
  p_destination text,
  p_destination_kind text,
  p_lead_id uuid,
  p_source text,
  p_suggestion_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.channel_outreach_messages%rowtype;
  v_lead public.sales_leads%rowtype;
  v_gap integer;
  v_cap integer;
  v_today integer;
  v_first_email timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('hinza_channel_outreach_claim'));
  perform pg_advisory_xact_lock(hashtext('hinza_first_touch_gap'));

  select * into v_row from public.channel_outreach_messages where channel = p_channel and normalized_destination = p_destination;
  if found and v_row.lead_id is not null and v_row.lead_id <> p_lead_id then
    return jsonb_build_object('result', 'duplicate', 'id', v_row.id);
  end if;
  if found and v_row.status = 'opted_out' then
    return jsonb_build_object('result', 'opted_out', 'id', v_row.id);
  end if;
  -- A definite rejection ('failed': the provider did not take it) may be
  -- retried by the admin's explicit manual send; the automatic runner never
  -- retries. 'uncertain' is never reclaimable - it may have gone out.
  if found and v_row.status not in ('queued', 'waiting_provider')
     and not (v_row.status = 'failed' and p_source = 'manual') then
    return jsonb_build_object('result', 'duplicate', 'id', v_row.id);
  end if;
  if exists (
    select 1 from public.channel_outreach_messages
    where channel = p_channel and lead_id = p_lead_id and normalized_destination <> p_destination
      and status in ('sending', 'sent', 'delivered', 'uncertain')
  ) then
    return jsonb_build_object('result', 'duplicate', 'id', v_row.id);
  end if;

  select * into v_lead from public.sales_leads where id = p_lead_id;
  if not found then
    return jsonb_build_object('result', 'no_lead', 'id', v_row.id);
  end if;
  if v_lead.do_not_contact or exists (
    select 1 from public.inbound_replies where lead_id = p_lead_id and (final_intent = 'do_not_contact' or predicted_intent = 'do_not_contact')
  ) then
    return jsonb_build_object('result', 'opted_out', 'id', v_row.id);
  end if;
  if v_lead.status in ('converted', 'lost') then
    return jsonb_build_object('result', 'closed', 'id', v_row.id);
  end if;

  select greatest(coalesce(channel_first_touch_gap_hours, 24), 24),
         case when p_channel = 'whatsapp' then least(coalesce(channel_daily_cap, 20), 20) else coalesce(channel_daily_cap, 20) end
    into v_gap, v_cap
  from public.automation_settings where id = 1;

  select min(t) into v_first_email from (
    select min(claimed_at) as t from public.email_outreach_recipients
    where lead_id = p_lead_id and status in ('claimed', 'sent', 'uncertain')
    union all
    select min(created_at) from public.outreach_attempts
    where lead_id = p_lead_id and channel = 'email' and purpose = 'provider_send'
      and status in ('prepared', 'sent') and coalesce(test_mode, false) = false
  ) s;
  if v_first_email is not null and v_first_email > now() - make_interval(hours => v_gap) then
    return jsonb_build_object('result', 'gap', 'id', v_row.id, 'until', v_first_email + make_interval(hours => v_gap));
  end if;

  select count(*) into v_today
  from public.channel_outreach_messages
  where channel = p_channel
    and status in ('sending', 'sent', 'delivered', 'uncertain')
    and (claimed_at at time zone 'Asia/Tehran')::date = (now() at time zone 'Asia/Tehran')::date;
  if v_today >= v_cap then
    return jsonb_build_object('result', 'cap_reached', 'id', v_row.id);
  end if;

  if v_row.id is null then
    insert into public.channel_outreach_messages (channel, normalized_destination, destination_kind, lead_id, contact_source, status, queued_at, claimed_at, claim_source, suggestion_id)
    values (p_channel, p_destination, p_destination_kind, p_lead_id, 'manual_send', 'sending', now(), now(), p_source, p_suggestion_id)
    returning * into v_row;
  else
    update public.channel_outreach_messages
    set status = 'sending', claimed_at = now(), claim_source = p_source, suggestion_id = coalesce(p_suggestion_id, suggestion_id), lead_id = coalesce(lead_id, p_lead_id), updated_at = now()
    where id = v_row.id
    returning * into v_row;
  end if;
  insert into public.channel_outreach_events (message_id, lead_id, channel, event, detail)
  values (v_row.id, p_lead_id, p_channel, 'claimed', jsonb_build_object('source', p_source, 'suggestion_id', p_suggestion_id));
  return jsonb_build_object('result', 'claimed', 'id', v_row.id);
end;
$$;
revoke all on function public.claim_channel_send(text, text, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_channel_send(text, text, text, uuid, text, uuid) to service_role;

-- 5. Email claim: the same gap in the other direction ------------------------
-- Unchanged except the 'gap' result: a lead whose first WhatsApp intro was
-- claimed less than channel_first_touch_gap_hours ago is not emailed yet (it
-- stays queued for a later run).
create or replace function public.claim_email_outreach_recipient(p_email text, p_lead_id uuid, p_suggestion_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_cap integer;
  v_today integer;
  v_gap integer;
begin
  perform pg_advisory_xact_lock(hashtext('hinza_email_outreach_claim'));

  if exists (select 1 from public.email_outreach_recipients where normalized_email = v_email) then
    return 'duplicate';
  end if;

  select coalesce(auto_email_daily_cap, 20), greatest(coalesce(channel_first_touch_gap_hours, 24), 24) into v_cap, v_gap from public.automation_settings where id = 1;

  if p_lead_id is not null then
    perform pg_advisory_xact_lock(hashtext('hinza_first_touch_gap'));
    if exists (
      select 1 from public.channel_outreach_messages
      where lead_id = p_lead_id and channel = 'whatsapp'
        and status in ('sending', 'sent', 'delivered', 'uncertain')
        and claimed_at > now() - make_interval(hours => v_gap)
    ) then
      return 'gap';
    end if;
  end if;

  select count(*) into v_today
  from public.email_outreach_recipients
  where status in ('claimed', 'sent', 'uncertain')
    and (claimed_at at time zone 'Asia/Tehran')::date = (now() at time zone 'Asia/Tehran')::date;
  if v_today >= v_cap then
    return 'cap_reached';
  end if;

  insert into public.email_outreach_recipients (normalized_email, lead_id, suggestion_id, status)
  values (v_email, p_lead_id, p_suggestion_id, 'claimed');
  return 'claimed';
end;
$$;
revoke all on function public.claim_email_outreach_recipient(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_outreach_recipient(text, uuid, uuid) to service_role;

-- Rollback (restores phase30's email claim first):
--   run the claim_email_outreach_recipient definition from phase30_email_daily_cap.sql
-- drop function if exists public.claim_channel_send(text, text, text, uuid, text, uuid);
-- drop table if exists public.whatsapp_provider_events;
-- drop index if exists public.channel_outreach_messages_provider_message_idx;
-- alter table public.channel_outreach_messages drop column if exists suggestion_id, drop column if exists claim_source,
--   drop column if exists provider_status_at, drop column if exists provider_status;
-- alter table public.automation_settings drop constraint if exists automation_settings_first_touch_gap_check,
--   drop column if exists channel_first_touch_gap_hours, drop column if exists whatsapp_test_mode;
