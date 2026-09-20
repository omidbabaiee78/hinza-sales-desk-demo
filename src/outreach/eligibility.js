import { selectOutreachChannel } from './channelSelection.js'
import { evaluateContactWindow } from './contactWindow.js'
import { countQualifyingAttempts, evaluateCooldown } from './cooldown.js'

// ---------------------------------------------------------------------------
// Deterministic outreach eligibility - the ONLY place that decides eligible
// vs blocked vs manual_review for a lead-sourced automation task. Pure
// function, no Supabase/React - same idea as automation/reconciler.js:
// callable repeatedly with the same input for the same result, and safe to
// unit-test directly (see scripts/checkOutreachEligibility.mjs).
//
// Hard blocks (status: 'blocked'): do_not_contact, converted, lost, no
// usable contact channel, max contact attempts reached, cooldown not yet
// elapsed since the last real attempt.
//
// manual_review is reserved for a lead already flagged as a possible
// duplicate elsewhere in the app (utils/leadIntelligence.js
// computeDuplicateRiskLeadIds) - contactable, but worth a human glance
// before acting, never auto-hidden and never auto-blocked.
//
// Outside-contact-window is NOT a block: the opportunity stays 'eligible'
// (never lost), just annotated with withinContactWindow=false and the next
// moment it becomes actionable, per the Phase 19 spec ("keep it queued").
// ---------------------------------------------------------------------------

const DEFAULT_COOLDOWN_HOURS = 20
const DEFAULT_MAX_ATTEMPTS = 6

function leadHardBlockReason(lead) {
  if (!lead) return 'سرنخ مرتبط دیگر یافت نمی‌شود.'
  if (lead.do_not_contact) return 'این سرنخ عدم تماس دارد.'
  if (lead.status === 'converted') return 'این سرنخ به مشتری تبدیل شده است.'
  if (lead.status === 'lost') return 'این سرنخ از دست رفته است.'
  return null
}

export function evaluateOutreachOpportunity({ lead, settings, leadAttempts = [], duplicateRiskIds, now = new Date() }) {
  const hardBlockReason = leadHardBlockReason(lead)
  if (hardBlockReason) {
    return { outreachStatus: 'blocked', reasons: [hardBlockReason], channel: null, withinContactWindow: null, nextAvailableAt: null }
  }

  const channel = selectOutreachChannel(lead)
  if (!channel) {
    return {
      outreachStatus: 'blocked',
      reasons: ['هیچ راه تماس معتبری (موبایل، تلفن یا ایمیل) برای این سرنخ ثبت نشده است.'],
      channel: null,
      withinContactWindow: null,
      nextAvailableAt: null,
    }
  }

  const maxAttempts = settings?.max_contact_attempts ?? DEFAULT_MAX_ATTEMPTS
  const attemptCount = countQualifyingAttempts(leadAttempts)
  if (attemptCount >= maxAttempts) {
    return {
      outreachStatus: 'blocked',
      reasons: [`به حداکثر تعداد تلاش تماس مجاز (${maxAttempts} بار) رسیده است.`],
      channel,
      withinContactWindow: null,
      nextAvailableAt: null,
    }
  }

  const cooldownHours = settings?.outreach_cooldown_hours ?? DEFAULT_COOLDOWN_HOURS
  const cooldown = evaluateCooldown(leadAttempts, cooldownHours, now)
  if (cooldown.withinCooldown) {
    return {
      outreachStatus: 'blocked',
      reasons: [`اخیراً برای این سرنخ اقدام ثبت شده - طبق فاصله زمانی مجاز (${cooldownHours} ساعت) هنوز زود است.`],
      channel,
      withinContactWindow: null,
      nextAvailableAt: cooldown.nextAvailableAt,
    }
  }

  if (duplicateRiskIds?.has(lead.id)) {
    return {
      outreachStatus: 'manual_review',
      reasons: ['این سرنخ ممکن است با سرنخ دیگری تکراری باشد - قبل از تماس بررسی شود.'],
      channel,
      withinContactWindow: null,
      nextAvailableAt: null,
    }
  }

  const window = evaluateContactWindow(settings, now)
  return {
    outreachStatus: 'eligible',
    reasons: [],
    channel,
    withinContactWindow: window.withinWindow,
    nextAvailableAt: window.withinWindow ? null : window.nextAvailableAt,
  }
}
