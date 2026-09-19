import { useState } from 'react'
import { markLeadLost } from '../../../services/salesLeads'
import { LEAD_LOSS_REASONS, leadLossReasonLabel } from '../../../utils/leadStatus'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

export default function LeadLostModal({ leadId, hasFollowUp, onSaved, onCancel }) {
  const [lossReason, setLossReason] = useState('')
  const [clearFollowUp, setClearFollowUp] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await markLeadLost(leadId, { lossReason: lossReason || null, clearFollowUp })
      onSaved()
    } catch (err) {
      setError(err.message || 'ثبت از دست رفته با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>از دست رفته</h2>
        <form onSubmit={handleSubmit}>
          <label>
            دلیل (اختیاری)
            <select value={lossReason} onChange={(e) => setLossReason(e.target.value)}>
              <option value="">—</option>
              {LEAD_LOSS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {leadLossReasonLabel(r)}
                </option>
              ))}
            </select>
          </label>
          {hasFollowUp && (
            <label className="product-form-availability">
              <input
                type="checkbox"
                checked={clearFollowUp}
                onChange={(e) => setClearFollowUp(e.target.checked)}
              />
              پاک کردن پیگیری بعدی
            </label>
          )}
          <p className="lead-form-hint">تاریخچه این سرنخ حذف نمی‌شود و برای مراجعه بعدی باقی می‌ماند.</p>
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-danger" disabled={submitting}>
              {submitting ? 'در حال ثبت...' : 'ثبت از دست رفته'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
