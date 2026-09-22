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
          const isCredentialMissing =
            liveResult?.status === 'credential_required' || (source.last_error || '').startsWith('credential_required')
          const isHealthy = liveResult ? liveResult.ok : !source.last_error
          // Secondary/experimental tag: config.tier is the explicit marker
          // (see discoveryPipeline.js's ensureDefaultSources for OSM), a
          // public_directory source_type with no tier is still treated as
          // secondary - OSM's public Overpass mirrors proved too unreliable
          // (Phase 23B/C) to be a primary production source.
          const isSecondary = source.config?.tier === 'secondary' || source.source_type === 'public_directory'
          return (
            <tr key={source.id}>
              <td>
                {source.name}
                {isSecondary && (
                  <span style={{ marginInlineStart: 6, fontSize: '0.75em', color: 'var(--text-muted, #888)' }}>(ثانویه/آزمایشی)</span>
                )}
              </td>
              <td>{sourceTypeLabel(source.source_type)}</td>
              <td>
                <label className="automation-rule-toggle">
                  <input type="checkbox" checked={source.enabled} onChange={(e) => onToggle(source.id, e.target.checked)} />
                  {source.enabled ? 'فعال' : 'غیرفعال'}
                </label>
              </td>
              <td
                style={{
                  color: isCredentialMissing ? 'var(--status-offer-text, #a66a00)' : isHealthy ? 'var(--status-won-text)' : 'var(--status-lost-text)',
                  fontWeight: 600,
                }}
              >
                {isCredentialMissing ? '⚠ نیاز به کلید API' : isHealthy ? '✓ سالم' : '✗ خطا'}
              </td>
              <td>{source.last_run_at ? formatJalaliDateTime(source.last_run_at) : '—'}</td>
              <td>{liveResult?.message || source.last_error || '—'}</td>
              <td className="cell-actions">
                <button type="button" className="btn-link" disabled={testingId === source.id} onClick={() => handleTest(source.id)}>
                  {testingId === source.id ? 'در حال تست...' : 'تست منبع'}
                </button>
                {/* Phase 23C fix: this must NOT also require source.enabled -
                    clicking "اجرای این منبع" for one specific source is an
                    explicit one-off admin action (same as "تست منبع"), never
                    gated by whether that source participates in a bulk/daily
                    run. Disabling this button on a disabled source silently
                    prevented the request from ever being sent - no run row,
                    no error, nothing (see discoveryPipeline.js's
                    fetchRunnableSources). */}
                <button
                  type="button"
                  className="btn-link"
                  disabled={runningSourceId === source.id}
                  onClick={() => onRunNow(source.id)}
                  title={!source.enabled ? 'این منبع غیرفعال است اما اجرای دستی همچنان انجام می‌شود.' : undefined}
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
