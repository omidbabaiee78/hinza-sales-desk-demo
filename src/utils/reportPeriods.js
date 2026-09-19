import { todayJalaali, jalaaliToGregorianIso, daysInJalaaliMonth } from './jalali'

// Same "just use the local clock" convention the rest of the app already
// relies on (e.g. todayJalaali()) - there is no separate Asia/Tehran TZ
// layer anywhere in this codebase to plug into, so this stays consistent
// with the existing behavior rather than introducing a new one.
function isoFromDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function todayIso() {
  return isoFromDate(new Date())
}

function addDaysIso(iso, days) {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return isoFromDate(date)
}

function diffDaysIso(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIso}T00:00:00`)
  return Math.round((to - from) / 86400000)
}

// Persian week is Saturday..Friday. JS Date#getDay(): 0=Sunday..6=Saturday.
function startOfJalaaliWeekIso() {
  const jsDay = new Date().getDay()
  const daysSinceSaturday = (jsDay + 1) % 7
  return addDaysIso(todayIso(), -daysSinceSaturday)
}

function jalaaliMonthRangeIso(jy, jm) {
  const from = jalaaliToGregorianIso(jy, jm, 1)
  const to = jalaaliToGregorianIso(jy, jm, daysInJalaaliMonth(jy, jm))
  return { from, to }
}

export const PERIOD_PRESETS = [
  { key: 'today', label: 'امروز' },
  { key: 'week', label: 'این هفته' },
  { key: 'month', label: 'این ماه' },
  { key: 'lastMonth', label: 'ماه قبل' },
  { key: 'last30', label: '۳۰ روز اخیر' },
  { key: 'custom', label: 'بازه دلخواه' },
]

// Every range is inclusive of both `from` and `to` calendar days.
export function resolvePeriodRange(presetKey, customFrom, customTo) {
  const today = todayIso()

  if (presetKey === 'today') return { from: today, to: today }

  if (presetKey === 'week') return { from: startOfJalaaliWeekIso(), to: today }

  if (presetKey === 'month') {
    const { jy, jm } = todayJalaali()
    return { from: jalaaliMonthRangeIso(jy, jm).from, to: today }
  }

  if (presetKey === 'lastMonth') {
    const { jy, jm } = todayJalaali()
    const prevJm = jm === 1 ? 12 : jm - 1
    const prevJy = jm === 1 ? jy - 1 : jy
    return jalaaliMonthRangeIso(prevJy, prevJm)
  }

  if (presetKey === 'last30') return { from: addDaysIso(today, -29), to: today }

  // custom
  if (customFrom && customTo && customFrom <= customTo) {
    return { from: customFrom, to: customTo }
  }
  return { from: addDaysIso(today, -29), to: today }
}

// The immediately preceding period of equal length - used for
// period-over-period comparison cards.
export function resolvePreviousRange({ from, to }) {
  const lengthDays = diffDaysIso(from, to) + 1
  const prevTo = addDaysIso(from, -1)
  const prevFrom = addDaysIso(prevTo, -(lengthDays - 1))
  return { from: prevFrom, to: prevTo }
}

// Exclusive upper bound for querying/filtering a timestamptz column so the
// whole final calendar day is included (not just its midnight instant).
export function toExclusiveEndIso(toIso) {
  return addDaysIso(toIso, 1)
}

export function isWithinRange(isoTimestamp, from, to) {
  if (!isoTimestamp) return false
  const day = String(isoTimestamp).slice(0, 10)
  return day >= from && day <= to
}

export function periodLabel(presetKey) {
  return PERIOD_PRESETS.find((p) => p.key === presetKey)?.label || 'بازه انتخابی'
}

// Day buckets for short ranges read better than month buckets; beyond ~62
// days, monthly buckets keep the trend chart from turning into a wall of
// tiny bars.
export function trendGranularity(from, to) {
  return diffDaysIso(from, to) + 1 <= 62 ? 'day' : 'month'
}
