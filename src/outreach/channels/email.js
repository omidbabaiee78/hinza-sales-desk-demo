import { hasUsableText } from '../shared.js'
import { disabledExecute } from './index.js'

export const emailChannel = {
  key: 'email',
  label: 'ایمیل',
  canHandle(lead) {
    return hasUsableText(lead?.email)
  },
  // Manual-only: a mailto: link that opens the admin's own mail client.
  prepare({ lead, message, subject }) {
    if (!hasUsableText(lead?.email)) return null
    const params = new URLSearchParams()
    if (subject) params.set('subject', subject)
    if (message) params.set('body', message)
    const query = params.toString()
    return { href: `mailto:${lead.email.trim()}${query ? `?${query}` : ''}` }
  },
  execute: disabledExecute('email'),
}
