import { formatJalaliDate, formatRial } from '../../utils/formatters'
import '../common/DataTable.css'

export default function PaymentsList({ payments }) {
  if (!payments || payments.length === 0) {
    return <p className="order-items-warning">پرداختی ثبت نشده است.</p>
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>تاریخ</th>
            <th>مبلغ</th>
            <th>روش</th>
            <th>شماره پیگیری</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>{formatJalaliDate(payment.paid_at)}</td>
              <td>{formatRial(payment.amount_rial)}</td>
              <td>{payment.method || '—'}</td>
              <td dir="ltr" style={{ textAlign: 'right' }}>
                {payment.reference_code || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
