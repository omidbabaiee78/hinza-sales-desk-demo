import { CHANNEL_STATE_LABELS, DESTINATION_KIND_LABELS } from '../../../outreach/channelOutreach'
import { CONTACT_SOURCE_LABELS } from '../../../outreach/contactPoints'
import { formatJalaliDateTime } from '../../../utils/formatters'

const TONE = {
  sent: 'tone-won',
  delivered: 'tone-won',
  queued: 'tone-offer',
  sending: 'tone-offer',
  contact_found: 'tone-offer',
  ready: 'tone-offer',
  not_configured: 'tone-contacted',
  failed: 'tone-lost',
  bounced: 'tone-lost',
  uncertain: 'tone-lost',
  opted_out: 'tone-lost',
}

export function StatusBadge({ stateKey, text }) {
  return <span className={`lead-status-badge ${TONE[stateKey] || ''}`}>{text}</span>
}

// One lead's status on one channel (WhatsApp/Bale): state, destination and
// what kind of identifier it is, where it came from, and the provider result.
export default function ChannelStatusCell({ channel, showSource = false }) {
  const { state, point, message } = channel
  return (
    <div>
      <StatusBadge stateKey={state} text={CHANNEL_STATE_LABELS[state] || state} />
      {point && (
        <div className="lead-form-hint" dir="auto">
          <span dir="ltr">{point.destination}</span> · {DESTINATION_KIND_LABELS[point.kind]}
        </div>
      )}
      {showSource && point && <div className="lead-form-hint">منبع: {CONTACT_SOURCE_LABELS[point.source] || point.source}</div>}
      {message?.error_code && <div className="lead-form-hint">خطا: {message.error_code}</div>}
      {message?.sent_at && <div className="lead-form-hint">{formatJalaliDateTime(message.sent_at)}</div>}
    </div>
  )
}
