import { useCompanyBalances } from '../../../hooks/useCompanyBalances'
import { formatRial } from '../../../utils/formatters'
import { formatBalanceLine } from '../../../utils/balance'
import '../../common/DataTable.css'
import './Reports.css'

export default function TopCustomersTable({ customers, onOpenCustomer }) {
  const companyIds = customers.map((c) => c.companyId)
  const { balanceByCompanyId } = useCompanyBalances(companyIds)

  if (customers.length === 0) {
    return <p className="profile-empty">در این بازه فروشی ثبت نشده است.</p>
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>مشتری</th>
            <th>تعداد فاکتور</th>
            <th>فروش دوره</th>
            <th>پرداخت‌شده</th>
            <th>مانده حساب فعلی</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr
              key={customer.companyId}
              className={onOpenCustomer ? 'clickable-row' : ''}
              onClick={() => onOpenCustomer?.(customer.companyId)}
            >
              <td>{customer.companyName}</td>
              <td>{customer.invoiceCount}</td>
              <td>{formatRial(customer.salesRial)}</td>
              <td>{formatRial(customer.paidRial)}</td>
              <td>
                {balanceByCompanyId.has(customer.companyId)
                  ? formatBalanceLine(balanceByCompanyId.get(customer.companyId))
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
