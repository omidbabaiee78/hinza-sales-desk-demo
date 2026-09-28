-- Phase 38: Daily Manual Outreach.
--
-- Every Tehran day the admin gets up to 20 registered leads with a usable
-- phone number and contacts them BY HAND (WhatsApp, Bale, a call - the CRM
-- does not care which), ticking «پیام دادم» for each. Nothing here sends
-- anything: no provider, no pg_net, no Edge Function.
--
-- One row per lead, ever (unique lead_id): a lead is offered as a NEW
-- manual contact at most once. A contacted row is kept permanently; a
-- pending row that was not done carries over to the next day. A pending row
-- is removed as soon as the lead becomes do_not_contact or converted/lost.
-- Email outreach is independent: an emailed lead may still be listed, and
-- ticking a lead here does not touch sales_leads, so the email pipeline
-- sees no change.
--
-- Additive only. Nothing existing is altered or deleted. Rollback at the end.

create table if not exists public.manual_outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  assigned_on date not null,
  phone text not null,
  phone_kind text not null check (phone_kind in ('mobile', 'landline')),
  status text not null default 'pending' check (status in ('pending', 'contacted')),
  contacted_at timestamptz,
  contacted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_outreach_contacts_lead_unique unique (lead_id),
  constraint manual_outreach_contacts_contacted_at check ((status = 'contacted') = (contacted_at is not null))
);
create index if not exists manual_outreach_contacts_day_idx on public.manual_outreach_contacts (assigned_on);

alter table public.manual_outreach_contacts enable row level security;
drop policy if exists manual_outreach_contacts_admin_read on public.manual_outreach_contacts;
create policy manual_outreach_contacts_admin_read on public.manual_outreach_contacts for select to authenticated using (private.is_admin());
-- Writes only through the functions below.
revoke all on public.manual_outreach_contacts from anon, authenticated;
grant select on public.manual_outreach_contacts to authenticated;

-- First usable number of a lead: a valid Iranian mobile (from mobile, then
-- phone; Persian/Arabic digits and "a, b" lists accepted), else an Iranian
-- landline. E.164. Mirrors contactPoints.js firstMobile().
create or replace function private.manual_outreach_phone(p_mobile text, p_phone text)
returns table (phone text, kind text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_part text;
  v_digits text;
  v_landline text;
begin
  for v_part in
    select unnest(array[p_mobile] || regexp_split_to_array(coalesce(p_mobile, ''), '[،,]') || regexp_split_to_array(coalesce(p_phone, ''), '[،,]'))
  loop
    v_digits := regexp_replace(translate(coalesce(v_part, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '\D', '', 'g');
    if v_digits ~ '^(0098|98|0)?9[0-9]{9}$' then
      phone := '+98' || right(v_digits, 10);
      kind := 'mobile';
      return next;
      return;
    end if;
    if v_landline is null and v_digits ~ '^(0098|98|0)[1-8][0-9]{9}$' then
      v_landline := '+98' || right(v_digits, 10);
    end if;
  end loop;
  if v_landline is not null then
    phone := v_landline;
    kind := 'landline';
    return next;
  end if;
end;
$$;

-- Opted out (flag or a do_not_contact reply) or closed.
create or replace function private.manual_outreach_blocked(p_lead public.sales_leads)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_lead.do_not_contact
    or p_lead.status in ('converted', 'lost')
    or exists (
      select 1 from public.inbound_replies r
      where r.lead_id = p_lead.id and (r.final_intent = 'do_not_contact' or r.predicted_intent = 'do_not_contact')
    );
$$;

-- Builds the list for p_day (idempotent; serialized by an advisory lock):
--   1. drop pending rows whose lead is now blocked or has no usable number,
--      and refresh the number of the rest;
--   2. carry earlier days' pending rows over to p_day;
--   3. fill p_day up to 20 rows (pending + contacted) with leads that were
--      never listed: mobile before landline, then the qualification score,
--      then the oldest lead first.
-- p_pool limits step 3 to the given leads (used by the SQL checks only).
create or replace function private.manual_outreach_fill(p_day date, p_pool uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('hinza_manual_outreach_day'));

  delete from public.manual_outreach_contacts m
  using public.sales_leads l
  where m.lead_id = l.id and m.status = 'pending'
    and (private.manual_outreach_blocked(l) or not exists (select 1 from private.manual_outreach_phone(l.mobile, l.phone)));

  update public.manual_outreach_contacts m
  set phone = p.phone, phone_kind = p.kind, updated_at = now()
  from public.sales_leads l, private.manual_outreach_phone(l.mobile, l.phone) p
  where m.lead_id = l.id and m.status = 'pending' and (m.phone, m.phone_kind) is distinct from (p.phone, p.kind);

  update public.manual_outreach_contacts
  set assigned_on = p_day, updated_at = now()
  where status = 'pending' and assigned_on < p_day;

  select count(*) into v_count from public.manual_outreach_contacts where assigned_on = p_day;

  if v_count < 20 then
    insert into public.manual_outreach_contacts (lead_id, assigned_on, phone, phone_kind)
    select l.id, p_day, p.phone, p.kind
    from public.sales_leads l
    cross join lateral private.manual_outreach_phone(l.mobile, l.phone) p
    left join lateral (
      select max(c.overall_score) as score from public.prospect_candidates c where c.promoted_lead_id = l.id
    ) q on true
    where not private.manual_outreach_blocked(l)
      and not exists (select 1 from public.manual_outreach_contacts m where m.lead_id = l.id)
      and (p_pool is null or l.id = any (p_pool))
    order by (p.kind = 'mobile') desc, q.score desc nulls last, l.created_at asc, l.id
    limit 20 - v_count
    on conflict (lead_id) do nothing;
  end if;

  return (
    select jsonb_build_object(
      'day', p_day,
      'total', count(*),
      'contacted', count(*) filter (where status = 'contacted')
    )
    from public.manual_outreach_contacts where assigned_on = p_day
  );
end;
$$;
revoke all on function private.manual_outreach_fill(date, uuid[]) from public, anon, authenticated;

-- Admin: today's (Tehran) list, prepared on demand.
create or replace function public.prepare_manual_outreach_day()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return private.manual_outreach_fill((now() at time zone 'Asia/Tehran')::date);
end;
$$;
revoke all on function public.prepare_manual_outreach_day() from public, anon;
grant execute on function public.prepare_manual_outreach_day() to authenticated;

-- Admin: tick / untick «پیام دادم». Ticking stamps contacted_at and the
-- admin. Unticking (a mistake) is only possible on the day the row is
-- listed, so an old contact can never become a new one again.
create or replace function public.set_manual_outreach_contacted(p_id uuid, p_contacted boolean)
returns public.manual_outreach_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.manual_outreach_contacts;
begin
  if not private.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_contacted then
    update public.manual_outreach_contacts
    set status = 'contacted', contacted_at = coalesce(contacted_at, now()), contacted_by = coalesce(contacted_by, auth.uid()), updated_at = now()
    where id = p_id
    returning * into v_row;
  else
    update public.manual_outreach_contacts
    set status = 'pending', contacted_at = null, contacted_by = null, updated_at = now()
    where id = p_id and assigned_on = (now() at time zone 'Asia/Tehran')::date
    returning * into v_row;
  end if;
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;
revoke all on function public.set_manual_outreach_contacted(uuid, boolean) from public, anon;
grant execute on function public.set_manual_outreach_contacted(uuid, boolean) to authenticated;

-- A lead marked do_not_contact or closed leaves the pending list at once.
create or replace function private.manual_outreach_withdraw()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.manual_outreach_contacts where lead_id = new.id and status = 'pending';
  return new;
end;
$$;
drop trigger if exists sales_leads_manual_outreach_withdraw on public.sales_leads;
create trigger sales_leads_manual_outreach_withdraw
  after update of do_not_contact, status on public.sales_leads
  for each row when (new.do_not_contact or new.status in ('converted', 'lost'))
  execute function private.manual_outreach_withdraw();

notify pgrst, 'reload schema';

-- Rollback:
-- drop trigger if exists sales_leads_manual_outreach_withdraw on public.sales_leads;
-- drop function if exists private.manual_outreach_withdraw();
-- drop function if exists public.set_manual_outreach_contacted(uuid, boolean);
-- drop function if exists public.prepare_manual_outreach_day();
-- drop function if exists private.manual_outreach_fill(date, uuid[]);
-- drop function if exists private.manual_outreach_blocked(public.sales_leads);
-- drop function if exists private.manual_outreach_phone(text, text);
-- drop table if exists public.manual_outreach_contacts;
