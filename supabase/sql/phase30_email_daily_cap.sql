-- Phase 30 - daily cap for the automatic intro email.
--
-- At most auto_email_daily_cap real sends per Tehran calendar day, across
-- every run (cron and admin "Run now"). Enforced inside the database by
-- claim_email_outreach_recipient(): one transaction-scoped advisory lock
-- serializes every claim, so concurrent runs can never overshoot the cap or
-- claim the same address twice. A claim counts toward the day while it is
-- 'claimed' (in flight), 'sent' or 'uncertain'; a definite 'failed' does
-- not. Additive; no row is deleted.

alter table public.automation_settings
  add column if not exists auto_email_daily_cap integer not null default 20;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_settings_auto_email_daily_cap_check') then
    alter table public.automation_settings
      add constraint automation_settings_auto_email_daily_cap_check check (auto_email_daily_cap between 1 and 100);
  end if;
end $$;

-- 7 scheduled runs x 3 = 21 >= 20, so the schedule alone can reach the cap;
-- the cap itself stops the 21st.
alter table public.automation_settings alter column auto_email_max_per_run set default 3;
update public.automation_settings set auto_email_max_per_run = 3, auto_email_daily_cap = 20 where id = 1;

create index if not exists email_outreach_recipients_claimed_at_idx on public.email_outreach_recipients (claimed_at);

-- Returns 'claimed' (caller may now send), 'duplicate' (address already
-- claimed/sent/failed/uncertain - never again) or 'cap_reached'.
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
begin
  perform pg_advisory_xact_lock(hashtext('hinza_email_outreach_claim'));

  if exists (select 1 from public.email_outreach_recipients where normalized_email = v_email) then
    return 'duplicate';
  end if;

  select coalesce(auto_email_daily_cap, 20) into v_cap from public.automation_settings where id = 1;
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

-- Rollback:
-- drop function if exists public.claim_email_outreach_recipient(text, uuid, uuid);
-- alter table public.automation_settings drop constraint if exists automation_settings_auto_email_daily_cap_check;
-- alter table public.automation_settings drop column if exists auto_email_daily_cap;
