import { formatJalaliDate, formatRial } from '../../../utils/formatters'
import InvoiceStatusBadge from '../../invoices/InvoiceStatusBadge'
import '../../common/DataTable.css'
import './Reports.css'

export default function OutstandingInvoicesTable({ invoices, onOpenInvoice }) {
  if (invoices.length === 0) {
    return <p className="profile-empty">فاکتور باز یا معوقی وجود ندارد.</p>
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>مشتری</th>
            <th>شماره فاکتور</th>
            <th>تاریخ</th>
            <th>سررسید</th>
            <th>مبلغ کل</th>
            <th>پرداخت‌شده</th>
            <th>مانده</th>
            <th>وضعیت</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr
              key={invoice.id}
              className={`clickable-row${invoice.isOverdue ? ' reports-row-overdue' : ''}`}
              onClick={() => onOpenInvoice(invoice.id)}
            >
              <td>{invoice.companyName}</td>
              <td dir="ltr" style={{ textAlign: 'right' }}>
                {invoice.invoice_number ?? invoice.id}
              </td>
              <td>{formatJalaliDate(invoice.issued_at)}</td>
              <td>{invoice.due_date ? formatJalaliDate(invoice.due_date) : '—'}</td>
              <td>{formatRial(invoice.total_rial)}</td>
              <td>{formatRial(invoice.paidRial)}</td>
              <td>{formatRial(invoice.remainingRial)}</td>
              <td>
                <InvoiceStatusBadge status={invoice.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
