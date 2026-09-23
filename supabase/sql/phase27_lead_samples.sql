-- Phase 27 - Lead sample tracking: database additions.
--
-- PREPARED ONLY. NOT APPLIED. Same "prepared, reviewed and run by hand in
-- the SQL editor" pattern as every prior phase's SQL file in this directory.
--
-- Everything here is additive: one new admin-only table. No existing
-- table/column/row is altered, dropped, or renamed. Existing lead notes
-- (lead_activities, including old free-text 'sample' entries) and
-- sales_leads.next_follow_up_at are never touched by this file.

-- =============================================================================
-- 0. Pre-check (run first): products.id and sales_leads.id must both be uuid.
--    If either returns something else, STOP and do not run section 1.
-- =============================================================================

-- select table_name, data_type from information_schema.columns
-- where table_schema = 'public' and column_name = 'id'
-- and table_name in ('products', 'sales_leads');

-- =============================================================================
-- 1. lead_samples - one row per sample sent to a lead.
-- =============================================================================

create table if not exists public.lead_samples (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity_kg numeric(12, 2) not null check (quantity_kg > 0),
  sent_on date not null,
  feedback_due_on date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  feedback_note text,
  resolved_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint lead_samples_due_after_sent_check check (feedback_due_on >= sent_on)
);

comment on table public.lead_samples is
  'Phase 27: samples sent to a sales lead (product, quantity, sent date, feedback due date) and the customer''s feedback outcome. Pending rows with feedback_due_on <= today appear on the admin Today page.';

create index if not exists lead_samples_lead_id_idx on public.lead_samples (lead_id);
create index if not exists lead_samples_pending_due_idx on public.lead_samples (feedback_due_on) where status = 'pending';

-- =============================================================================
-- 2. RLS - admin only, same shape as prospect_outreach_suggestions (Phase 25).
-- =============================================================================

alter table public.lead_samples enable row level security;

drop policy if exists lead_samples_admin_all on public.lead_samples;
create policy lead_samples_admin_all on public.lead_samples for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- =============================================================================
-- Verification (safe to run any time)
-- =============================================================================

-- select policyname, cmd from pg_policies where tablename = 'lead_samples';
-- select * from public.lead_samples order by created_at desc limit 20;

-- =============================================================================
-- Rollback - removes ONLY what this file added (and any sample rows in it).
-- =============================================================================

-- drop table if exists public.lead_samples;
