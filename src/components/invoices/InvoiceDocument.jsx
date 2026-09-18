import { formatJalaliDate } from '../../utils/formatters'
import { calcInvoiceSubtotal } from '../../utils/invoice'
import InvoiceStatusBadge from './InvoiceStatusBadge'
import InvoiceItemsTable from './InvoiceItemsTable'
import InvoiceSummaryAmounts from './InvoiceSummaryAmounts'
import PaymentsList from './PaymentsList'
import './InvoiceDocument.css'

function settlementLabel(status, remainingRial, paidRial) {
  if (status === 'paid' || remainingRial === 0) return 'تسویه شده'
  if (status === 'partially_paid' || paidRial > 0) return 'بخشی پرداخت شده'
  return null
}

export default function InvoiceDocument({
  invoice,
  company,
  payments,
  paidRial,
  remainingRial,
}) {
  const items = invoice.invoice_items || []
  const subtotalRial = calcInvoiceSubtotal(items)
  const discountRial = Math.max(subtotalRial - (Number(invoice.total_rial) || 0), 0)
  const settlement = settlementLabel(invoice.status, remainingRial, paidRial)

  return (
    <div className="invoice-document">
      <div className="invoice-print-actions no-print">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          چاپ / ذخیره PDF
        </button>
      </div>

      <div className="invoice-doc-header">
        <div className="invoice-doc-seller">
          <h2>هینزا پلیمر</h2>
          <p>سند فروش B2B</p>
        </div>
        <div className="invoice-doc-meta">
          <div className="invoice-doc-meta-row">
            <span>شماره فاکتور</span>
            <strong dir="ltr">{invoice.invoice_number ?? invoice.id}</strong>
          </div>
          <div className="invoice-doc-meta-row">
            <span>تاریخ صدور</span>
            <strong>{formatJalaliDate(invoice.issued_at)}</strong>
          </div>
          {invoice.due_date && (
            <div className="invoice-doc-meta-row">
              <span>تاریخ سررسید</span>
              <strong>{formatJalaliDate(invoice.due_date)}</strong>
            </div>
          )}
          <div className="invoice-doc-meta-row">
            <span>وضعیت</span>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
        </div>
      </div>

      <div className="invoice-doc-buyer">
        <h3>خریدار</h3>
        <div className="invoice-doc-buyer-row">
          <span>نام شرکت</span>
          <strong>{company?.name || '—'}</strong>
        </div>
        {company?.phone && (
          <div className="invoice-doc-buyer-row">
            <span>شماره تماس</span>
            <strong dir="ltr">{company.phone}</strong>
          </div>
        )}
        {company?.city && (
          <div className="invoice-doc-buyer-row">
            <span>شهر</span>
            <strong>{company.city}</strong>
          </div>
        )}
      </div>

      {invoice.note && (
        <p className="invoice-doc-note">
          <span>توضیح: </span>
          {invoice.note}
        </p>
      )}

      <h3 className="invoice-doc-section-title">اقلام فاکتور</h3>
      <InvoiceItemsTable items={items} />

      <InvoiceSummaryAmounts
        subtotalRial={subtotalRial}
        discountRial={discountRial}
        totalRial={invoice.total_rial}
        paidRial={paidRial}
        remainingRial={remainingRial}
      />

      <h3 className="invoice-doc-section-title">پرداخت‌ها</h3>
      {settlement && <p className={`invoice-doc-settlement settlement-${settlement === 'تسویه شده' ? 'paid' : 'partial'}`}>{settlement}</p>}
      <PaymentsList payments={payments} />

      <p className="invoice-doc-disclaimer">
        این سند یک فاکتور فروش تجاری داخلی است و به‌عنوان فاکتور رسمی/الکترونیکی مالیاتی تلقی
        نمی‌شود. مبالغ مندرج در این سند همگی به ریال است.
      </p>
    </div>
  )
}
