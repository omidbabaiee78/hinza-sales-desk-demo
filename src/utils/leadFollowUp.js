// Iran has observed no DST since 2022 - a fixed UTC+03:30 offset, matching
// the same convention already used in messagingRules/tehranTime.js.
const tehranDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function tehranDateKey(date) {
  return tehranDateFormatter.format(date) // 'YYYY-MM-DD'
}

export const FOLLOW_UP_STATES = ['overdue', 'today', 'upcoming', 'none']
export const FOLLOW_UP_STATE_LABELS = {
  overdue: 'عقب‌افتاده',
  today: 'امروز',
  upcoming: 'آینده',
  none: 'بدون پیگیری',
}

// Compares Tehran calendar days only - a follow-up due earlier today is
// "امروز", never "عقب‌افتاده", since the admin still has the rest of the
// business day to act on it.
export function followUpState(nextFollowUpAtIso, now = new Date()) {
  if (!nextFollowUpAtIso) return 'none'
  const followUp = new Date(nextFollowUpAtIso)
  if (Number.isNaN(followUp.getTime())) return 'none'
  const todayKey = tehranDateKey(now)
  const followUpKey = tehranDateKey(followUp)
  if (followUpKey < todayKey) return 'overdue'
  if (followUpKey === todayKey) return 'today'
  return 'upcoming'
}

// A Jalali-picked Gregorian date (YYYY-MM-DD, from jalaaliToGregorianIso)
// becomes a timestamptz at the Tehran business-day start.
export function followUpIsoFromDate(isoDate) {
  if (!isoDate) return null
  return new Date(`${isoDate}T09:00:00+03:30`).toISOString()
}

// Inverse of the above, for feeding an existing next_follow_up_at back into
// JalaliDateInput (which expects a plain Gregorian YYYY-MM-DD string).
export function followUpDateOnly(iso) {
  if (!iso) return ''
  return iso.slice(0, 10)
}
