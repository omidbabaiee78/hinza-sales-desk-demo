import { useInvoice } from '../../hooks/useInvoice'
import { useInvoicePayments } from '../../hooks/useInvoicePayments'
import { calcInvoicePaid, calcInvoiceRemaining } from '../../utils/invoice'
import InvoiceStatusBadge from '../invoices/InvoiceStatusBadge'
import InvoiceDocument from '../invoices/InvoiceDocument'
import ErrorBanner from '../common/ErrorBanner'
import LoadingScreen from '../common/LoadingScreen'
import '../orders/OrderDetail.css'

export default function CustomerInvoiceDetail({ invoiceId, onBack }) {
  const { invoice, company, loading, error, refresh } = useInvoice(invoiceId)
  const { payments, loading: paymentsLoading } = useInvoicePayments(invoiceId)

  if (loading) return <LoadingScreen text="در حال بارگذاری فاکتور..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!invoice) return null

  const paidRial = calcInvoicePaid(payments)
  const remainingRial = calcInvoiceRemaining(invoice.total_rial, paidRial)

  return (
    <div className="order-detail">
      <div className="page-toolbar no-print">
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <h2>
          فاکتور {invoice.invoice_number ?? invoice.id}{' '}
          <InvoiceStatusBadge status={invoice.status} />
        </h2>
      </div>

      {paymentsLoading ? (
        <p className="no-print">در حال بارگذاری فاکتور...</p>
      ) : (
        <InvoiceDocument
          invoice={invoice}
          company={company}
          payments={payments}
          paidRial={paidRial}
          remainingRial={remainingRial}
        />
      )}
    </div>
  )
}
