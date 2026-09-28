-- Simple CRM - database checks against the linked project, in ONE
-- transaction that is rolled back (no CRM record is kept). Run after the
-- phase39 migration:
--   npx supabase db query --linked -f scripts/checkSimpleCrm.sql
-- A failing check raises; success ends with 'simple crm checks passed'.

begin;

do $$
declare
  v_admin uuid;
  v_lead public.sales_leads;
  v_lead_after public.sales_leads;
  v_leads_before bigint;
  v_leads_hash_before text;
  v_id uuid;
  v_row public.crm_records;
  v_n integer;
begin
  select id into v_admin from public.profiles where role = 'admin' and approval_status = 'approved' limit 1;
  select * into v_lead from public.sales_leads order by created_at limit 1;
  select count(*), md5(string_agg(l::text, '|' order by l.id)) into v_leads_before, v_leads_hash_before from public.sales_leads l;

  -- Records written in these checks are rolled back at the end; any real
  -- records already there are simply counted around.
  select count(*) into v_n from public.crm_records;

  -- 1. As the admin (RLS applies: role authenticated) ------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  insert into public.crm_records (company_name, contact_name, phone, source)
    values ('CRM check manual', 'Ali', '09120000001', 'manual_entry') returning id into v_id;
  select * into v_row from public.crm_records where id = v_id;
  if v_row.created_by is distinct from v_admin or v_row.linked_lead_id is not null then raise exception 'create: %', row_to_json(v_row); end if;

  insert into public.crm_records (linked_lead_id, company_name, phone, email, city, source)
    values (v_lead.id, coalesce(v_lead.company_name, 'x'), v_lead.mobile, v_lead.email, v_lead.city, 'email_outreach') returning id into v_id;

  -- Edit contact, phone, email, product interest, multi-line notes.
  update public.crm_records
    set contact_name = 'Reza', phone = '09350000000', email = 'crm-check@example.invalid', product_interest = 'Masterbatch White',
        notes = E'line one\nline two'
    where id = v_id;
  select * into v_row from public.crm_records where id = v_id;
  if v_row.notes <> E'line one\nline two' or v_row.product_interest <> 'Masterbatch White' or v_row.contact_name <> 'Reza' then
    raise exception 'edit not stored: %', row_to_json(v_row);
  end if;

  -- Duplicate linked lead is refused by the database.
  begin
    insert into public.crm_records (linked_lead_id, company_name) values (v_lead.id, 'dup');
    raise exception 'duplicate linked lead allowed';
  exception when unique_violation then null;
  end;

  -- No delete path: the row survives a delete attempt.
  begin
    delete from public.crm_records where id = v_id;
    raise exception 'delete allowed';
  exception when insufficient_privilege then null;
  end;

  reset role;

  -- 2. The linked lead and the lead table are untouched ----------------------
  select * into v_lead_after from public.sales_leads where id = v_lead.id;
  if row_to_json(v_lead_after)::text <> row_to_json(v_lead)::text then raise exception 'linked lead changed'; end if;
  if (select md5(string_agg(l::text, '|' order by l.id)) from public.sales_leads l) <> v_leads_hash_before
     or (select count(*) from public.sales_leads) <> v_leads_before then
    raise exception 'sales_leads changed';
  end if;
  if (select count(*) from public.crm_records) <> v_n + 2 then raise exception 'unexpected CRM rows'; end if;

  -- 3. A signed-in non-admin sees nothing and cannot write -------------------
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (current_setting('request.jwt.claims')::json->>'sub'), true);
  set local role authenticated;
  if (select count(*) from public.crm_records) <> 0 then raise exception 'non-admin can read CRM'; end if;
  begin
    insert into public.crm_records (company_name) values ('intruder');
    raise exception 'non-admin insert allowed';
  exception when insufficient_privilege then null;
  end;
  update public.crm_records set notes = 'hacked';
  reset role;
  if exists (select 1 from public.crm_records where notes = 'hacked') then raise exception 'non-admin update applied'; end if;

  -- 4. Anonymous: no access at all ------------------------------------------
  set local role anon;
  begin
    perform 1 from public.crm_records;
    raise exception 'anon can read CRM';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

select 'simple crm checks passed' as result;

rollback;
