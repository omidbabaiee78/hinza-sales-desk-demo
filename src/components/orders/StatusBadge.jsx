import { statusLabel, STATUS_TONE } from '../../utils/orderStatus'
import './StatusBadge.css'

export default function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || 'neutral'
  return (
    <span className={`order-status-badge tone-${tone}`}>
      {statusLabel(status)}
    </span>
  )
}
