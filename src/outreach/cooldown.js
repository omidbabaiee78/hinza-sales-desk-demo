import { hoursBetween } from './shared.js'

// Only these statuses represent a REAL contact attempt for cooldown/max-
// attempts purposes - 'prepared' (draft only, nothing happened outside the
// admin panel), 'failed' and 'cancelled' never count against the prospect.
export const QUALIFYING_ATTEMPT_STATUSES = new Set(['opened', 'copied', 'completed'])

export function qualifyingAttempts(attempts) {
  return (attempts || []).filter((a) => QUALIFYING_ATTEMPT_STATUSES.has(a.status))
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
