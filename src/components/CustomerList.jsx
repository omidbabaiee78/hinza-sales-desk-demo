import { useMemo, useState } from 'react'
import { STATUS_OPTIONS, STATUS_LABELS } from '../data/statusOptions'
import { isOverdue } from '../utils/followUp'
import StatusBadge from './StatusBadge'
import CustomerForm from './CustomerForm'
import './CustomerList.css'

export default function CustomerList({
  customers,
  loading,
  error,
  onAdd,
  onUpdate,
  onDelete,
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return customers.filter((c) => {
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter
      if (!matchesStatus) return false
      if (!query) return true
      return [
        c.company_name,
        c.contact_person,
        c.phone,
        c.city,
        c.interested_product,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [customers, search, statusFilter])

  async function handleAddSave(customer) {
    await onAdd(customer)
    setShowAddForm(false)
  }

  async function handleEditSave(customer) {
    await onUpdate(editingCustomer.id, customer)
    setEditingCustomer(null)
  }

  async function handleDelete(customer) {
    const confirmed = window.confirm(
      `مشتری «${customer.company_name}» حذف شود؟ این عملیات قابل بازگشت نیست.`,
    )
    if (!confirmed) return
    setDeleteError('')
    setDeletingId(customer.id)
    try {
      await onDelete(customer.id)
    } catch (err) {
      setDeleteError(err.message || 'حذف مشتری با خطا مواجه شد.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="customer-list">
      <div className="toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="جستجو بر اساس شرکت، شخص رابط، تلفن، شهر، محصول..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">همه وضعیت‌ها</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowAddForm(true)}
        >
          + افزودن مشتری
        </button>
      </div>

      {error && <div className="list-banner list-banner-error">{error}</div>}
      {deleteError && (
        <div className="list-banner list-banner-error">{deleteError}</div>
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>نام شرکت</th>
              <th>شخص رابط</th>
              <th>شماره تماس</th>
              <th>شهر</th>
              <th>محصول موردنیاز</th>
              <th>وضعیت</th>
              <th>تاریخ پیگیری بعدی</th>
              <th>یادداشت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              filteredCustomers.map((c) => {
                const overdue = isOverdue(c)
                return (
                  <tr key={c.id} className={overdue ? 'row-overdue' : ''}>
                    <td className="cell-company">{c.company_name}</td>
                    <td>{c.contact_person}</td>
                    <td>{c.phone}</td>
                    <td>{c.city}</td>
                    <td>{c.interested_product}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td
                      className={
                        overdue ? 'cell-followup overdue' : 'cell-followup'
                      }
                    >
                      {c.next_follow_up || '—'}
                      {overdue && (
                        <span className="overdue-tag">دارای تأخیر</span>
                      )}
                    </td>
                    <td className="cell-notes" title={c.notes}>
                      {c.notes || '—'}
                    </td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => setEditingCustomer(c)}
                      >
                        ویرایش
                      </button>
                      <button
                        type="button"
                        className="btn-link btn-link-danger"
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.id}
                      >
                        {deletingId === c.id ? 'در حال حذف...' : 'حذف'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            {!loading && filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-row">
                  هیچ مشتری‌ای مطابق جستجو یا فیلتر شما یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <CustomerForm
          onSave={handleAddSave}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {editingCustomer && (
        <CustomerForm
          initialCustomer={editingCustomer}
          onSave={handleEditSave}
          onCancel={() => setEditingCustomer(null)}
        />
      )}
    </div>
  )
}
