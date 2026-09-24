import { normalizeEmail } from '../prospecting/normalization.js'
import { isValidIranMobile, toE164Iran } from '../utils/phone.js'
import { splitContactDisplay } from '../utils/leadImport/contactNumbers.js'
import { hasUsableText } from './shared.js'

// ---------------------------------------------------------------------------
// Usable contact details of a REGISTERED lead (a sales_leads row), found the
// same way whatever brought the lead in - manual entry, a bulk lead import,
// an uploaded prospect list that was promoted, or automatic discovery.
// Unpromoted prospect_candidates rows are never passed here.
//
//   email     - a syntactically valid address
//   whatsapp  - a valid Iranian mobile (E.164). WhatsApp can only be tried;
//               whether the number has WhatsApp is known after a send.
//   bale      - EITHER a Bale chat id recorded on the lead (bale_chat_id -
//               the only identifier the Bale Bot API accepts; a bot gets one
//               only after the person has started a chat with it), OR the
//               mobile as an UNVERIFIED Bale candidate: Bale's Safir API
//               sends to a phone number but rejects numbers without a Bale
//               account (error 17). A phone number is never presented as a
//               verified Bale recipient.
//
// Each detail says where it came from (source + detail), so the admin can
// see e.g. "from the company website (url)" vs "entered manually".
// ---------------------------------------------------------------------------

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

function latinDigits(value) {
  return String(value || '').replace(/[۰-۹٠-٩]/g, (d) => String(Math.max(PERSIAN_DIGITS.indexOf(d), ARABIC_DIGITS.indexOf(d))))
}

export function normalizeMobile(value) {
  const text = latinDigits(value)
  return isValidIranMobile(text) ? toE164Iran(text) : null
}

export function firstMobile(lead) {
  const values = [...splitContactDisplay(latinDigits(lead?.mobile)), lead?.mobile, ...splitContactDisplay(latinDigits(lead?.phone))]
  for (const value of values) {
    const mobile = normalizeMobile(value)
    if (mobile) return mobile
  }
  return null
}

export const CONTACT_SOURCE_LABELS = {
  company_website: 'از وب‌سایت خود شرکت',
  discovery: 'از منبع کشف خودکار',
  uploaded_list: 'از فهرست آپلودشده (پس از ثبت به‌عنوان سرنخ)',
  lead_import: 'از فایل ورود گروهی سرنخ',
  manual: 'ثبت دستی',
}

// Where the lead itself came from - the default source of its details.
export function leadOrigin(lead) {
  const tags = lead?.tags || []
  if (tags.includes('prospecting')) {
    const sourceTag = tags.find((t) => String(t).startsWith('منبع:'))
    const sourceName = sourceTag ? String(sourceTag).slice('منبع:'.length) : null
    return { source: sourceName === 'آپلود دستی' ? 'uploaded_list' : 'discovery', detail: sourceName }
  }
  if (lead?.import_batch_id) return { source: 'lead_import', detail: lead.source_row_number ? `ردیف ${lead.source_row_number}` : null }
  return { source: 'manual', detail: null }
}

export function detectContactPoints(lead) {
  const origin = leadOrigin(lead)
  const points = { email: null, whatsapp: null, bale: null }

  const email = normalizeEmail(lead?.email)
  if (email) {
    const fromWebsite = hasUsableText(lead.email_source_url)
    points.email = {
      channel: 'email',
      destination: email,
      kind: 'email',
      verified: true,
      source: fromWebsite ? 'company_website' : origin.source,
      sourceDetail: fromWebsite ? lead.email_source_url : origin.detail,
    }
  }

  const mobile = firstMobile(lead)
  if (mobile) {
    points.whatsapp = { channel: 'whatsapp', destination: mobile, kind: 'mobile', verified: false, source: origin.source, sourceDetail: origin.detail }
  }

  const chatId = hasUsableText(lead?.bale_chat_id) ? String(lead.bale_chat_id).trim() : null
  if (chatId) {
    points.bale = {
      channel: 'bale',
      destination: chatId,
      kind: 'bale_chat_id',
      verified: true,
      source: lead.bale_chat_id_source || 'manual',
      sourceDetail: null,
    }
  } else if (mobile) {
    points.bale = { channel: 'bale', destination: mobile, kind: 'mobile_unverified', verified: false, source: origin.source, sourceDetail: origin.detail }
  }
  return points
}

export function hasAnyContact(points) {
  return Boolean(points.email || points.whatsapp || points.bale)
}
