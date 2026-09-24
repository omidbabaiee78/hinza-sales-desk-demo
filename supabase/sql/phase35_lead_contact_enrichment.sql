-- Phase 35 - contact enrichment for registered leads (email + phone numbers
-- published on the company's own website). Additive only: new nullable
-- columns. Nothing here touches sending, the email pipeline, its 20/day cap,
-- or the WhatsApp/Bale switches.
--
-- Code: src/prospecting/leadContactEnrichment.js (backlog + new leads, run
-- by prospect-discovery's scheduled runs and its enrich_contacts mode),
-- src/outreach/emailDiscovery.js extractPhones().

-- Where an automatically added phone/mobile was published (email already
-- has email_source_url), and the result of the last contact enrichment.
alter table public.sales_leads add column if not exists phone_source_url text;
alter table public.sales_leads add column if not exists contact_lookup_status text;
alter table public.sales_leads add column if not exists contact_lookup_at timestamptz;
comment on column public.sales_leads.phone_source_url is 'Phase 35: page on the company''s own website where an automatically added mobile/phone was published.';
comment on column public.sales_leads.contact_lookup_status is 'Phase 35: found / nothing_new / no_email_on_site / only_other_domain / identity_mismatch / not_official_website / fetch_failed / no_website.';

-- One entry per contact the company's own site publishes, so a second
-- number found on another page keeps its own source:
-- [{ field: 'email'|'mobile'|'phone', value, sourceUrl }]
alter table public.sales_leads add column if not exists contact_sources jsonb;
comment on column public.sales_leads.contact_sources is 'Phase 35: [{field, value, sourceUrl}] - the page of the company''s own website publishing each contact.';

alter table public.prospect_candidates add column if not exists site_phone_source_url text;
comment on column public.prospect_candidates.site_phone_source_url is 'Phase 35: page on the candidate''s own website where its phone/mobile was published.';

-- Rollback:
-- alter table public.prospect_candidates drop column if exists site_phone_source_url;
-- alter table public.sales_leads drop column if exists contact_sources, drop column if exists contact_lookup_at, drop column if exists contact_lookup_status,
--   drop column if exists phone_source_url;
