import { isValidIranMobile } from '../../utils/phone.js'
import { splitContactDisplay } from '../../utils/leadImport/contactNumbers.js'
import { disabledExecute } from './index.js'

function firstValidMobile(lead) {
  const candidates = splitContactDisplay(lead?.mobile)
  const list = candidates.length > 0 ? candidates : [lead?.mobile]
  return list.find((value) => isValidIranMobile(value)) || null
}

export const smsChannel = {
  key: 'sms',
  label: 'پیامک',
  canHandle(lead) {
    return Boolean(firstValidMobile(lead))
  },
  // Manual-only: hands back the text to copy - never sent via any API.
  prepare({ lead, message }) {
    const mobile = firstValidMobile(lead)
    if (!mobile) return null
    return { mobile, text: message || '' }
  },
  execute: disabledExecute('sms'),
}
