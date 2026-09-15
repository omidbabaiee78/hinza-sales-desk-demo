import { useMemo, useState } from 'react'
import { STATUS_OPTIONS } from '../data/seedCustomers'
import StatusBadge from './StatusBadge'
import CustomerForm from './CustomerForm'
import './CustomerList.css'

export default function CustomerList({ customers, onAdd, onUpdate }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return customers.filter((c) => {
      const matchesStatus = statusFilter === 'All' || c.status === statusFilter
      if (!matchesStatus) return false
      if (!query) return true
      return [c.company, c.contact, c.phone, c.city, c.product]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [customers, search, statusFilter])

  function handleAddSave(customer) {
    onAdd(customer)
    setShowAddForm(false)
  }

  function handleEditSave(customer) {
    onUpdate(editingCustomer.id, customer)
    setEditingCustomer(null)
  }

  return (
    <div className="customer-list">
      <div className="toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="Search by company, contact, phone, city, product..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="All">All Statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowAddForm(true)}
        >
          + Add Customer
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>City</th>
              <th>Product</th>
              <th>Status</th>
              <th>Next Follow-up</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((c) => (
              <tr key={c.id}>
                <td className="cell-company">{c.company}</td>
                <td>{c.contact}</td>
                <td>{c.phone}</td>
                <td>{c.city}</td>
                <td>{c.product}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td>{c.nextFollowUp || '—'}</td>
                <td className="cell-notes" title={c.notes}>
                  {c.notes || '—'}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setEditingCustomer(c)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-row">
                  No customers match your search or filter.
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
