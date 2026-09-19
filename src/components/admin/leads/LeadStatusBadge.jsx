import { LEAD_STATUS_TONE, leadStatusLabel } from '../../../utils/leadStatus'

export default function LeadStatusBadge({ status }) {
  const tone = LEAD_STATUS_TONE[status] || 'neutral'
  return <span className={`lead-status-badge tone-${tone}`}>{leadStatusLabel(status)}</span>
}
