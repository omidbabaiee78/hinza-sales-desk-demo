import { telHref, whatsappHref } from '../../../constants/brand'
import { toE164Iran } from '../../../utils/phone'
import { splitContactDisplay } from '../../../utils/leadImport/contactNumbers'

// Manual contact only - tel: link and a wa.me deep link with no prefilled
// text. No WhatsApp API, no SMS provider, no automatic messaging.
export default function LeadQuickContact({ phone, compact }) {
  if (!phone) return null
  // A lead's mobile/phone field may hold more than one number (e.g. a
  // bulk-imported row with two landlines, joined for display as "021-...،
  // 021-...") - these quick-contact links only ever act on the first one.
  const firstPhone = splitContactDisplay(phone)[0] || phone
  const intlPhone = toE164Iran(firstPhone).replace('+', '')
  return (
    <span className={compact ? 'lead-quick-contact-compact' : 'lead-quick-contact'} onClick={(e) => e.stopPropagation()}>
      <a className="btn-link" href={telHref(firstPhone)}>
        تماس
      </a>
      <a className="btn-link" href={whatsappHref(intlPhone)} target="_blank" rel="noopener noreferrer">
        واتساپ
      </a>
    </span>
  )
}
