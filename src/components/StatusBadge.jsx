import './StatusBadge.css'

const STATUS_CLASS = {
  New: 'status-new',
  Contacted: 'status-contacted',
  'Sample Sent': 'status-sample',
  'Price Offered': 'status-offer',
  Won: 'status-won',
  Lost: 'status-lost',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${STATUS_CLASS[status] ?? ''}`}>
      {status}
    </span>
  )
}
