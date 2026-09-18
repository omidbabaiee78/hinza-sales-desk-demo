import { useMemo, useState } from 'react'
import { useAdminCustomers } from '../../hooks/useAdminCustomers'
import { formatJalaliDate } from '../../utils/formatters'
import { formatBalanceLine } from '../../utils/balance'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import './AdminOrdersPage.css'

export default function AdminCustomersPage({ onOpenCustomer }) {
  const { customers, loading, error, refresh } = useAdminCustomers()
  const [search, setSearch] = useState('')

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return customers
    return customers.filter((customer) =>
      [customer.name, customer.representative?.full_name, customer.representative?.phone, customer.city]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [customers, search])

  return (
    <div>
      <div className="page-toolbar">
        <h2>مشتریان</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      <div className="orders-filters">
        <input
          type="text"
          className="search-input"
          placeholder="جستجو بر اساس شرکت، نماینده، موبایل یا شهر..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>نام شرکت</th>
              <th>نام مشتری / نماینده</th>
              <th>موبایل</th>
              <th>شهر</th>
              <th>مانده حساب</th>
              <th>آخرین خرید</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              filteredCustomers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>{customer.representative?.full_name || '—'}</td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {customer.representative?.phone || '—'}
                  </td>
                  <td>{customer.city || '—'}</td>
                  <td>{formatBalanceLine(customer.balance)}</td>
                  <td>
                    {customer.lastPurchaseAt ? formatJalaliDate(customer.lastPurchaseAt) : '—'}
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onOpenCustomer(customer.id)}
                    >
                      مشاهده
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  مشتری‌ای مطابق جستجو یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
