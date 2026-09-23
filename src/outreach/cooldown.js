import { hoursBetween } from './shared.js'

// Only these statuses represent a REAL contact attempt for cooldown/max-
// attempts purposes - 'prepared' (draft only, nothing happened outside the
// admin panel), 'failed' and 'cancelled' never count against the prospect.
// 'sent' (Phase 26) is a confirmed real-provider transmission to the actual
// customer - at least as qualifying as a manual 'opened'/'copied' action, so
// it counts here too. A TEST-mode send never reaches this list in the first
// place (it is never written with the lead's real recipient), so this can
// never be inflated by test traffic.
export const QUALIFYING_ATTEMPT_STATUSES = new Set(['opened', 'copied', 'completed', 'sent'])

export function qualifyingAttempts(attempts) {
  // A test_mode=true row (Phase 26) never actually reached the real
  // customer - it must never count against their cooldown/attempt budget.
  // Every pre-Phase-26 row has no test_mode field at all (undefined), which
  // is falsy here too, so this changes nothing for existing manual attempts.
  return (attempts || []).filter((a) => QUALIFYING_ATTEMPT_STATUSES.has(a.status) && !a.test_mode)
}

export function countQualifyingAttempts(attempts) {
  return qualifyingAttempts(attempts).length
}

export function mostRecentQualifyingAttempt(attempts) {
  const qualifying = qualifyingAttempts(attempts)
  if (qualifying.length === 0) return null
  return qualifying.reduce((latest, a) => (!latest || a.created_at > latest.created_at ? a : latest), null)
}

export function mostRecentAttemptAt(attempts) {
  return mostRecentQualifyingAttempt(attempts)?.created_at || null
}

// Returns { withinCooldown, nextAvailableAt (Date|null) }.
export function evaluateCooldown(attempts, cooldownHours, now = new Date()) {
  const lastAt = mostRecentAttemptAt(attempts)
  if (!lastAt) return { withinCooldown: false, nextAvailableAt: null }
  const elapsedHours = hoursBetween(lastAt, now)
  if (elapsedHours == null || elapsedHours >= cooldownHours) {
    return { withinCooldown: false, nextAvailableAt: null }
  }
  return { withinCooldown: true, nextAvailableAt: new Date(new Date(lastAt).getTime() + cooldownHours * 60 * 60 * 1000) }
}
