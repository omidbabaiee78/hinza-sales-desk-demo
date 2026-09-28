-- Phase 36 - settling the candidate backlog. Additive only: new nullable
-- columns on prospect_candidates. Nothing here touches sending, the email
-- pipeline, its 20/day cap, opt-outs, bounce suppression, or the
-- WhatsApp/Bale switches.
--
-- Code: src/prospecting/candidateQueue.js (who is waiting, when the
-- scheduler reads them next), discoveryPipeline.js
-- verifyPendingCandidateSites() / processCandidateBacklog(), and
-- prospect-discovery's process_candidate_backlog mode.

-- Which version of the site-check rules last read the candidate's website;
-- a candidate read under older rules is read again (oldest first).
alter table public.prospect_candidates add column if not exists site_check_version integer;
comment on column public.prospect_candidates.site_check_version is 'Phase 36: candidateQueue.js SITE_CHECK_VERSION of the rules that last read this candidate''s website (null = before phase 36).';

-- Failed loads in a row; after MAX_SITE_FETCH_ATTEMPTS (3) the candidate
-- goes to a person with site_review_reason = site_unreachable.
alter table public.prospect_candidates add column if not exists site_check_attempts integer;
comment on column public.prospect_candidates.site_check_attempts is 'Phase 36: consecutive failed website loads (reset to 0 when the site loads).';

-- Why the site check could not decide on its own (only for manual_review):
-- site_unreadable / site_unreachable / not_iranian / insufficient_evidence /
-- name_unclear / conflicting_signals / possible_duplicate / no_website.
alter table public.prospect_candidates add column if not exists site_review_reason text;
comment on column public.prospect_candidates.site_review_reason is 'Phase 36: why a person must review this candidate (prospectingLabels.js REVIEW_REASON_LABELS).';

-- Verify:
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'prospect_candidates'
--   and column_name in ('site_check_version', 'site_check_attempts', 'site_review_reason');

-- Rollback:
-- alter table public.prospect_candidates drop column if exists site_review_reason, drop column if exists site_check_attempts,
--   drop column if exists site_check_version;
