// ---------------------------------------------------------------------------
// Where each discovered candidate stands, shared by the server's site step
// (discoveryPipeline.js verifyPendingCandidateSites) and the admin page, so
// the page says exactly what the scheduler will do:
//   waiting    - its site will be read automatically (never read, read under
//                older rules, or a failed load due for retry)
//   eligible   - same, and its search result already qualifies; the site
//                read confirms it and registers it without approval
//   attention  - the system cannot decide; site_review_reason says why
//   registered - a lead was created
//   closed     - rejected or a duplicate of an existing lead
// ---------------------------------------------------------------------------

// Bumped whenever the site-check rules change: every waiting candidate read
// under an older version is read again, oldest first, within the per-run
// limit. 2 = homepage product evidence, portal-hosted pages, explicit
// reject/review decisions, fuzzy names re-checked against current leads.
export const SITE_CHECK_VERSION = 2
export const MAX_SITE_CHECKS_PER_RUN = 12
export const SITE_FETCH_RETRY_DAYS = 3
// A site that fails to load this many times goes to a person.
export const MAX_SITE_FETCH_ATTEMPTS = 3

// Mirror of the hinza-daily-prospecting cron (supabase/sql/
// phase33_prospecting_autopilot.sql): minute 15 of hours 02-11 UTC.
const SCHEDULE_MINUTE_UTC = 15
const SCHEDULE_FIRST_HOUR_UTC = 2
const SCHEDULE_LAST_HOUR_UTC = 11

const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_STATUSES = new Set(['manual_review', 'qualified'])

function fetchAttempts(candidate) {
  if (candidate.site_check_attempts != null) return candidate.site_check_attempts
  // Checked before attempts were counted: one failure on record.
  return candidate.site_check_status === 'fetch_failed' ? 1 : 0
}

export function isSitePending(candidate, now = Date.now()) {
  if (!OPEN_STATUSES.has(candidate.status) || !candidate.website) return false
  if (!candidate.site_checked_at) return true
  if ((candidate.site_check_version ?? 1) < SITE_CHECK_VERSION) return true
  if (candidate.site_check_status !== 'fetch_failed') return false
  if (fetchAttempts(candidate) >= MAX_SITE_FETCH_ATTEMPTS) return false
  return now >= siteRetryAt(candidate)
}

function siteRetryAt(candidate) {
  return new Date(candidate.site_checked_at).getTime() + SITE_FETCH_RETRY_DAYS * DAY_MS
}

// Oldest discovery first, so every candidate is reached in turn - newest
// first let each day's new results push the older ones back indefinitely.
export function compareSiteQueue(a, b) {
  return String(a.first_seen_at || a.created_at || '').localeCompare(String(b.first_seen_at || b.created_at || ''))
}

export function nextFetchAttempt(candidate) {
  return fetchAttempts(candidate) + 1
}

// The n-th scheduled run strictly after `from` (n = 1: the next one).
export function scheduledRunAfter(from, n = 1) {
  const t = new Date(from)
  const slot = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), SCHEDULE_FIRST_HOUR_UTC, SCHEDULE_MINUTE_UTC))
  let found = 0
  for (let i = 0; i < 400 * 24; i += 1) {
    const hour = slot.getUTCHours()
    if (hour >= SCHEDULE_FIRST_HOUR_UTC && hour <= SCHEDULE_LAST_HOUR_UTC && slot.getTime() > t.getTime()) {
      found += 1
      if (found === n) return slot
    }
    slot.setTime(slot.getTime() + 60 * 60 * 1000)
  }
  return null
}

// -> Map(candidateId -> { key, reason, expectedAt })
//    reason: site_review_reason code (attention), or 'retry' for a failed
//    load waiting for its retry date.
//    expectedAt: when the scheduler is expected to read the site - the run
//    its queue position reaches at MAX_SITE_CHECKS_PER_RUN per run (an
//    estimate: pages rejected from the search result alone use no check).
//    null when automatic runs are off.
export function buildCandidateQueue(candidates, { now = Date.now(), automaticRunsOn = true } = {}) {
  const states = new Map()
  const pending = []
  const retrying = []
  for (const c of candidates) {
    if (c.status === 'promoted') states.set(c.id, { key: 'registered' })
    else if (c.status === 'rejected' || c.status === 'duplicate') states.set(c.id, { key: 'closed' })
    else if (isSitePending(c, now)) pending.push(c)
    else if (
      OPEN_STATUSES.has(c.status) &&
      c.website &&
      c.site_check_status === 'fetch_failed' &&
      !c.site_review_reason &&
      fetchAttempts(c) < MAX_SITE_FETCH_ATTEMPTS
    )
      retrying.push(c)
    else states.set(c.id, { key: 'attention', reason: c.site_review_reason || (c.website ? 'other' : 'no_website') })
  }
  pending.sort(compareSiteQueue)
  pending.forEach((c, i) => {
    states.set(c.id, {
      key: c.status === 'qualified' ? 'eligible' : 'waiting',
      reason: null,
      queuePosition: i + 1,
      expectedAt: automaticRunsOn ? scheduledRunAfter(now, Math.floor(i / MAX_SITE_CHECKS_PER_RUN) + 1) : null,
    })
  })
  for (const c of retrying) {
    states.set(c.id, {
      key: c.status === 'qualified' ? 'eligible' : 'waiting',
      reason: 'retry',
      attempt: nextFetchAttempt(c),
      expectedAt: automaticRunsOn ? scheduledRunAfter(Math.max(now, siteRetryAt(c) - 1)) : null,
    })
  }
  return states
}
