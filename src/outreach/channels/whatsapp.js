import { whatsappHref } from '../../constants/brand.js'
import { isValidIranMobile, toE164Iran } from '../../utils/phone.js'
import { splitContactDisplay } from '../../utils/leadImport/contactNumbers.js'
import { disabledExecute } from './index.js'

function firstValidMobile(lead) {
  const candidates = splitContactDisplay(lead?.mobile)
  const list = candidates.length > 0 ? candidates : [lead?.mobile]
  return list.find((value) => isValidIranMobile(value)) || null
}

export const whatsappChannel = {
  key: 'whatsapp',
  label: 'واتساپ',
  canHandle(lead) {
    return Boolean(firstValidMobile(lead))
  },
  // Manual-only: returns a wa.me deep link with the draft pre-filled -
  // opening it is a browser action, never an API call.
  prepare({ lead, message }) {
    const mobile = firstValidMobile(lead)
    if (!mobile) return null
    const intl = toE164Iran(mobile).replace('+', '')
    return { href: `${whatsappHref(intl)}?text=${encodeURIComponent(message || '')}` }
  },
  execute: disabledExecute('whatsapp'),
}
