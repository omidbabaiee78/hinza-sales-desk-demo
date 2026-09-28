-- Phase 39: Simple CRM.
--
-- A small, hand-curated list of companies/people that became real sales
-- opportunities. It is NOT the prospect/lead database: a record exists only
-- when the admin adds one. A record may point at the lead it came from
-- (linked_lead_id), but it is an independent copy - editing it never
-- touches sales_leads, and nothing here writes to sales_leads.
--
-- Create / view / edit only; there is no delete path (no delete policy or
-- grant). Additive only: no existing table, row or policy is changed.
-- Rollback at the end.

create table if not exists public.crm_records (
  id uuid primary key default gen_random_uuid(),
  linked_lead_id uuid references public.sales_leads(id) on delete set null,
  company_name text not null check (btrim(company_name) <> ''),
  contact_name text,
  phone text,
  email text,
  city text,
  product_interest text,
  notes text,
  source text not null default 'manual_entry' check (source in ('email_outreach', 'manual_outreach', 'manual_entry')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One CRM record per lead (records without a lead are unlimited).
  constraint crm_records_linked_lead_unique unique (linked_lead_id)
);
create index if not exists crm_records_updated_at_idx on public.crm_records (updated_at desc);

-- updated_at / updated_by on every edit; created_* cannot be rewritten.
create or replace function private.crm_records_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_records_touch on public.crm_records;
create trigger crm_records_touch before insert or update on public.crm_records
  for each row execute function private.crm_records_touch();

alter table public.crm_records enable row level security;
drop policy if exists crm_records_admin_select on public.crm_records;
drop policy if exists crm_records_admin_insert on public.crm_records;
drop policy if exists crm_records_admin_update on public.crm_records;
create policy crm_records_admin_select on public.crm_records for select to authenticated using (private.is_admin());
create policy crm_records_admin_insert on public.crm_records for insert to authenticated with check (private.is_admin());
create policy crm_records_admin_update on public.crm_records for update to authenticated using (private.is_admin()) with check (private.is_admin());
revoke all on public.crm_records from anon, authenticated;
grant select, insert, update on public.crm_records to authenticated;

notify pgrst, 'reload schema';

-- Rollback:
-- drop table if exists public.crm_records;
-- drop function if exists private.crm_records_touch();
