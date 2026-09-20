import { useMemo, useState } from 'react'
import { useProspecting } from '../../../hooks/useProspecting'
import { formatJalaliDateTime } from '../../../utils/formatters'
import { runStatusLabel } from '../../../prospecting/prospectingLabels'
import ErrorBanner from '../../common/ErrorBanner'
import ProspectCandidateCard from './ProspectCandidateCard'
import UploadCandidatesModal from './UploadCandidatesModal'
import SourceManagementSection from './SourceManagementSection'
import '../../common/DataTable.css'
import '../today/Today.css'
import '../automation/Automation.css'
import '../outreach/Outreach.css'
import './Prospecting.css'

const TABS = [
  { key: 'top', label: 'پیشنهادهای برتر' },
  { key: 'manual_review', label: 'نیازمند بررسی' },
  { key: 'rejected', label: 'رد شده' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'promoted', label: 'واردشده به لیدها' },
  { key: 'runs', label: 'اجراها' },
  { key: 'sources', label: 'منابع' },
]

function isToday(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function AdminProspectingPage() {
  const {
    candidates,
    runs,
    sources,
    loading,
    running,
    runningSourceId,
    error,
    actionError,
    uploadAndRun,
    promote,
    reject,
    markDuplicate,
    updateFields,
    reEvaluate,
    toggleSource,
    testSourceHealth,
    runSourceNow,
  } = useProspecting()

  const [activeTab, setActiveTab] = useState('top')
  const [uploading, setUploading] = useState(false)

  const handlers = { promote, reject, markDuplicate, updateFields, reEvaluate }

  const buckets = useMemo(
    () => ({
      top: candidates.filter((c) => c.status === 'qualified'),
      manual_review: candidates.filter((c) => c.status === 'manual_review'),
      rejected: candidates.filter((c) => c.status === 'rejected'),
      duplicate: candidates.filter((c) => c.status === 'duplicate'),
      promoted: candidates.filter((c) => c.status === 'promoted'),
    }),
    [candidates],
  )

  const summary = useMemo(
    () => ({
      checkedToday: candidates.filter((c) => isToday(c.created_at) || isToday(c.last_seen_at)).length,
      newToday: candidates.filter((c) => isToday(c.created_at)).length,
      qualified: candidates.filter((c) => c.status === 'qualified' || c.status === 'promoted').length,
      promoted: buckets.promoted.length,
      duplicates: buckets.duplicate.length,
      needsReview: buckets.manual_review.length,
    }),
    [candidates, buckets],
  )

  async function handleUploadSubmit(rows) {
    setUploading(true)
    try {
      await uploadAndRun(rows)
    } finally {
      setUploading(false)
    }
  }

  const visibleCandidates = activeTab === 'runs' || activeTab === 'sources' ? [] : buckets[activeTab] || []

  return (
    <div className="prospecting-page">
      <div className="page-toolbar">
        <div>
          <h2>کشف مشتری</h2>
          <p className="today-subtitle">سیستم امروز چه مشتری‌های خوبی پیدا کرده؟</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setUploading(true)}>
          آپلود فهرست جدید
        </button>
      </div>

      <ErrorBanner message={error} />
      {actionError && <ErrorBanner message={actionError} />}

      <div className="today-summary-grid">
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{loading ? '—' : summary.checkedToday}</span>
          <span className="today-summary-label">امروز چند شرکت بررسی شد</span>
        </div>
        <div className="today-summary-card tone-offer">
          <span className="today-summary-value">{loading ? '—' : summary.newToday}</span>
          <span className="today-summary-label">چند مورد جدید پیدا شد</span>
        </div>
        <div className="today-summary-card tone-won">
          <span className="today-summary-value">{loading ? '—' : summary.qualified}</span>
          <span className="today-summary-label">چند مورد واجد شرایط بود</span>
        </div>
        <div className="today-summary-card tone-won">
          <span className="today-summary-value">{loading ? '—' : summary.promoted}</span>
          <span className="today-summary-label">چند مورد وارد بانک مشتری شد</span>
        </div>
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{loading ? '—' : summary.duplicates}</span>
          <span className="today-summary-label">چند Duplicate بود</span>
        </div>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{loading ? '—' : summary.needsReview}</span>
          <span className="today-summary-label">چند مورد نیازمند بررسی است</span>
        </div>
      </div>

      <div className="today-filters">
        <div className="today-filter-group">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`today-chip${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="profile-empty">در حال بارگذاری...</p>}

      {!loading && activeTab !== 'runs' && activeTab !== 'sources' && visibleCandidates.length === 0 && (
        <div className="today-empty-state">
          <p className="today-empty-title">موردی در این بخش وجود ندارد.</p>
        </div>
      )}

      {!loading && activeTab !== 'runs' && activeTab !== 'sources' && visibleCandidates.length > 0 && (
        <div className="today-item-list">
          {visibleCandidates.map((candidate) => (
            <ProspectCandidateCard key={candidate.id} candidate={candidate} handlers={handlers} />
          ))}
        </div>
      )}

      {!loading && activeTab === 'runs' && (
        <table className="data-table">
          <thead>
            <tr>
              <th>منبع</th>
              <th>وضعیت</th>
              <th>یافت‌شده</th>
              <th>جدید</th>
              <th>واردشده به لیدها</th>
              <th>Duplicate</th>
              <th>خطا</th>
              <th>زمان شروع</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={8} className="profile-empty">
                  اجرایی ثبت نشده است.
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.prospect_sources?.name || 'همه منابع'}</td>
                <td>{runStatusLabel(run.status)}</td>
                <td>{run.candidates_found}</td>
                <td>{run.candidates_created}</td>
                <td>{run.candidates_promoted}</td>
                <td>{run.duplicates_detected}</td>
                <td>{run.errors_count}</td>
                <td>{formatJalaliDateTime(run.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && activeTab === 'sources' && (
        <SourceManagementSection
          sources={sources}
          onToggle={toggleSource}
          onTest={testSourceHealth}
          onRunNow={runSourceNow}
          runningSourceId={runningSourceId}
        />
      )}

      {uploading && (
        <UploadCandidatesModal submitting={running} onSubmit={handleUploadSubmit} onCancel={() => !running && setUploading(false)} />
      )}
    </div>
  )
}
