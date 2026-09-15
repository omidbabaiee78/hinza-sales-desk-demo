import { useState } from 'react'
import { STATUS_OPTIONS } from '../data/seedCustomers'
import './CustomerForm.css'

const EMPTY_FORM = {
  company: '',
  contact: '',
  phone: '',
  city: '',
  product: '',
  status: 'New',
  nextFollowUp: '',
  notes: '',
}

export default function CustomerForm({ initialCustomer, onSave, onCancel }) {
  const [form, setForm] = useState(initialCustomer ?? EMPTY_FORM)
  const isEditing = Boolean(initialCustomer)

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.company.trim() || !form.contact.trim()) return
    onSave(form)
  }

  return (
    <div className="form-overlay" onClick={onCancel}>
      <div className="form-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{isEditing ? 'Edit Customer' : 'Add Customer'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              Company Name *
              <input
                type="text"
                required
                value={form.company}
                onChange={(e) => handleChange('company', e.target.value)}
              />
            </label>
            <label>
              Contact Person *
              <input
                type="text"
                required
                value={form.contact}
                onChange={(e) => handleChange('contact', e.target.value)}
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              Phone
              <input
                type="text"
                value={form.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
              />
            </label>
            <label>
              City
              <input
                type="text"
                value={form.city}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              Interested Product
              <input
                type="text"
                value={form.product}
                onChange={(e) => handleChange('product', e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={form.status}
                onChange={(e) => handleChange('status', e.target.value)}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-row">
            <label>
              Next Follow-up Date
              <input
                type="date"
                value={form.nextFollowUp}
                onChange={(e) => handleChange('nextFollowUp', e.target.value)}
              />
            </label>
          </div>

          <label className="form-notes">
            Notes
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
            />
          </label>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {isEditing ? 'Save Changes' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
