import { telHref } from '../../constants/brand.js'
import { splitContactDisplay } from '../../utils/leadImport/contactNumbers.js'
import { hasUsableText } from '../shared.js'
import { disabledExecute } from './index.js'

function firstPhoneLike(lead) {
  if (lead?.mobile) {
    const list = splitContactDisplay(lead.mobile)
    if (list[0]) return list[0]
  }
  if (hasUsableText(lead?.phone)) {
    const list = splitContactDisplay(lead.phone)
    return list[0] || lead.phone
  }
  return null
}

export const phoneChannel = {
  key: 'phone',
  label: 'تماس تلفنی',
  canHandle(lead) {
    return Boolean(firstPhoneLike(lead))
  },
  // Manual-only: a tel: link the admin's own device dials - no telephony API.
  prepare({ lead }) {
    const number = firstPhoneLike(lead)
    if (!number) return null
    return { number, href: telHref(number) }
  },
  execute: disabledExecute('phone'),
}
