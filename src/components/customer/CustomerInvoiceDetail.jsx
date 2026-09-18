import { useInvoice } from '../../hooks/useInvoice'
import { useInvoicePayments } from '../../hooks/useInvoicePayments'
import { formatJalaliDate } from '../../utils/formatters'
import { calcInvoicePaid, calcInvoiceRemaining } from '../../utils/invoice'
import InvoiceStatusBadge from '../invoices/InvoiceStatusBadge'
import InvoiceItemsTable from '../invoices/InvoiceItemsTable'
import InvoiceSummaryAmounts from '../invoices/InvoiceSummaryAmounts'
import PaymentsList from '../invoices/PaymentsList'
import ErrorBanner from '../common/ErrorBanner'
import LoadingScreen from '../common/LoadingScreen'
import '../orders/OrderDetail.css'

export default function CustomerInvoiceDetail({ invoiceId, onBack }) {
  const { invoice, loading, error, refresh } = useInvoice(invoiceId)
  const { payments, loading: paymentsLoading } = useInvoicePayments(invoiceId)

  if (loading) return <LoadingScreen text="در حال بارگذاری فاکتور..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!invoice) return null

  const paidRial = calcInvoicePaid(payments)
  const remainingRial = calcInvoiceRemaining(invoice.total_rial, paidRial)

  return (
    <div className="order-detail">
      <div className="page-toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <h2>
          فاکتور {invoice.invoice_number ?? invoice.id}{' '}
          <InvoiceStatusBadge status={invoice.status} />
        </h2>
      </div>

      <div className="order-detail-grid">
        <section className="order-detail-card">
          <h3>اطلاعات فاکتور</h3>
          <div className="info-row">
            <span className="info-label">تاریخ صدور</span>
            <span className="info-value">{formatJalaliDate(invoice.issued_at)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">تاریخ سررسید</span>
            <span className="info-value">{formatJalaliDate(invoice.due_date)}</span>
          </div>
          {invoice.note && (
            <div className="info-row">
              <span className="info-label">توضیح</span>
              <span className="info-value">{invoice.note}</span>
            </div>
          )}
        </section>
      </div>

      <h3>اقلام فاکتور</h3>
      <InvoiceItemsTable items={invoice.invoice_items || []} />

      <InvoiceSummaryAmounts
        totalRial={invoice.total_rial}
        paidRial={paidRial}
        remainingRial={remainingRial}
      />

      <h3>پرداخت‌ها</h3>
      {paymentsLoading ? <p>در حال بارگذاری...</p> : <PaymentsList payments={payments} />}
    </div>
  )
}
