import { whatsappChannel } from './channels/whatsapp.js'
import { phoneChannel } from './channels/phone.js'
import { smsChannel } from './channels/sms.js'
import { emailChannel } from './channels/email.js'

// Deterministic priority order per the Phase 19 spec:
//   1. lead.preferred_channel, if it's one of the 4 supported channels AND
//      that channel's own data requirement is met
//   2. whatsapp if a valid Iranian mobile exists
//   3. phone if a phone/mobile number exists
//   4. sms if a valid mobile exists
//   5. email if a valid email exists
//   6. otherwise no channel (blocked)
const CHANNELS_BY_KEY = {
  whatsapp: whatsappChannel,
  phone: phoneChannel,
  sms: smsChannel,
  email: emailChannel,
}

const FALLBACK_ORDER = [whatsappChannel, phoneChannel, smsChannel, emailChannel]

export function selectOutreachChannel(lead) {
  const preferred = lead?.preferred_channel ? CHANNELS_BY_KEY[lead.preferred_channel] : null
  if (preferred && preferred.canHandle(lead)) return preferred.key

  for (const channel of FALLBACK_ORDER) {
    if (channel.canHandle(lead)) return channel.key
  }
  return null
}

export function getChannelAdapter(channelKey) {
  return CHANNELS_BY_KEY[channelKey] || null
}
