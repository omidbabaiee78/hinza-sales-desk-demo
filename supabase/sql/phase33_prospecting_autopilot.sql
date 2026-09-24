-- Phase 33 - autonomous prospecting that actually finds new companies and
-- their public emails every day.
--
-- Why (production, 2026-09-22..24): every daily run sent the SAME 15
-- queries, first result page only -> the same ~100 links each day, 2-7 new
-- candidates. Real manufacturers were judged on a two-line Google snippet,
-- scored ~42 (bar 45) and waited in manual_review (88 rows) that nobody
-- reviews. This file:
--   1. adds the columns the site-verification step and the lead
--      official-site search record their work in,
--   2. switches the Serper source to query rotation (product x city x
--      result page, cursor saved between runs),
--   3. runs discovery 10 times a day before/through the send window,
--      stopping once 20 new public emails were found that day.
-- Code: src/prospecting/siteVerification.js, leadSiteSearch.js,
-- discoveryPipeline.js (verifyPendingCandidateSites,
-- searchOfficialSitesForLeads), sourceAdapters/serperSearch.js.
-- The sender (outreach-auto-email, its 20/day cap, address dedupe,
-- opt-outs and bounce suppression) is unchanged.

-- 1. Columns -----------------------------------------------------------------

alter table public.prospect_candidates add column if not exists site_checked_at timestamptz;
alter table public.prospect_candidates add column if not exists site_check_status text;
alter table public.prospect_candidates add column if not exists site_email_source_url text;
comment on column public.prospect_candidates.site_checked_at is 'Phase 33: when the candidate''s own website was read (verifyPendingCandidateSites).';
comment on column public.prospect_candidates.site_check_status is 'Phase 33: email_found / no_email_on_site / only_other_domain / not_company / fetch_failed / no_website / checked.';

alter table public.sales_leads add column if not exists official_site_search_at timestamptz;
comment on column public.sales_leads.official_site_search_at is 'Phase 33: when a web search for this lead''s official website ran (leads whose recorded website is not their own).';

alter table public.prospect_settings add column if not exists daily_new_email_target integer not null default 20;
comment on column public.prospect_settings.daily_new_email_target is 'Phase 33: scheduled discovery runs stop for the day once this many new public emails were found (Tehran day). Independent of the sender''s own daily cap.';

-- 2. Limits per run (10 runs a day) --------------------------------------------
-- 14 external requests = 10 rotating searches + up to 4 lead official-site
-- searches. 110 s keeps each run well inside the Edge Function limit.

update public.prospect_settings
set max_external_requests_per_run = 14,
    max_promotions_per_run = 40,
    max_candidates_per_source_per_run = 200,
    run_timeout_ms = 110000,
    updated_at = now()
where id = 1;

-- 3. Rotating Serper source ------------------------------------------------------
-- 40 product queries x 20 locations (see DEFAULT_LOCATIONS) x 3 result
-- pages = 2400 searches, ~24 days before the rotation wraps around.

update public.prospect_sources
set config = config || jsonb_build_object(
      'rotate', true,
      'queriesPerRun', 10,
      'maxPages', 3,
      -- 15 = skip the 15 first-page queries the old daily job already ran.
      'rotationCursor', coalesce((config->>'rotationCursor')::int, 15),
      'queryTemplates', jsonb_build_array(
        'تولید کننده فیلم پلی اتیلن',
        'تولید کننده نایلون و نایلکس',
        'تولید کننده فیلم کشاورزی',
        'تولید کننده شیرینگ',
        'تولید کننده لوله پلی اتیلن',
        'تولید کننده تیپ آبیاری',
        'کارخانه تزریق پلاستیک',
        'تولید کننده قطعات پلاستیکی',
        'تولید کننده ظروف پلاستیکی',
        'تولید کننده PET و پریفرم',
        'تولید کننده ورق پلی کربنات',
        'تولید کننده ABS',
        'کارخانه اکستروژن پلاستیک',
        'تولید کننده شیلنگ پلاستیکی',
        'تولید کننده کامپاند پلیمری',
        'تولید کننده کیسه پلاستیکی',
        'تولید کننده بطری پلاستیکی',
        'تولید کننده پروفیل upvc',
        'تولید کننده لوله pvc',
        'تولید کننده کامپاند pvc',
        'تولید کننده سیم و کابل',
        'تولید کننده کفپوش pvc',
        'تولید کننده چمن مصنوعی',
        'تولید کننده گونی پلاستیکی',
        'تولید کننده الیاف پلی پروپیلن',
        'تولید کننده منسوج بی بافت',
        'تولید کننده قطعات پلاستیکی خودرو',
        'تولید کننده لوازم خانگی پلاستیکی',
        'تولید کننده اسباب بازی پلاستیکی',
        'تولید کننده بسته بندی پلاستیکی مواد غذایی',
        'تولید کننده نایلون حبابدار',
        'تولید کننده درب بطری پلاستیکی',
        'تولید کننده ژئوممبران',
        'تولید کننده مخزن پلاستیکی',
        'تولید کننده فوم پلی اتیلن',
        'تولید کننده سفره یکبار مصرف',
        'تولید کننده سبد و جعبه پلاستیکی',
        'تولید کننده ظروف یکبار مصرف',
        'تولید کننده نوار بسته بندی',
        'کارخانه بادی پلاستیک'
      )
    ),
    updated_at = now()
where source_type = 'search_result';

-- 4. Re-check existing leads with the fixed email extraction ------------------
-- ([at]-obfuscated and Cloudflare-encoded addresses, footers past 300 KB,
-- «ارتباط با ما»/about pages). The sender's hourly lookup picks leads with
-- no email_lookup_at first; nothing is sent by this statement.

update public.sales_leads
set email_lookup_at = null
where coalesce(email, '') = ''
  and email_lookup_status in ('no_email_on_site', 'only_other_domain', 'fetch_failed');

-- 5. Schedule: 10 runs a day, 02:15-11:15 UTC = 05:45-14:45 Tehran --------------
-- Same job name as before (cron.schedule updates it in place), same
-- trigger_prospect_discovery() -> prospect-discovery function, same Vault
-- secret. Runs are serialized by the existing scheduled-run guard; each
-- stops early once the day's email target is reached.

select cron.schedule('hinza-daily-prospecting', '15 2-11 * * *', $$select public.trigger_prospect_discovery();$$);

-- Verify:
-- select jobname, schedule, active from cron.job where jobname = 'hinza-daily-prospecting';
-- select started_at, status, candidates_created, candidates_promoted, summary->'siteVerification'
--   from prospect_discovery_runs order by started_at desc limit 5;

-- Rollback:
-- select cron.schedule('hinza-daily-prospecting', '0 5 * * *', $$select public.trigger_prospect_discovery();$$);
-- update public.prospect_sources set config = config - 'rotate' - 'queriesPerRun' - 'maxPages' - 'rotationCursor' where source_type = 'search_result';
-- update public.prospect_settings set max_external_requests_per_run = 20, max_promotions_per_run = 10,
--   max_candidates_per_source_per_run = 100, run_timeout_ms = 240000 where id = 1;
-- alter table public.prospect_settings drop column if exists daily_new_email_target;
-- alter table public.sales_leads drop column if exists official_site_search_at;
-- alter table public.prospect_candidates drop column if exists site_email_source_url,
--   drop column if exists site_check_status, drop column if exists site_checked_at;
