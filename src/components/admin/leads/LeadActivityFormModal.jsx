import { useState } from 'react'
import { addLeadActivity } from '../../../services/salesLeads'
import { followUpIsoFromDate } from '../../../utils/leadFollowUp'
import { leadActivityTypeLabel } from '../../../utils/leadStatus'
import JalaliDateInput from '../../common/JalaliDateInput'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

// One shared modal for every "ثبت ..." quick action (تماس/یادداشت/جلسه/
// نمونه/قیمت/پیگیری) - only the fixed activityType (and title) differ.
export default function LeadActivityFormModal({ leadId, activityType, onSaved, onCancel }) {
  const [note, setNote] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await addLeadActivity(leadId, {
        activityType,
        note,
        nextFollowUpAt: followUpIsoFromDate(followUpDate),
      })
      onSaved()
    } catch (err) {
      setError(err.message || 'ثبت فعالیت با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>ثبت {leadActivityTypeLabel(activityType)}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            یادداشت
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label>
            پیگیری بعدی (اختیاری)
            <JalaliDateInput value={followUpDate} onChange={setFollowUpDate} />
          </label>
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'در حال ثبت...' : 'ثبت'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
