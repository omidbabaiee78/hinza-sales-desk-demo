-- Phase 28 - automatic first-introduction email: admin switch + per-run limit.
--
-- PREPARED ONLY. NOT APPLIED. Additive and safe to re-run: two columns with
-- safe defaults (switch OFF). Nothing is sent by applying this - sending
-- also needs the outreach-auto-email Edge Function deployed and the admin
-- switch turned on in the outreach page.

alter table public.automation_settings
  add column if not exists auto_email_enabled boolean not null default false;

alter table public.automation_settings
  add column if not exists auto_email_max_per_run integer not null default 3;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_settings_auto_email_max_per_run_check') then
    alter table public.automation_settings
      add constraint automation_settings_auto_email_max_per_run_check
      check (auto_email_max_per_run between 1 and 10);
  end if;
end $$;

comment on column public.automation_settings.auto_email_enabled is
  'Phase 28: admin on/off switch for the automatic first-introduction email (outreach-auto-email). Default off.';
comment on column public.automation_settings.auto_email_max_per_run is
  'Phase 28: maximum automatic intro emails attempted per run (1-10).';

-- Rollback:
-- alter table public.automation_settings drop constraint if exists automation_settings_auto_email_max_per_run_check;
-- alter table public.automation_settings drop column if exists auto_email_max_per_run;
-- alter table public.automation_settings drop column if exists auto_email_enabled;
