import { useState } from 'react'
import { changeLeadStatus } from '../../../services/salesLeads'
import { PIPELINE_STATUSES, leadStatusLabel } from '../../../utils/leadStatus'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

// Only offers the 6 active pipeline statuses - converted/lost each have
// their own dedicated flow (conversion RPC / loss-reason modal) and are
// deliberately never reachable from this generic dropdown.
export default function LeadStatusChangeModal({ leadId, currentStatus, onSaved, onCancel }) {
  const [status, setStatus] = useState(currentStatus)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await changeLeadStatus(leadId, status)
      onSaved()
    } catch (err) {
      setError(err.message || 'تغییر وضعیت با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>تغییر وضعیت</h2>
        <form onSubmit={handleSubmit}>
          <label>
            وضعیت جدید
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {PIPELINE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {leadStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || status === currentStatus}>
              {submitting ? 'در حال ذخیره...' : 'ثبت'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
