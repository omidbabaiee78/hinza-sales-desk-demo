import { useState } from 'react'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

// Confirmation-required per the Phase 19 spec - do_not_contact is a hard,
// hard-to-reverse stop everywhere else in the app, so it never applies from
// a single unconfirmed click here either.
export default function DoNotContactConfirmModal({ companyLabel, onConfirm, onCancel }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setSubmitting(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      setError(err.message || 'ثبت عدم تماس با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>ثبت عدم تماس</h2>
        <p className="lead-form-hint">
          {companyLabel ? `«${companyLabel}»` : 'این سرنخ'} دیگر در هیچ‌کدام از پیشنهادهای تماس هینزا نشان داده نخواهد شد. این
          تغییر همیشه از صفحه سرنخ‌ها قابل بازگشت است.
        </p>
        <ErrorBanner message={error} />
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
            انصراف
          </button>
          <button type="button" className="btn-danger" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'در حال ثبت...' : 'تأیید عدم تماس'}
          </button>
        </div>
      </div>
    </div>
  )
}
