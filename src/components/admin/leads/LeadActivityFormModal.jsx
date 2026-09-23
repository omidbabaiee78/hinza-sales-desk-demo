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
  const [completeFollowUp, setCompleteFollowUp] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const nextFollowUpAt = followUpIsoFromDate(followUpDate)
    try {
      await addLeadActivity(leadId, { activityType, note, nextFollowUpAt, clearFollowUp: completeFollowUp })
      onSaved({ note, nextFollowUpAt })
    } catch (err) {
      setError(err.message || 'ثبت فعالیت با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{activityType === 'phone' ? 'نتیجه تماس' : `ثبت ${leadActivityTypeLabel(activityType)}`}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            {activityType === 'phone' ? 'چه نتیجه‌ای گرفتید؟' : 'یادداشت'}
            <textarea rows={3} value={note} required={activityType === 'phone'} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label>
            پیگیری بعدی (اگر لازم است)
            <JalaliDateInput value={followUpDate} onChange={(value) => { setFollowUpDate(value); if (value) setCompleteFollowUp(false) }} />
          </label>
          {activityType === 'phone' && !followUpDate && <label className="product-form-availability">
            <input type="checkbox" checked={completeFollowUp} onChange={(e) => setCompleteFollowUp(e.target.checked)} />
            پیگیری تمام شد؛ موعد قبلی پاک شود
          </label>}
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
