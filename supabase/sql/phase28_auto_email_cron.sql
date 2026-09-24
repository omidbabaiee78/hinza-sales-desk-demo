-- Phase 28 - schedule for the automatic first-introduction email.
--
-- PREPARED ONLY. NOT APPLIED. Run only after:
--   1. phase28_auto_email.sql is applied,
--   2. the outreach-auto-email Edge Function is deployed with the secret
--      OUTREACH_AUTO_EMAIL_CRON_SECRET, and
--   3. one admin "اجرای اکنون" run has been reviewed on the outreach page.
-- The schedule only calls the function; the admin switch
-- (auto_email_enabled) still decides whether anything is sent.
--
-- Store the same secret in Vault first (value never committed):
--   select vault.create_secret('<secret>', 'outreach_auto_email_cron_secret');

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_outreach_auto_email()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'outreach_auto_email_cron_secret';

  if v_secret is null then
    raise exception 'outreach_auto_email_cron_secret is not set in Vault';
  end if;

  perform net.http_post(
    url := 'https://xgdwswagpcaviwpbfysm.supabase.co/functions/v1/outreach-auto-email',
    headers := jsonb_build_object('content-type', 'application/json', 'x-outreach-auto-email-secret', v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_outreach_auto_email() from public, anon, authenticated;

-- Hourly at 06:45-12:45 UTC = 10:15-16:15 Tehran (fixed +03:30). The
-- function itself also refuses to run outside the contact window.
select cron.schedule(
  'hinza-auto-intro-email',
  '45 6-12 * * *',
  $$select public.trigger_outreach_auto_email();$$
);

-- Stop: select cron.unschedule('hinza-auto-intro-email');
