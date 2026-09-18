import { useCompanyBalance } from '../../hooks/useCompanyBalance'
import { useCustomerInvoices } from '../../hooks/useCustomerInvoices'
import { useCompanyPayments } from '../../hooks/useCompanyPayments'
import { formatJalaliDate, formatRial } from '../../utils/formatters'
import { describeBalance } from '../../utils/balance'
import InvoiceStatusBadge from '../invoices/InvoiceStatusBadge'
import PaymentsList from '../invoices/PaymentsList'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import './AccountPage.css'

const SETTLED_INVOICE_STATUSES = ['paid', 'cancelled']

export default function AccountPage({ company, onOpenInvoice }) {
  const { balance, loading: balanceLoading, error: balanceError } = useCompanyBalance(
    company?.id,
  )
  const { invoices, loading: invoicesLoading, error: invoicesError } = useCustomerInvoices(
    company?.id,
  )
  const { payments, loading: paymentsLoading, error: paymentsError } = useCompanyPayments(
    company?.id,
  )

  const openInvoices = invoices.filter((inv) => !SETTLED_INVOICE_STATUSES.includes(inv.status))
  const balanceInfo = balance !== null ? describeBalance(balance) : null

  return (
    <div>
      <div className="page-toolbar">
        <h2>حساب و پرداخت‌ها</h2>
      </div>

      <ErrorBanner message={balanceError} />

      <div className="balance-card">
        <span className="balance-title">مانده حساب</span>
        {balanceLoading || !balanceInfo ? (
          <span className="balance-value">—</span>
        ) : balance === 0 ? (
          <span className="balance-value tone-success">تسویه</span>
        ) : (
          <>
            <span className={`balance-value tone-${balanceInfo.tone}`}>
              {formatRial(balanceInfo.amount)}
            </span>
            <span className="balance-sublabel">{balanceInfo.label}</span>
          </>
        )}
      </div>

      <h3>فاکتورهای باز</h3>
      <ErrorBanner message={invoicesError} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>شماره فاکتور</th>
              <th>تاریخ</th>
              <th>مبلغ</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoicesLoading && (
              <tr>
                <td colSpan={5} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!invoicesLoading && openInvoices.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  فاکتور بازی وجود ندارد.
                </td>
              </tr>
            )}
            {!invoicesLoading &&
              openInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {invoice.invoice_number ?? invoice.id}
                  </td>
                  <td>{formatJalaliDate(invoice.issued_at)}</td>
                  <td>{formatRial(invoice.total_rial)}</td>
                  <td>
                    <InvoiceStatusBadge status={invoice.status} />
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onOpenInvoice(invoice.id)}
                    >
                      مشاهده
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h3>پرداخت‌ها</h3>
      <ErrorBanner message={paymentsError} />
      {paymentsLoading ? <p>در حال بارگذاری...</p> : <PaymentsList payments={payments} />}
    </div>
  )
}
