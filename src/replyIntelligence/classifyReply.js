import { parseFollowUpDate } from './followUpDateParser.js'

// ---------------------------------------------------------------------------
// RAW REPLY (normalized) -> { intentKey, confidence }. Deterministic,
// keyword/pattern-based - no external AI call in Phase 20. Rules are
// evaluated in order; the FIRST match wins, so ordering encodes priority
// (safety-critical intents like do_not_contact/wrong_contact are checked
// first; a deferred-timing phrase is checked before a plain "call me" phrase
// so "ماه بعد تماس بگیر" resolves to follow_up_later, not call_requested).
//
// "Do not overclaim certainty" - anything that doesn't match a real pattern
// falls through to unknown/manual_review, never a guessed specific intent.
// ---------------------------------------------------------------------------

const DO_NOT_CONTACT_PATTERNS = [
  /دیگه?[\s\S]*?(تماس|زنگ|پیام|پیامک|اس ?ام ?اس)[\s\S]*?ن(ده|دید|دین|زن|زنید|گیر|گیرید)/,
  /(تماس|زنگ)\s*ن(زن|زنید|گیر|گیرید)/,
  /(پیام|پیامک|اس ?ام ?اس)\s*ن(ده|دید|دین)/,
  /مزاحم\s*نشو/,
  /دیگه\s*مزاحم/,
  /اشتراک.*لغو/,
  // The outreach email footer (sendGate.js EMAIL_OPT_OUT_FOOTER) asks the
  // prospect to reply with just «لغو» - a reply that is only that word, or an
  // explicit "unsubscribe"/"stop receiving" phrase, is an opt-out. A longer
  // message that merely contains لغو (e.g. cancelling an order) is not.
  /^[\s«»"'.!؟?]*لغو[\s«»"'.!؟?]*$/,
  /لغو\s*(اشتراک|دریافت|عضویت|ارسال)/,
  /ایمیل\s*ن(فرست|فرستید|فرستین|زن|زنید)/,
  /\bunsubscribe\b/i,
]

const WRONG_CONTACT_PATTERNS = [
  /اشتباه\s*(گرفت|گرفتید|شد|زنگ زدید|تماس گرفتید)/,
  /شماره\s*اشتباه/,
  /این\s*شماره\s*(من\s*)?نیست/,
  /شما\s*اشتباه/,
]

const CALL_REQUESTED_PATTERNS = [/زنگ\s*بزن/, /تماس\s*بگیر/, /بهم\s*زنگ\s*بزن/]

const NOT_NOW_PATTERNS = [
  /(فعلا|فعلاً|الان|فعلن).{0,15}(نیاز نداریم|نیازی نیست|نمی?خوایم|نمیخوایم|خرید نداریم)/,
  /(نیاز نداریم|نیازی نیست|نمی?خوایم|نمیخوایم|خرید نداریم).{0,15}(فعلا|فعلاً|الان|فعلن)/,
]

const NOT_INTERESTED_PATTERNS = [/نیاز نداریم/, /نیازی نیست/, /علاقه نداریم/, /نمی?خوایم/, /نمیخوایم/]

const ALREADY_SUPPLIED_PATTERNS = [
  /تامین\s*کننده.{0,10}داریم/,
  /(با|از).{0,15}(تامین\s*کننده|شرکت)\s*دیگه.{0,15}(قرارداد|همکاری)/,
  /از جای دیگه.{0,10}(تهیه|میگیریم|میخریم)/,
  /فعلا.{0,10}همکار داریم/,
]

const SAMPLE_REQUEST_PATTERNS = [/نمونه/]

const PRICE_REQUEST_PATTERNS = [/قیمت/, /لیست قیمت/, /هزینه\s*چقدر/, /چند(ه)?\s*قیمتش/]

const PRODUCT_QUESTION_PATTERNS = [/مشخصات/, /جنس\s*چیه/, /چه\s*(نوع|مدل)/, /کاربرد.{0,10}چیه/, /گرید/, /ضخامت/, /مقاومت/]

const NEEDS_MORE_INFO_PATTERNS = [/اطلاعات\s*بیشتر/, /بیشتر\s*توضیح/, /کاتالوگ/, /بروشور/]

const INTERESTED_PATTERNS = [/علاقه\s*مند/, /عالیه/, /خوبه\s*بفرست/, /ممنون\s*میشیم\s*همکاری/, /بله\s*علاقه\s*داریم/]

const POSITIVE_EMOJIS = new Set(['👍', '✅', '😊', '🙂', '❤️', '👌'])
const NEGATIVE_EMOJIS = new Set(['👎', '❌'])

function matchesAny(patterns, text) {
  return patterns.some((re) => re.test(text))
}

function followUpLaterRule(text, now) {
  const parsed = parseFollowUpDate(text, now)
  if (!parsed.matched) return null
  return { intentKey: 'follow_up_later', confidence: parsed.reliable ? 'medium' : 'low' }
}

function simpleRule(intentKey, confidence, patterns) {
  return (text) => (matchesAny(patterns, text) ? { intentKey, confidence } : null)
}

const RULES = [
  simpleRule('do_not_contact', 'high', DO_NOT_CONTACT_PATTERNS),
  simpleRule('wrong_contact', 'high', WRONG_CONTACT_PATTERNS),
  (text, now) => followUpLaterRule(text, now),
  simpleRule('call_requested', 'high', CALL_REQUESTED_PATTERNS),
  simpleRule('not_now', 'high', NOT_NOW_PATTERNS),
  simpleRule('not_interested', 'medium', NOT_INTERESTED_PATTERNS),
  simpleRule('already_supplied', 'medium', ALREADY_SUPPLIED_PATTERNS),
  simpleRule('sample_request', 'high', SAMPLE_REQUEST_PATTERNS),
  simpleRule('price_request', 'high', PRICE_REQUEST_PATTERNS),
  simpleRule('product_question', 'medium', PRODUCT_QUESTION_PATTERNS),
  simpleRule('needs_more_information', 'medium', NEEDS_MORE_INFO_PATTERNS),
  simpleRule('interested', 'medium', INTERESTED_PATTERNS),
]

// `normalization` is normalizeReply()'s output ({ normalized, emojis }) -
// classifyReply never re-derives normalization itself, so there is exactly
// one place text cleanup happens.
export function classifyReply({ normalized, emojis } = {}, { now = new Date() } = {}) {
  const text = normalized || ''

  for (const rule of RULES) {
    const result = rule(text, now)
    if (result) return result
  }

  if (emojis && emojis.length > 0) {
    if (emojis.some((e) => POSITIVE_EMOJIS.has(e))) return { intentKey: 'interested', confidence: 'low' }
    if (emojis.some((e) => NEGATIVE_EMOJIS.has(e))) return { intentKey: 'not_interested', confidence: 'low' }
  }

  return { intentKey: 'unknown', confidence: 'manual_review' }
}
