import { sendWhatsApp } from './whatsappProvider.js'
import { sendEmail } from './emailProvider.js'

// Normalized provider registry - business logic (sendGate.js/sendPipeline.js)
// never imports a provider file directly, only this lookup. Room for future
// channels (SMS/Bale) without touching any existing adapter or caller.
const SEND_FUNCTIONS = {
  whatsapp: sendWhatsApp,
  email: sendEmail,
}

export function getProviderSendFn(channel) {
  return SEND_FUNCTIONS[channel] || null
}

export function isProviderChannel(channel) {
  return Boolean(SEND_FUNCTIONS[channel])
}
