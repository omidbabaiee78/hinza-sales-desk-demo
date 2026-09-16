import {
  toGregorian,
  toJalaali,
  jalaaliMonthLength,
} from 'jalaali-js'

export const PERSIAN_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function todayJalaali() {
  const now = new Date()
  return toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

// Converts a selected Jalali date to the Gregorian ISO (YYYY-MM-DD) string
// that Postgres date columns expect. This is the only place a Jalali year
// is ever translated into what gets sent to Supabase.
export function jalaaliToGregorianIso(jy, jm, jd) {
  const { gy, gm, gd } = toGregorian(jy, jm, jd)
  return `${gy}-${pad2(gm)}-${pad2(gd)}`
}

export function gregorianIsoToJalaali(isoDate) {
  if (!isoDate) return null
  const [gy, gm, gd] = isoDate.split('-').map(Number)
  if (!gy || !gm || !gd) return null
  return toJalaali(gy, gm, gd)
}

export function daysInJalaaliMonth(jy, jm) {
  return jalaaliMonthLength(jy, jm)
}
