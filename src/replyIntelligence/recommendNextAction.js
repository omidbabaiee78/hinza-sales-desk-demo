import { getIntentDefinition } from './intentDefinitions.js'
import { parseFollowUpDate, addDaysIso } from './followUpDateParser.js'

// ---------------------------------------------------------------------------
// intent + context -> a concrete, displayable recommendation. Never invents
// a price/discount/stock/technical claim - the only thing this computes
// beyond the intent's own static metadata is follow-up TIMING, and only
// when it can be derived reliably from the actual reply text.
// ---------------------------------------------------------------------------

// already_supplied has no explicit timing in the reply, but the intent
// itself implies "check back much later" - a fixed, clearly-labeled
// default the admin can freely change, never presented as something the
// customer actually said.
const LONG_TERM_FOLLOWUP_DAYS = 60

export function recommendNextAction({ intentKey, normalizedText, now = new Date() }) {
  const def = getIntentDefinition(intentKey)

  let followUpAt = null
  let followUpReliable = null
  let followUpNote = null

  if (def.expectsFollowUp) {
    if (intentKey === 'already_supplied') {
      followUpAt = addDaysIso(now, LONG_TERM_FOLLOWUP_DAYS)
      followUpReliable = false
      followUpNote = 'تاریخ پیشنهادی بر اساس بازه پیش‌فرض پیگیری بلندمدت است، نه چیزی که مشتری گفته - در صورت نیاز تغییر دهید.'
    } else {
      const parsed = parseFollowUpDate(normalizedText, now)
      if (parsed.matched && parsed.reliable) {
        followUpAt = parsed.iso
        followUpReliable = true
      } else if (parsed.matched) {
        followUpReliable = false
        followUpNote = 'زمان دقیق از متن پاسخ قابل تشخیص نیست - لطفاً تاریخ پیگیری را دستی انتخاب کنید.'
      } else {
        followUpReliable = false
        followUpNote = 'زمان مشخصی در پاسخ ذکر نشده - در صورت نیاز تاریخ پیگیری را دستی تنظیم کنید.'
      }
    }
  }

  return {
    actionKey: def.actionKey,
    followUpAt,
    followUpReliable,
    followUpNote,
  }
}
