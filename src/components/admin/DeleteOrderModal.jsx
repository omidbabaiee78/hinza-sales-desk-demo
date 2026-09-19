import { useState } from 'react'
import ErrorBanner from '../common/ErrorBanner'
import '../common/Modal.css'

export default function DeleteOrderModal({ orderNumber, onConfirm, onCancel }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    if (submitting) return
    setError('')
    setSubmitting(true)
    try {
      await onConfirm()
    } catch (err) {
      setError(err.message || 'حذف سفارش با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>حذف کامل سفارش</h2>
        <p>آیا از حذف کامل سفارش {orderNumber} مطمئن هستید؟</p>
        <p className="modal-warning">این عملیات قابل بازگشت نیست.</p>
        <ErrorBanner message={error} />
        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            انصراف
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? 'در حال حذف...' : 'بله، حذف شود'}
          </button>
        </div>
      </div>
    </div>
  )
}
