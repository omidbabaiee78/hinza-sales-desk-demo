import { useMemo, useState } from 'react'
import { useAdminOrders } from '../../hooks/useAdminOrders'
import { formatKg, formatRial } from '../../utils/formatters'
import { VISIBLE_ORDER_STATUSES, statusLabel } from '../../utils/orderStatus'
import StatusBadge from '../orders/StatusBadge'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import './AdminOrdersPage.css'

export default function AdminOrdersPage({ onOpenOrder }) {
  const { orders, companies, loading, error, refresh } = useAdminOrders()
  const [statusFilter, setStatusFilter] = useState('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase()
    return orders.filter((order) => {
      if (statusFilter !== 'all' && order.status !== statusFilter) return false
      if (companyFilter !== 'all' && order.company_id !== companyFilter) return false
      if (!query) return true
      return [
        order.order_number,
        order.company?.name,
        order.productsSummary,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [orders, statusFilter, companyFilter, search])

  return (
    <div>
      <div className="page-toolbar">
        <h2>سفارش‌ها</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      <div className="orders-filters">
        <input
          type="text"
          className="search-input"
          placeholder="جستجو بر اساس شماره سفارش، شرکت یا محصول..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">همه وضعیت‌ها</option>
          {VISIBLE_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="all">همه شرکت‌ها</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>شماره سفارش</th>
              <th>شرکت</th>
              <th>محصول</th>
              <th>مقدار</th>
              <th>وضعیت</th>
              <th>مبلغ</th>
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
              filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {order.order_number ?? order.id}
                  </td>
                  <td>{order.company?.name || '—'}</td>
                  <td>{order.productsSummary || '—'}</td>
                  <td>{formatKg(order.totalQuantityKg)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>
                    {order.status === 'pending_review'
                      ? '—'
                      : formatRial(order.total_rial)}
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onOpenOrder(order.id)}
                    >
                      باز کردن
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && filteredOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  سفارشی مطابق جستجو یا فیلتر یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
