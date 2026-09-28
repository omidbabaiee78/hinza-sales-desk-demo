-- Daily Manual Outreach - database checks against the linked project.
-- Everything runs in ONE transaction that is rolled back: no lead, list row
-- or reply is kept, and nothing is sent. Run after the phase38 migration:
--   npx supabase db query --linked -f scripts/checkManualOutreach.sql
-- A failing check raises an exception; success ends with
-- 'manual outreach checks passed'.

begin;

create temporary table t_ids (k text primary key, id uuid) on commit drop;

do $$
declare
  v_admin uuid;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
  v_d1 date := date '2099-01-01';
  v_d2 date := date '2099-01-02';
  v_r jsonb;
  v_n integer;
  v_eligible integer;
  v_row public.manual_outreach_contacts;
  v_pool uuid[];
begin
  select id into v_admin from public.profiles where role = 'admin' and approval_status = 'approved' limit 1;
  if v_admin is null then raise exception 'no approved admin'; end if;

  -- 1. Phone parsing ---------------------------------------------------------
  if (select phone from private.manual_outreach_phone('۰۹۱۲ ۱۲۳ ۴۵۶۷', null)) is distinct from '+989121234567' then
    raise exception 'persian-digit mobile not parsed';
  end if;
  if (select phone || kind from private.manual_outreach_phone(null, '021-88776655، 0935 111 2233')) is distinct from '+989351112233mobile' then
    raise exception 'mobile inside phone list not preferred';
  end if;
  if (select phone || kind from private.manual_outreach_phone('', '02188776655')) is distinct from '+982188776655landline' then
    raise exception 'landline not parsed';
  end if;
  if exists (select 1 from private.manual_outreach_phone('12345', 'info@x.ir')) then
    raise exception 'garbage parsed as phone';
  end if;

  -- 2. Real data: today's list ----------------------------------------------
  delete from public.manual_outreach_contacts;
  select count(*) into v_eligible
  from public.sales_leads l
  where not private.manual_outreach_blocked(l) and exists (select 1 from private.manual_outreach_phone(l.mobile, l.phone));
  v_r := private.manual_outreach_fill(v_today);
  select count(*) into v_n from public.manual_outreach_contacts where assigned_on = v_today;
  if v_n <> least(20, v_eligible) or (v_r->>'total')::int <> v_n then
    raise exception 'real list size % (eligible %, report %)', v_n, v_eligible, v_r;
  end if;
  if exists (
    select 1 from public.manual_outreach_contacts m join public.sales_leads l on l.id = m.lead_id
    where l.do_not_contact or l.status in ('converted', 'lost') or m.phone !~ '^\+98[1-9][0-9]{9}$'
  ) then
    raise exception 'ineligible lead in real list';
  end if;
  -- Idempotent: a second call adds nothing.
  perform private.manual_outreach_fill(v_today);
  if (select count(*) from public.manual_outreach_contacts) <> v_n then raise exception 'second fill changed the list'; end if;
  raise notice 'real data: % eligible leads with a phone, today lists %', v_eligible, v_n;

  -- 3. Test leads (limited to a pool so real leads stay out) ----------------
  delete from public.manual_outreach_contacts;
  insert into t_ids values
    ('mobile', gen_random_uuid()), ('landline', gen_random_uuid()), ('emailed', gen_random_uuid()),
    ('dnc', gen_random_uuid()), ('lost', gen_random_uuid()), ('nophone', gen_random_uuid()),
    ('dncreply', gen_random_uuid());
  insert into public.sales_leads (id, company_name, mobile, phone, email, status, do_not_contact, created_at) values
    ((select id from t_ids where k = 'mobile'), 'T mobile', '۰۹۱۲۰۰۰۰۰۰۱', null, null, 'new', false, now() - interval '3 days'),
    ((select id from t_ids where k = 'landline'), 'T landline', null, '02100000001', null, 'new', false, now() - interval '5 days'),
    ((select id from t_ids where k = 'emailed'), 'T emailed', '09120000002', null, 'manual-check@example.invalid', 'new', false, now() - interval '1 days'),
    ((select id from t_ids where k = 'dnc'), 'T dnc', '09120000003', null, null, 'new', true, now()),
    ((select id from t_ids where k = 'lost'), 'T lost', '09120000004', null, null, 'lost', false, now()),
    ((select id from t_ids where k = 'nophone'), 'T nophone', null, null, 'x@example.invalid', 'new', false, now()),
    ((select id from t_ids where k = 'dncreply'), 'T dnc reply', '09120000005', null, null, 'new', false, now());
  insert into public.email_outreach_recipients (normalized_email, lead_id, status)
    values ('manual-check@example.invalid', (select id from t_ids where k = 'emailed'), 'sent');
  insert into public.inbound_replies (lead_id, raw_message, predicted_intent)
    values ((select id from t_ids where k = 'dncreply'), 'test', 'do_not_contact');
  select array_agg(id) into v_pool from t_ids;

  v_r := private.manual_outreach_fill(v_d1, v_pool);
  if (select array_agg(k order by k) from t_ids t join public.manual_outreach_contacts m on m.lead_id = t.id) <> array['emailed', 'landline', 'mobile'] then
    raise exception 'pool list wrong: %', (select array_agg(k) from t_ids t join public.manual_outreach_contacts m on m.lead_id = t.id);
  end if;
  if (select phone_kind from public.manual_outreach_contacts where lead_id = (select id from t_ids where k = 'landline')) <> 'landline' then
    raise exception 'landline kind';
  end if;

  -- 4. Tick «پیام دادم» as the admin ------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select id into v_row.id from public.manual_outreach_contacts where lead_id = (select id from t_ids where k = 'mobile');
  v_row := public.set_manual_outreach_contacted(v_row.id, true);
  if v_row.status <> 'contacted' or v_row.contacted_at is null or v_row.contacted_by is distinct from v_admin then
    raise exception 'contacted not stored: %', row_to_json(v_row);
  end if;
  -- An old day's contact cannot be unticked (2099 is not today).
  begin
    perform public.set_manual_outreach_contacted(v_row.id, false);
    raise exception 'untick of another day allowed';
  exception when sqlstate 'P0002' then null;
  end;
  if (select status from public.manual_outreach_contacts where id = v_row.id) <> 'contacted' then raise exception 'untick changed row'; end if;
  -- Nothing on the lead itself changed (email pipeline reads these).
  if (select last_contact_at from public.sales_leads where id = (select id from t_ids where k = 'mobile')) is not null then
    raise exception 'last_contact_at touched';
  end if;

  -- 5. Next day: pending carries over, contacted is not reselected ----------
  v_r := private.manual_outreach_fill(v_d2, v_pool);
  if (select count(*) from public.manual_outreach_contacts where assigned_on = v_d2) <> 2 then raise exception 'carry-over count %', v_r; end if;
  if (select assigned_on from public.manual_outreach_contacts where id = v_row.id) <> v_d1 then raise exception 'contacted row moved'; end if;
  if (select count(*) from public.manual_outreach_contacts where lead_id = (select id from t_ids where k = 'mobile')) <> 1 then raise exception 'contacted lead reselected'; end if;

  -- 6. Later do_not_contact / closed: pending row withdrawn, history kept ---
  update public.sales_leads set do_not_contact = true where id = (select id from t_ids where k = 'landline');
  update public.sales_leads set status = 'lost' where id = (select id from t_ids where k = 'emailed');
  update public.sales_leads set do_not_contact = true where id = (select id from t_ids where k = 'mobile');
  if exists (select 1 from public.manual_outreach_contacts where lead_id in (select id from t_ids where k in ('landline', 'emailed'))) then
    raise exception 'dnc/lost pending row not withdrawn';
  end if;
  if not exists (select 1 from public.manual_outreach_contacts where id = v_row.id and status = 'contacted') then
    raise exception 'contacted history lost';
  end if;
  v_r := private.manual_outreach_fill(v_d2 + 1, v_pool);
  if exists (select 1 from public.manual_outreach_contacts where assigned_on = v_d2 + 1) then raise exception 'dnc lead reselected'; end if;

  -- 7. DB-level duplicate protection -----------------------------------------
  begin
    insert into public.manual_outreach_contacts (lead_id, assigned_on, phone, phone_kind)
      values ((select id from t_ids where k = 'mobile'), v_d2 + 5, '+989120000001', 'mobile');
    raise exception 'duplicate lead row allowed';
  exception when unique_violation then null;
  end;
  begin
    update public.manual_outreach_contacts set contacted_at = null where id = v_row.id;
    raise exception 'contacted without contacted_at allowed';
  exception when check_violation then null;
  end;

  -- 8. Admin-only RPCs -------------------------------------------------------
  v_r := public.prepare_manual_outreach_day();
  if (v_r->>'day')::date <> v_today or (v_r->>'total')::int > 20 then raise exception 'prepare as admin: %', v_r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.prepare_manual_outreach_day();
    raise exception 'non-admin prepare allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_manual_outreach_contacted(v_row.id, true);
    raise exception 'non-admin tick allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 9. Privileges: the browser roles cannot write the table or call the filler.
select case
  when has_table_privilege('authenticated', 'public.manual_outreach_contacts', 'INSERT')
    or has_table_privilege('authenticated', 'public.manual_outreach_contacts', 'UPDATE')
    or has_table_privilege('anon', 'public.manual_outreach_contacts', 'SELECT')
    or has_function_privilege('authenticated', 'private.manual_outreach_fill(date, uuid[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.prepare_manual_outreach_day()', 'EXECUTE')
  then 'PRIVILEGE CHECK FAILED'
  else 'manual outreach checks passed'
end as result;

rollback;
