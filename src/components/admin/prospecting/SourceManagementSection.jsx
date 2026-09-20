import { useState } from 'react'
import { sourceTypeLabel } from '../../../prospecting/prospectingLabels'
import { formatJalaliDateTime } from '../../../utils/formatters'

// "Source configuration" per Phase 23B spec: name/type/enabled/health/last
// run/last error, plus test-source and run-source-now actions. Adding a new
// SOURCE ROW (a brand-new provider with custom config) is intentionally not
// a form here yet - built-in sources (uploaded_dataset, the OSM adapter)
// are auto-registered by ensureDefaultSources(); this section manages what
// already exists.
export default function SourceManagementSection({ sources, onToggle, onTest, onRunNow, runningSourceId }) {
  const [testResults, setTestResults] = useState({})
  const [testingId, setTestingId] = useState(null)

  async function handleTest(sourceId) {
    setTestingId(sourceId)
    const result = await onTest(sourceId)
    setTestResults((r) => ({ ...r, [sourceId]: result }))
    setTestingId(null)
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>نام منبع</th>
          <th>نوع</th>
          <th>فعال</th>
          <th>سلامت</th>
          <th>آخرین اجرا</th>
          <th>آخرین خطا</th>
          <th>عملیات</th>
        </tr>
      </thead>
      <tbody>
        {sources.length === 0 && (
          <tr>
            <td colSpan={7} className="profile-empty">
              منبعی ثبت نشده است.
            </td>
          </tr>
        )}
        {sources.map((source) => {
          const liveResult = testResults[source.id]
          const isHealthy = liveResult ? liveResult.ok : !source.last_error
          return (
            <tr key={source.id}>
              <td>{source.name}</td>
              <td>{sourceTypeLabel(source.source_type)}</td>
              <td>
                <label className="automation-rule-toggle">
                  <input type="checkbox" checked={source.enabled} onChange={(e) => onToggle(source.id, e.target.checked)} />
                  {source.enabled ? 'فعال' : 'غیرفعال'}
                </label>
              </td>
              <td style={{ color: isHealthy ? 'var(--status-won-text)' : 'var(--status-lost-text)', fontWeight: 600 }}>
                {isHealthy ? '✓ سالم' : '✗ خطا'}
              </td>
              <td>{source.last_run_at ? formatJalaliDateTime(source.last_run_at) : '—'}</td>
              <td>{liveResult?.message || source.last_error || '—'}</td>
              <td className="cell-actions">
                <button type="button" className="btn-link" disabled={testingId === source.id} onClick={() => handleTest(source.id)}>
                  {testingId === source.id ? 'در حال تست...' : 'تست منبع'}
                </button>
                <button
                  type="button"
                  className="btn-link"
                  disabled={runningSourceId === source.id || !source.enabled}
                  onClick={() => onRunNow(source.id)}
                >
                  {runningSourceId === source.id ? 'در حال اجرا...' : 'اجرای این منبع'}
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
