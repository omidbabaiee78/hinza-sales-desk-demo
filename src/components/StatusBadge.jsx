import { STATUS_LABELS } from '../data/statusOptions'
import './StatusBadge.css'

const STATUS_CLASS = {
  new: 'status-new',
  contacted: 'status-contacted',
  sample_sent: 'status-sample',
  price_offered: 'status-offer',
  won: 'status-won',
  lost: 'status-lost',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${STATUS_CLASS[status] ?? ''}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}
