import { useState } from 'react'
import { resolveLeadSample, sampleProductLabel } from '../../../services/leadSamples'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

export default function LeadSampleFeedbackModal({ sample, onSaved, onCancel }) {
  const [feedbackNote, setFeedbackNote] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(status) {
    setError('')
    setSubmitting(true)
    try {
      const result = await resolveLeadSample(sample, { status, feedbackNote })
      onSaved(result)
    } catch (err) {
      setError(err.message || 'ثبت بازخورد با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>بازخورد نمونه {sampleProductLabel(sample)}</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <label>
            توضیح مشتری (اختیاری)
            <textarea rows={3} value={feedbackNote} onChange={(e) => setFeedbackNote(e.target.value)} />
          </label>
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="button" className="btn-secondary btn-link-danger" onClick={() => submit('rejected')} disabled={submitting}>
              رد شد
            </button>
            <button type="button" className="btn-primary" onClick={() => submit('approved')} disabled={submitting}>
              تأیید شد
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
