import { useState } from 'react'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

// "Edit information" - the ONLY fields that get corrected here are the
// candidate's own record; the raw discovery payload (raw_data) is never
// touched, keeping provenance intact even after a manual correction.
export default function EditCandidateModal({ candidate, onSave, onCancel }) {
  const [fields, setFields] = useState({
    canonical_name: candidate.canonical_name || '',
    mobile: candidate.mobile || '',
    phone: candidate.phone || '',
    email: candidate.email || '',
    website: candidate.website || '',
    province: candidate.province || '',
    city: candidate.city || '',
    address: candidate.address || '',
    industry_guess: candidate.industry_guess || '',
    business_description: candidate.business_description || '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function set(key, value) {
    setFields((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSave(fields)
    } catch (err) {
      setError(err.message || 'ثبت تغییرات با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>ویرایش اطلاعات</h2>
        <form onSubmit={handleSubmit}>
          <label>
            نام شرکت
            <input value={fields.canonical_name} onChange={(e) => set('canonical_name', e.target.value)} required />
          </label>
          <label>
            موبایل
            <input value={fields.mobile} onChange={(e) => set('mobile', e.target.value)} />
          </label>
          <label>
            تلفن
            <input value={fields.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label>
            ایمیل
            <input value={fields.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label>
            وب‌سایت
            <input value={fields.website} onChange={(e) => set('website', e.target.value)} />
          </label>
          <label>
            استان
            <input value={fields.province} onChange={(e) => set('province', e.target.value)} />
          </label>
          <label>
            شهر
            <input value={fields.city} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label>
            آدرس
            <input value={fields.address} onChange={(e) => set('address', e.target.value)} />
          </label>
          <label>
            صنعت احتمالی
            <input value={fields.industry_guess} onChange={(e) => set('industry_guess', e.target.value)} />
          </label>
          <label>
            توضیحات کسب‌وکار
            <textarea rows={3} value={fields.business_description} onChange={(e) => set('business_description', e.target.value)} />
          </label>
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'در حال ذخیره...' : 'ذخیره و ارزیابی مجدد'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
