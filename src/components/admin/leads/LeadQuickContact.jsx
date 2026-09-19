import { telHref, whatsappHref } from '../../../constants/brand'
import { toE164Iran } from '../../../utils/phone'

// Manual contact only - tel: link and a wa.me deep link with no prefilled
// text. No WhatsApp API, no SMS provider, no automatic messaging.
export default function LeadQuickContact({ phone, compact }) {
  if (!phone) return null
  const intlPhone = toE164Iran(phone).replace('+', '')
  return (
    <span className={compact ? 'lead-quick-contact-compact' : 'lead-quick-contact'} onClick={(e) => e.stopPropagation()}>
      <a className="btn-link" href={telHref(phone)}>
        تماس
      </a>
      <a className="btn-link" href={whatsappHref(intlPhone)} target="_blank" rel="noopener noreferrer">
        واتساپ
      </a>
    </span>
  )
}
