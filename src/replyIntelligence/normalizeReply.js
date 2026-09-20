import { normalizeDigits } from '../utils/leadImport/digits.js'

// ---------------------------------------------------------------------------
// RAW REPLY -> normalized text, for the classifier only. The raw message is
// NEVER discarded or overwritten anywhere downstream - normalization exists
// solely to make keyword matching robust against the real variety of Persian
// business replies (Arabic character variants, Persian/Arabic digits,
// نیم‌فاصله, stray punctuation, emojis).
// ---------------------------------------------------------------------------

const ARABIC_TO_PERSIAN = {
  ي: 'ی',
  ك: 'ک',
  ة: 'ه',
  ۀ: 'ه',
  ٱ: 'ا',
  أ: 'ا',
  إ: 'ا',
  ؤ: 'و',
  ئ: 'ی',
}
const ARABIC_CHAR_CLASS = /[يكةۀٱأإؤئ]/g

// Arabic diacritics (tashkeel) - never meaningful in an informal reply, only
// ever noise for keyword matching.
const DIACRITICS_REGEX = /[ً-ٰٟ]/g

// Zero-width non-joiner (نیم‌فاصله) - a real word-joiner in Persian
// typography, but a plain space is what every regex pattern below expects.
const ZWNJ_REGEX = /‌/g

// Common emoji ranges - stripped from the matching text but kept in a
// separate list so classifyReply can use them as a last-resort weak signal.
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu

const PUNCTUATION_REGEX = /[؟?!.,،؛:;"'`ـ()[\]{}]/g

function mapArabicChars(text) {
  return text.replace(ARABIC_CHAR_CLASS, (ch) => ARABIC_TO_PERSIAN[ch] || ch)
}

// Returns { raw, normalized, emojis }. `raw` is the untouched original
// input - the only value ever persisted as sales_leads-facing "what the
// customer actually said."
export function normalizeReply(rawMessage) {
  const raw = String(rawMessage ?? '')
  const emojis = raw.match(EMOJI_REGEX) || []

  let text = normalizeDigits(raw)
  text = mapArabicChars(text)
  text = text.replace(ZWNJ_REGEX, ' ')
  text = text.replace(DIACRITICS_REGEX, '')
  text = text.replace(EMOJI_REGEX, ' ')
  text = text.replace(PUNCTUATION_REGEX, ' ')
  text = text.replace(/\s+/g, ' ').trim().toLowerCase()

  return { raw, normalized: text, emojis }
}
