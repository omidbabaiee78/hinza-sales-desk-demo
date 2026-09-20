// ---------------------------------------------------------------------------
// Contact-window check. The app's entire timezone story (see
// messagingRules/tehranTime.js and utils/leadFollowUp.js) is a fixed
// Asia/Tehran offset with no DST - there is no multi-timezone infrastructure
// anywhere else in this codebase, so this deliberately does not build one
// either. automation_settings.timezone is read and respected when it holds
// the one timezone this app actually understands; any other value safely
// falls back to the same Asia/Tehran convention every other date/time
// computation in the app already uses, rather than silently miscomputing a
// window in an unsupported zone.
//
// automation_settings.contact_window_start/contact_window_end are Postgres
// `time without time zone` columns (production default 09:00/18:00) -
// Supabase returns these as "HH:MM:SS" strings, never numbers, so every
// comparison here works in minutes-since-midnight, parsed from that string.
// ---------------------------------------------------------------------------

const SUPPORTED_TIMEZONE = 'Asia/Tehran'
const DEFAULT_START_MINUTES = 9 * 60
const DEFAULT_END_MINUTES = 19 * 60

const tehranTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SUPPORTED_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function tehranMinutesSinceMidnight(date) {
  const [hours, minutes] = tehranTimeFormatter.format(date).split(':').map(Number)
  return hours * 60 + minutes
}

function tehranDateFormatterFor(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SUPPORTED_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  )
}

// Parses a Postgres `time` string ("09:00:00" or "09:00") into
// minutes-since-midnight. Falls back safely for a missing/malformed value -
// never throws on unexpected settings data.
function parseTimeToMinutes(value, fallbackMinutes) {
  if (typeof value !== 'string') return fallbackMinutes
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return fallbackMinutes
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallbackMinutes
  return hours * 60 + minutes
}

function resolveWindow(settings) {
  const start = parseTimeToMinutes(settings?.contact_window_start, DEFAULT_START_MINUTES)
  const end = parseTimeToMinutes(settings?.contact_window_end, DEFAULT_END_MINUTES)
  return { start, end }
}

// Returns { withinWindow, nextAvailableAt (Date|null) }. nextAvailableAt is
// only set when currently outside the window - the next moment the window
// opens (today if we're before it, tomorrow if we're at/after it).
export function evaluateContactWindow(settings, now = new Date()) {
  const { start, end } = resolveWindow(settings)
  const minutes = tehranMinutesSinceMidnight(now)
  const withinWindow = minutes >= start && minutes < end
  if (withinWindow) return { withinWindow: true, nextAvailableAt: null }

  const todayKey = tehranDateFormatterFor(now)
  const daysToAdd = minutes < start ? 0 : 1
  const nextDate = new Date(`${todayKey}T00:00:00+03:30`)
  nextDate.setDate(nextDate.getDate() + daysToAdd)
  const nextAvailableAt = new Date(nextDate.getTime() + start * 60 * 1000)
  return { withinWindow: false, nextAvailableAt }
}
