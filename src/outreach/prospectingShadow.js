import { evaluateOutreachOpportunity } from './eligibility.js'
import { getChannelAdapter } from './channelSelection.js'

// ---------------------------------------------------------------------------
// Phase 25 - Autonomous Outreach SHADOW MODE, prospecting layer.
//
// Deliberately NOT a second eligibility engine: every hard block (do_not_
// contact, converted, lost, no contact channel, cooldown, max attempts,
// contact window) is decided by the EXISTING, already-tested
// evaluateOutreachOpportunity() (eligibility.js) - reused here as-is, never
// re-implemented. This module only adds the handful of checks that are
// genuinely NEW for autonomous prospecting-lead outreach and don't belong in
// the generic engine (which is shared with ordinary CRM leads):
//   - an already-pending/approved/edited suggestion for the same lead
//     (no duplicate suggestion spam across repeated shadow runs)
//   - a manual snooze specific to this shadow queue
//   - insufficient prospecting confidence/evidence to safely draft a message
// plus deterministic priority scoring and channel/fallback selection - never
// AI-decided, per the Phase 25 spec ("AI may generate copy only after
// deterministic eligibility/priority has already been decided").
//
// Four possible outcomes (outreachStatus): 'eligible' | 'waiting' |
// 'blocked' | 'manual_review'. 'waiting' covers everything that is NOT a
// hard block but isn't actionable RIGHT NOW either (outside the contact
// window, snoozed, or a suggestion for this lead already exists) - the
// opportunity is never lost, just not due yet.
// ---------------------------------------------------------------------------

const BASE_PRIORITY = 50
const FRESHNESS_BONUS_DAYS = 10
const MIN_CONFIDENT_SCORE = 55

const CHANNEL_FALLBACK_ORDER = ['whatsapp', 'phone', 'sms', 'email']

function selectFallbackChannel(lead, primaryChannelKey) {
  for (const key of CHANNEL_FALLBACK_ORDER) {
    if (key === primaryChannelKey) continue
    const adapter = getChannelAdapter(key)
    if (adapter?.canHandle(lead)) return key
  }
  return null
}

// Lower number = more urgent, same convention automation_rules.priority and
// messagingRules already use throughout this codebase. Built ONLY from data
// already on the lead/candidate row - no extra fetch, no AI, no guessing:
//   - stronger Smart Qualification score/confidence -> more urgent
//   - a fresher lead -> more urgent (decays to 0 after FRESHNESS_BONUS_DAYS)
export function computeShadowPriority({ candidate, lead, now }) {
  let priority = BASE_PRIORITY
  if (candidate?.overall_score != null) priority -= Math.round(candidate.overall_score / 5)
  if (candidate?.confidence === 'high') priority -= 10
  else if (candidate?.confidence === 'medium') priority -= 5

  const createdAt = lead?.created_at
  if (createdAt) {
    const ageHours = (now.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
    if (Number.isFinite(ageHours)) {
      priority -= Math.max(0, FRESHNESS_BONUS_DAYS - Math.floor(ageHours / 24))
    }
  }

  return Math.max(1, Math.round(priority))
}

// The one function that decides eligible/waiting/blocked/manual_review for a
// SINGLE prospecting-sourced lead, plus its channel/fallback/priority/
// suggested send time - everything the message composer and the persisted
// suggestion row need, before any text is ever drafted.
export function evaluateShadowOutreachOpportunity({
  lead,
  candidate,
  settings,
  leadAttempts = [],
  duplicateRiskIds,
  hasActionableSuggestion = false,
  snoozedUntil = null,
  now = new Date(),
}) {
  const base = evaluateOutreachOpportunity({ lead, settings, leadAttempts, duplicateRiskIds, now })

  if (base.outreachStatus === 'blocked') {
    return { ...base, priority: null, fallbackChannel: null }
  }

  if (snoozedUntil && new Date(snoozedUntil) > now) {
    return {
      outreachStatus: 'waiting',
      reasons: ['این سرنخ به‌صورت دستی به تعویق افتاده است.'],
      channel: base.channel,
      fallbackChannel: null,
      withinContactWindow: null,
      nextAvailableAt: snoozedUntil,
      priority: null,
    }
  }

  if (hasActionableSuggestion) {
    return {
      outreachStatus: 'waiting',
      reasons: ['یک پیشنهاد فعال (در انتظار تصمیم) از قبل برای این سرنخ ثبت شده است.'],
      channel: base.channel,
      fallbackChannel: null,
      withinContactWindow: base.withinContactWindow,
      nextAvailableAt: null,
      priority: null,
    }
  }

  // Genuinely new gate: the eligibility engine above only checks whether a
  // CONTACT CHANNEL exists, never whether there is enough evidence to
  // responsibly draft outreach copy. A candidate promoted at low confidence
  // and a middling score is real (Smart Qualification already accepted it),
  // but safe autonomous outreach copy needs a bit more margin than safe
  // promotion does.
  if (candidate && candidate.confidence === 'low' && (candidate.overall_score ?? 0) < MIN_CONFIDENT_SCORE) {
    return {
      outreachStatus: 'manual_review',
      reasons: [`اطمینان شناسایی این سرنخ پایین است (امتیاز ${candidate.overall_score ?? '—'}) - پیش از تماس بررسی شود.`],
      channel: base.channel,
      fallbackChannel: null,
      withinContactWindow: base.withinContactWindow,
      nextAvailableAt: null,
      priority: null,
    }
  }

  if (base.outreachStatus === 'manual_review') {
    return { ...base, fallbackChannel: null, priority: null }
  }

  // base.outreachStatus === 'eligible' from here on.
  if (base.withinContactWindow === false) {
    return {
      outreachStatus: 'waiting',
      reasons: ['خارج از بازه زمانی مجاز تماس است.'],
      channel: base.channel,
      fallbackChannel: selectFallbackChannel(lead, base.channel),
      withinContactWindow: false,
      nextAvailableAt: base.nextAvailableAt,
      priority: computeShadowPriority({ candidate, lead, now }),
      suggestedSendAt: base.nextAvailableAt,
    }
  }

  return {
    outreachStatus: 'eligible',
    reasons: [],
    channel: base.channel,
    fallbackChannel: selectFallbackChannel(lead, base.channel),
    withinContactWindow: true,
    nextAvailableAt: null,
    priority: computeShadowPriority({ candidate, lead, now }),
    suggestedSendAt: now.toISOString(),
  }
}
