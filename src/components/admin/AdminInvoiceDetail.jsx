import { useState } from 'react'
import { useInvoice } from '../../hooks/useInvoice'
import { useInvoicePayments } from '../../hooks/useInvoicePayments'
import { useCompanyBalance } from '../../hooks/useCompanyBalance'
import { formatRial } from '../../utils/formatters'
import { calcInvoicePaid, calcInvoiceRemaining } from '../../utils/invoice'
import { describeBalance } from '../../utils/balance'
import InvoiceStatusBadge from '../invoices/InvoiceStatusBadge'
import InvoiceDocument from '../invoices/InvoiceDocument'
import PaymentForm from '../invoices/PaymentForm'
import ErrorBanner from '../common/ErrorBanner'
import LoadingScreen from '../common/LoadingScreen'
import '../orders/OrderDetail.css'

export default function AdminInvoiceDetail({ invoiceId, onBack }) {
  const { invoice, company, loading, error, refresh } = useInvoice(invoiceId)
  const { payments, loading: paymentsLoading, registerPayment, submitting } =
    useInvoicePayments(invoiceId)
  const { balance, refresh: refreshBalance } = useCompanyBalance(invoice?.company_id)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  if (loading) return <LoadingScreen text="در حال بارگذاری فاکتور..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!invoice) return null

  const paidRial = calcInvoicePaid(payments)
  const remainingRial = calcInvoiceRemaining(invoice.total_rial, paidRial)
  const balanceInfo = balance !== null ? describeBalance(balance) : null

  async function handleRegisterPayment(values) {
    await registerPayment({ companyId: invoice.company_id, ...values })
    refresh()
    refreshBalance()
    setShowPaymentForm(false)
    setSuccessMessage('پرداخت با موفقیت ثبت شد.')
  }

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

      {successMessage && <div className="success-banner no-print">{successMessage}</div>}

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

      <div className="order-detail-grid no-print" style={{ marginTop: 20 }}>
        <section className="order-detail-card">
          <h3>مانده حساب شرکت</h3>
          {balanceInfo ? (
            <div className="info-row">
              <span className="info-label">مانده فعلی</span>
              <span className="info-value">
                {balance === 0 ? 'تسویه' : `${balanceInfo.label} ${formatRial(balanceInfo.amount)}`}
              </span>
            </div>
          ) : (
            <p className="profile-empty">در حال محاسبه...</p>
          )}
        </section>

        <section className="order-detail-card">
          <h3>ثبت پرداخت</h3>
          {!showPaymentForm ? (
            <button type="button" className="btn-primary" onClick={() => setShowPaymentForm(true)}>
              ثبت پرداخت
            </button>
          ) : (
            <PaymentForm
              onSubmit={handleRegisterPayment}
              onCancel={() => setShowPaymentForm(false)}
              submitting={submitting}
            />
          )}
        </section>
      </div>
    </div>
  )
}
