import { useMemo, useState } from 'react'
import { useAdminInvoices } from '../../hooks/useAdminInvoices'
import { formatJalaliDate, formatRial } from '../../utils/formatters'
import { invoiceStatusLabel } from '../../utils/invoice'
import InvoiceStatusBadge from '../invoices/InvoiceStatusBadge'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import './AdminOrdersPage.css'

const INVOICE_STATUSES = ['issued', 'partially_paid', 'paid', 'cancelled']

export default function AdminInvoicesPage({ onOpenInvoice }) {
  const { invoices, companies, loading, error, refresh } = useAdminInvoices()
  const [statusFilter, setStatusFilter] = useState('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase()
    return invoices.filter((invoice) => {
      if (statusFilter !== 'all' && invoice.status !== statusFilter) return false
      if (companyFilter !== 'all' && invoice.company_id !== companyFilter) return false
      if (!query) return true
      return String(invoice.invoice_number ?? '').toLowerCase().includes(query)
    })
  }, [invoices, statusFilter, companyFilter, search])

  return (
    <div>
      <div className="page-toolbar">
        <h2>فاکتورها</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      <div className="orders-filters">
        <input
          type="text"
          className="search-input"
          placeholder="جستجو بر اساس شماره فاکتور..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">همه وضعیت‌ها</option>
          {INVOICE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {invoiceStatusLabel(status)}
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
              <th>شماره فاکتور</th>
              <th>شرکت</th>
              <th>تاریخ</th>
              <th>مبلغ</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              filteredInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {invoice.invoice_number ?? invoice.id}
                  </td>
                  <td>{invoice.company?.name || '—'}</td>
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
            {!loading && filteredInvoices.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  فاکتوری مطابق جستجو یا فیلتر یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
