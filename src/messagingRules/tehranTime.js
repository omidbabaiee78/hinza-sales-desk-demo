// Iran has observed no DST since 2022 - a fixed UTC+03:30 offset, so this
// stays correct without needing a timezone-data dependency.
const TEHRAN_UTC_OFFSET_MINUTES = 210
const BUSINESS_START_HOUR = 9
const BUSINESS_END_HOUR = 18

function tehranPartsFromDate(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
  }
}

function tehranPartsToUtcDate({ year, month, day, hour, minute }) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - TEHRAN_UTC_OFFSET_MINUTES * 60000)
}

// Shadow Mode only recommends a time - nothing is ever scheduled/sent. If
// `now` already falls in the 09:00-18:00 Tehran window, that's the
// recommendation; otherwise it's the next 09:00 Tehran.
export function recommendedContactTime(now) {
  const parts = tehranPartsFromDate(now)
  if (parts.hour >= BUSINESS_START_HOUR && parts.hour < BUSINESS_END_HOUR) return now

  const todayNine = tehranPartsToUtcDate({ ...parts, hour: BUSINESS_START_HOUR, minute: 0 })
  if (parts.hour < BUSINESS_START_HOUR) return todayNine
  return new Date(todayNine.getTime() + 24 * 60 * 60 * 1000)
}
