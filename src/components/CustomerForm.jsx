import { useState } from 'react'
import { STATUS_OPTIONS, STATUS_LABELS } from '../data/statusOptions'
import './CustomerForm.css'

const EMPTY_FORM = {
  company_name: '',
  contact_person: '',
  phone: '',
  city: '',
  interested_product: '',
  status: 'new',
  next_follow_up: '',
  notes: '',
}

export default function CustomerForm({ initialCustomer, onSave, onCancel }) {
  const [form, setForm] = useState(initialCustomer ?? EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEditing = Boolean(initialCustomer)

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.company_name.trim() || !form.contact_person.trim()) return
    setError('')
    setSaving(true)
    try {
      const payload = {
        company_name: form.company_name,
        contact_person: form.contact_person,
        phone: form.phone,
        city: form.city,
        interested_product: form.interested_product,
        status: form.status,
        next_follow_up: form.next_follow_up || null,
        notes: form.notes,
      }
      await onSave(payload)
    } catch (err) {
      setError(err.message || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="form-overlay" onClick={onCancel}>
      <div className="form-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{isEditing ? 'ویرایش مشتری' : 'افزودن مشتری'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              نام شرکت *
              <input
                type="text"
                required
                value={form.company_name}
                onChange={(e) => handleChange('company_name', e.target.value)}
              />
            </label>
            <label>
              شخص رابط *
              <input
                type="text"
                required
                value={form.contact_person}
                onChange={(e) =>
                  handleChange('contact_person', e.target.value)
                }
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              شماره تماس
              <input
                type="text"
                value={form.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
              />
            </label>
            <label>
              شهر
              <input
                type="text"
                value={form.city}
                onChange={(e) => handleChange('city', e.target.value)}
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              محصول موردنیاز
              <input
                type="text"
                value={form.interested_product}
                onChange={(e) =>
                  handleChange('interested_product', e.target.value)
                }
              />
            </label>
            <label>
              وضعیت
              <select
                value={form.status}
                onChange={(e) => handleChange('status', e.target.value)}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-row">
            <label>
              تاریخ پیگیری بعدی
              <input
                type="date"
                value={form.next_follow_up || ''}
                onChange={(e) =>
                  handleChange('next_follow_up', e.target.value)
                }
              />
            </label>
          </div>

          <label className="form-notes">
            یادداشت
            <textarea
              rows={3}
              value={form.notes || ''}
              onChange={(e) => handleChange('notes', e.target.value)}
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onCancel}
              disabled={saving}
            >
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? 'در حال ذخیره...'
                : isEditing
                  ? 'ذخیره تغییرات'
                  : 'افزودن مشتری'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
