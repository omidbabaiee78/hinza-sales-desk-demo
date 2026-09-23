import { useState } from 'react'
import { SAMPLE_STATUS_LABELS, SAMPLE_STATUS_TONE, sampleProductLabel } from '../../../services/leadSamples'
import { formatJalaliDate, formatKg } from '../../../utils/formatters'
import { tehranDateKey } from '../../../utils/leadFollowUp'
import LeadSampleFormModal from './LeadSampleFormModal'
import LeadSampleFeedbackModal from './LeadSampleFeedbackModal'

export default function LeadSamplesSection({ leadId, samples, canRecord, notice, onChanged }) {
  const [showForm, setShowForm] = useState(false)
  const [feedbackSample, setFeedbackSample] = useState(null)
  const todayKey = tehranDateKey()

  function handleSaved(result) {
    setShowForm(false)
    setFeedbackSample(null)
    onChanged(result)
  }

  return (
    <section className="lead-detail-card lead-samples-card">
      <div className="lead-samples-header">
        <h3>نمونه‌ها</h3>
        {canRecord && (
          <button type="button" className="btn-secondary" onClick={() => setShowForm(true)}>
            ثبت ارسال نمونه
          </button>
        )}
      </div>

      {notice && <p className="lead-form-hint">{notice}</p>}

      {samples.length === 0 ? (
        <p className="profile-empty">هنوز نمونه‌ای برای این سرنخ ثبت نشده است.</p>
      ) : (
        <ul className="lead-samples-list">
          {samples.map((sample) => {
            const isOverdue = sample.status === 'pending' && sample.feedback_due_on < todayKey
            return (
              <li key={sample.id}>
                <div className="lead-samples-row">
                  <strong>{sampleProductLabel(sample)}</strong>
                  <span className={`lead-status-badge tone-${SAMPLE_STATUS_TONE[sample.status]}`}>
                    {SAMPLE_STATUS_LABELS[sample.status]}
                  </span>
                </div>
                <div className="lead-samples-meta">
                  {formatKg(sample.quantity_kg)} · ارسال: {formatJalaliDate(sample.sent_on)} · موعد بازخورد:{' '}
                  <span className={isOverdue ? 'lead-samples-overdue' : undefined}>{formatJalaliDate(sample.feedback_due_on)}</span>
                </div>
                {sample.feedback_note && <p className="lead-activity-note">{sample.feedback_note}</p>}
                {sample.status === 'pending' && (
                  <button type="button" className="btn-link" onClick={() => setFeedbackSample(sample)}>
                    ثبت بازخورد
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {showForm && <LeadSampleFormModal leadId={leadId} onSaved={handleSaved} onCancel={() => setShowForm(false)} />}
      {feedbackSample && (
        <LeadSampleFeedbackModal sample={feedbackSample} onSaved={handleSaved} onCancel={() => setFeedbackSample(null)} />
      )}
    </section>
  )
}
