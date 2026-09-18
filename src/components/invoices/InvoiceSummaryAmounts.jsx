import { formatRial } from '../../utils/formatters'
import './InvoiceSummaryAmounts.css'

export default function InvoiceSummaryAmounts({ totalRial, paidRial, remainingRial }) {
  return (
    <div className="invoice-summary-amounts">
      <div className="invoice-amount-row">
        <span>مبلغ فاکتور</span>
        <strong>{formatRial(totalRial)}</strong>
      </div>
      <div className="invoice-amount-row">
        <span>پرداخت‌شده</span>
        <strong>{formatRial(paidRial)}</strong>
      </div>
      <div className="invoice-amount-row invoice-amount-remaining">
        <span>مانده</span>
        <strong>{formatRial(remainingRial)}</strong>
      </div>
    </div>
  )
}
