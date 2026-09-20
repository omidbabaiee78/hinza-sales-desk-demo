import { useMemo } from 'react'
import { useProspecting } from '../../../hooks/useProspecting'

function isToday(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

// A single compact summary, never the full Prospecting workspace - Today
// stays the daily command center, Prospecting stays the discovery
// workspace (see Phase 23 spec section 21).
export default function TodayProspectingSummary({ onOpenProspecting }) {
  const { candidates, loading } = useProspecting()

  const todayCount = useMemo(
    () => candidates.filter((c) => isToday(c.created_at) && (c.status === 'qualified' || c.status === 'manual_review')).length,
    [candidates],
  )

  if (!loading && todayCount === 0) return null

  return (
    <section className="today-section today-section-compact">
      <h3>مشتری‌های جدید پیشنهادی امروز</h3>
      <div className="today-card">
        <div className="today-item-row">
          <div className="today-item-main">
            <span className="today-item-title">{loading ? '—' : `${todayCount} شرکت جدید پیشنهادی`}</span>
            <span className="today-item-reason">موتور کشف مشتری امروز این تعداد شرکت را برای بررسی پیدا کرده است.</span>
          </div>
          <div className="today-item-actions">
            <button type="button" className="btn-link" onClick={onOpenProspecting}>
              مشاهده در کشف مشتری
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
