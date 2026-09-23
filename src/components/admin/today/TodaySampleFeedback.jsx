import { useEffect, useState } from 'react'
import { fetchDueSamples, sampleProductLabel } from '../../../services/leadSamples'
import { formatJalaliDate, formatKg } from '../../../utils/formatters'
import { tehranDateKey } from '../../../utils/leadFollowUp'

// Pending samples whose feedback is due today or overdue. Renders nothing
// when there are none (or before the phase-27 table exists), so Today stays
// unchanged for salespeople without open samples.
export default function TodaySampleFeedback({ reloadToken, onOpenLead }) {
  const [samples, setSamples] = useState([])
  const todayKey = tehranDateKey()

  useEffect(() => {
    let ignore = false
    fetchDueSamples(todayKey)
      .then((rows) => {
        if (!ignore) setSamples(rows)
      })
      .catch(() => {
        if (!ignore) setSamples([])
      })
    return () => {
      ignore = true
    }
  }, [reloadToken, todayKey])

  if (samples.length === 0) return null

  return (
    <section className="today-section">
      <h3>بازخورد نمونه ({samples.length})</h3>
      <div className="today-item-list">
        {samples.map((sample) => {
          const lead = sample.sales_leads
          const overdue = sample.feedback_due_on < todayKey
          return (
            <div key={sample.id} className="today-card">
              <div className="today-item-row">
                <div className="today-item-main">
                  <span className="today-item-title">{lead.company_name || lead.contact_name}</span>
                  <span className="today-item-reason">
                    {sampleProductLabel(sample)} · {formatKg(sample.quantity_kg)} · موعد بازخورد: {formatJalaliDate(sample.feedback_due_on)}
                    {overdue ? ' (عقب‌افتاده)' : ' (امروز)'}
                  </span>
                </div>
                <div className="today-item-actions">
                  <button type="button" className="btn-link" onClick={() => onOpenLead(lead.id)}>
                    ثبت بازخورد در سرنخ
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
