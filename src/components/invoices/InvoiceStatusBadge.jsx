import { invoiceStatusLabel, INVOICE_STATUS_TONE } from '../../utils/invoice'
import '../orders/StatusBadge.css'

export default function InvoiceStatusBadge({ status }) {
  const tone = INVOICE_STATUS_TONE[status] || 'neutral'
  return (
    <span className={`order-status-badge tone-${tone}`}>
      {invoiceStatusLabel(status)}
    </span>
  )
}
