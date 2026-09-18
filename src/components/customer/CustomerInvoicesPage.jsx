import { useCustomerInvoices } from '../../hooks/useCustomerInvoices'
import { formatJalaliDate, formatRial } from '../../utils/formatters'
import InvoiceStatusBadge from '../invoices/InvoiceStatusBadge'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'

export default function CustomerInvoicesPage({ company, onOpenInvoice }) {
  const { invoices, loading, error, refresh } = useCustomerInvoices(company?.id)

  return (
    <div>
      <div className="page-toolbar">
        <h2>فاکتورها</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

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
            {loading && (
              <tr>
                <td colSpan={5} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              invoices.map((invoice) => (
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
                      مشاهده فاکتور
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && invoices.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  فاکتوری برای شما ثبت نشده است.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
