import { useState } from 'react'
import ErrorBanner from '../common/ErrorBanner'
import '../common/Modal.css'

const EMPTY_FORM = { code: '', name_fa: '', category: '', description_fa: '' }

export default function ProductForm({ initialProduct, onSave, onCancel }) {
  const [form, setForm] = useState(
    initialProduct
      ? {
          code: initialProduct.code || '',
          name_fa: initialProduct.name_fa || '',
          category: initialProduct.category || '',
          description_fa: initialProduct.description_fa || '',
        }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEditing = Boolean(initialProduct)

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.code.trim() || !form.name_fa.trim()) return
    setError('')
    setSaving(true)
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message || 'ذخیره محصول با خطا مواجه شد.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{isEditing ? 'ویرایش محصول' : 'افزودن محصول'}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            کد محصول *
            <input
              type="text"
              dir="ltr"
              required
              value={form.code}
              onChange={(e) => handleChange('code', e.target.value)}
            />
          </label>
          <label>
            نام محصول *
            <input
              type="text"
              required
              value={form.name_fa}
              onChange={(e) => handleChange('name_fa', e.target.value)}
            />
          </label>
          <label>
            دسته‌بندی
            <input
              type="text"
              value={form.category}
              onChange={(e) => handleChange('category', e.target.value)}
            />
          </label>
          <label>
            توضیحات
            <textarea
              rows={3}
              value={form.description_fa}
              onChange={(e) => handleChange('description_fa', e.target.value)}
            />
          </label>

          <ErrorBanner message={error} />

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onCancel}
              disabled={saving}
            >
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'در حال ذخیره...' : isEditing ? 'ذخیره تغییرات' : 'افزودن محصول'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
