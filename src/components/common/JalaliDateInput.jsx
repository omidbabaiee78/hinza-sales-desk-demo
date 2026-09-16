import { useMemo } from 'react'
import {
  PERSIAN_MONTHS,
  daysInJalaaliMonth,
  gregorianIsoToJalaali,
  jalaaliToGregorianIso,
  todayJalaali,
} from '../../utils/jalali'
import './JalaliDateInput.css'

export default function JalaliDateInput({ value, onChange, required }) {
  const today = todayJalaali()
  const parsed = gregorianIsoToJalaali(value)
  const jy = parsed?.jy ?? ''
  const jm = parsed?.jm ?? ''
  const jd = parsed?.jd ?? ''

  const yearOptions = useMemo(() => {
    const years = []
    for (let y = today.jy; y <= today.jy + 2; y++) years.push(y)
    return years
  }, [today.jy])

  const dayOptions = useMemo(() => {
    const count = jy && jm ? daysInJalaaliMonth(jy, jm) : 31
    return Array.from({ length: count }, (_, i) => i + 1)
  }, [jy, jm])

  function emit(nextJy, nextJm, nextJd) {
    if (!nextJy || !nextJm || !nextJd) {
      onChange('')
      return
    }
    const maxDay = daysInJalaaliMonth(nextJy, nextJm)
    const safeDay = Math.min(nextJd, maxDay)
    onChange(jalaaliToGregorianIso(nextJy, nextJm, safeDay))
  }

  return (
    <div className="jalali-date-input">
      <select
        aria-label="روز"
        value={jd}
        onChange={(e) => emit(jy || today.jy, jm || today.jm, Number(e.target.value))}
        required={required}
      >
        <option value="">روز</option>
        {dayOptions.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        aria-label="ماه"
        value={jm}
        onChange={(e) => emit(jy || today.jy, Number(e.target.value), jd || today.jd)}
        required={required}
      >
        <option value="">ماه</option>
        {PERSIAN_MONTHS.map((name, idx) => (
          <option key={name} value={idx + 1}>
            {name}
          </option>
        ))}
      </select>
      <select
        aria-label="سال"
        value={jy}
        onChange={(e) => emit(Number(e.target.value), jm || today.jm, jd || today.jd)}
        required={required}
      >
        <option value="">سال</option>
        {yearOptions.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  )
}
