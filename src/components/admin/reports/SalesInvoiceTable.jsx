import { formatJalaliDate, formatRial } from '../../../utils/formatters'
import InvoiceStatusBadge from '../../invoices/InvoiceStatusBadge'
import '../../common/DataTable.css'

export default function SalesInvoiceTable({ invoices, onOpenInvoice }) {
  if (invoices.length === 0) {
    return <p className="profile-empty">در این بازه فروشی ثبت نشده است.</p>
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>تاریخ</th>
            <th>شماره فاکتور</th>
            <th>مشتری</th>
            <th>مبلغ</th>
            <th>وضعیت</th>
            <th>پرداخت‌شده</th>
            <th>مانده</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="clickable-row" onClick={() => onOpenInvoice(invoice.id)}>
              <td>{formatJalaliDate(invoice.issued_at)}</td>
              <td dir="ltr" style={{ textAlign: 'right' }}>
                {invoice.invoice_number ?? invoice.id}
              </td>
              <td>{invoice.companyName}</td>
              <td>{formatRial(invoice.total_rial)}</td>
              <td>
                <InvoiceStatusBadge status={invoice.status} />
              </td>
              <td>{formatRial(invoice.paidRial)}</td>
              <td>{formatRial(invoice.remainingRial)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
