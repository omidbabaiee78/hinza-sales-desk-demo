-- Phase 31 - automatic public email lookup for leads without an email.
-- Additive only: four nullable columns on sales_leads. The lookup (run by
-- the outreach-auto-email function in batches) fills sales_leads.email only
-- when it was empty, and always records where it came from and why a
-- lookup failed.

alter table public.sales_leads add column if not exists email_source_url text;
alter table public.sales_leads add column if not exists email_lookup_status text;
alter table public.sales_leads add column if not exists email_lookup_reason text;
alter table public.sales_leads add column if not exists email_lookup_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_leads_email_lookup_status_check') then
    alter table public.sales_leads
      add constraint sales_leads_email_lookup_status_check check (
        email_lookup_status is null or email_lookup_status in (
          'found', 'no_website', 'not_official_website', 'identity_mismatch', 'fetch_failed', 'no_email_on_site', 'only_other_domain'
        )
      );
  end if;
end $$;

comment on column public.sales_leads.email_source_url is 'Phase 31: public page on the company''s own website where the email was found.';
comment on column public.sales_leads.email_lookup_status is 'Phase 31: result of the last automatic email lookup.';

-- Rollback:
-- alter table public.sales_leads drop constraint if exists sales_leads_email_lookup_status_check;
-- alter table public.sales_leads drop column if exists email_lookup_at, drop column if exists email_lookup_reason,
--   drop column if exists email_lookup_status, drop column if exists email_source_url;
