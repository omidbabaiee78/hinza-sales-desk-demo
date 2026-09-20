// ---------------------------------------------------------------------------
// Deterministic Persian follow-up expression parsing - Asia/Tehran only,
// matching the fixed +03:30 convention already used everywhere else in this
// app (see utils/leadFollowUp.js, messagingRules/tehranTime.js).
//
// All arithmetic below happens in UTC-field space (Date.UTC + getUTCDate/
// setUTCDate/getUTCDay), never local getDate()/setDate() - the machine
// running this code (browser or a future server) may be in ANY timezone,
// and mixing local-time date math with a fixed-offset Tehran timestamp is
// exactly the kind of off-by-one-day bug that only shows up outside Iran.
// Reading the Tehran calendar date via Intl.DateTimeFormat and then doing
// all further day/month/weekday math purely in UTC fields keeps every
// result correct regardless of where the code runs.
//
// "Uncertain interpretation -> never invent a date" (بعد عید) is handled by
// returning reliable: false with iso: null - callers must not fabricate a
// timestamp in that case.
// ---------------------------------------------------------------------------

const TEHRAN_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const NUMBER_WORDS = { یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10 }

// Longest/most specific names first - "سه شنبه" (Tuesday) contains "شنبه"
// (Saturday) as a substring, so plain "شنبه" must be checked last.
const WEEKDAY_ENTRIES = [
  ['یکشنبه', 0],
  ['یک شنبه', 0],
  ['دوشنبه', 1],
  ['دو شنبه', 1],
  ['سه شنبه', 2],
  ['سهشنبه', 2],
  ['چهارشنبه', 3],
  ['چهار شنبه', 3],
  ['پنجشنبه', 4],
  ['پنج شنبه', 4],
  ['جمعه', 5],
  ['شنبه', 6],
]

function tehranDateParts(date) {
  const [y, m, d] = TEHRAN_DATE_FORMATTER.format(date).split('-').map(Number)
  return { y, m, d }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// Business-day-start convention, matching followUpIsoFromDate elsewhere.
function isoAtTehranDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}T09:00:00+03:30`
}

function utcDateFromTehranParts({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDaysIso(now, days) {
  const utc = utcDateFromTehranParts(tehranDateParts(now))
  utc.setUTCDate(utc.getUTCDate() + days)
  return isoAtTehranDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

function addMonthIso(now) {
  const utc = utcDateFromTehranParts(tehranDateParts(now))
  utc.setUTCMonth(utc.getUTCMonth() + 1)
  return isoAtTehranDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

// "Next" occurrence strictly after today (today itself doesn't count, even
// if today happens to be that weekday) - matches how "شنبه تماس بگیر" reads
// when said today.
function nextWeekdayIso(now, targetIndex) {
  const parts = tehranDateParts(now)
  const utc = utcDateFromTehranParts(parts)
  const todayIndex = utc.getUTCDay()
  let diff = (targetIndex - todayIndex + 7) % 7
  if (diff === 0) diff = 7
  utc.setUTCDate(utc.getUTCDate() + diff)
  return isoAtTehranDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

// Returns { matched, reliable, iso, label }. `matched` = a follow-up timing
// expression was found at all; `reliable` = a concrete date could safely be
// computed from it (iso is only ever set when reliable is true).
export function parseFollowUpDate(normalizedText, now = new Date()) {
  const t = normalizedText || ''

  if (/پس\s*فردا/.test(t)) {
    return { matched: true, reliable: true, iso: addDaysIso(now, 2), label: 'پس‌فردا' }
  }
  if (/فردا/.test(t)) {
    return { matched: true, reliable: true, iso: addDaysIso(now, 1), label: 'فردا' }
  }

  const dayCountMatch = /(\d+|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)\s*روز\s*(دیگه|دیگر|بعد)/.exec(t)
  if (dayCountMatch) {
    const raw = dayCountMatch[1]
    const n = NUMBER_WORDS[raw] ?? Number(raw)
    if (Number.isFinite(n) && n > 0 && n <= 60) {
      return { matched: true, reliable: true, iso: addDaysIso(now, n), label: `${n} روز دیگر` }
    }
  }

  if (/هفته\s*(بعد|دیگه|دیگر)/.test(t)) {
    return { matched: true, reliable: true, iso: addDaysIso(now, 7), label: 'هفته بعد' }
  }
  if (/ماه\s*(بعد|دیگه|دیگر)/.test(t)) {
    return { matched: true, reliable: true, iso: addMonthIso(now), label: 'ماه بعد' }
  }

  for (const [name, index] of WEEKDAY_ENTRIES) {
    if (t.includes(name)) {
      return { matched: true, reliable: true, iso: nextWeekdayIso(now, index), label: name }
    }
  }

  // "بعد عید" - which eid, and exactly when, is genuinely ambiguous (shifts
  // every year, and Iran observes more than one) - recognized as a
  // follow-up SIGNAL, never turned into a fabricated date.
  if (/بعد\s*(از\s*)?عید/.test(t)) {
    return { matched: true, reliable: false, iso: null, label: 'بعد از عید' }
  }

  return { matched: false, reliable: false, iso: null, label: null }
}
