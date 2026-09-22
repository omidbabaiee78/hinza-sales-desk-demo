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
    reEvaluatingAll,
    dryRunLoading,
    dryRunResult,
    verifyLoading,
    verifyResult,
    promoteEligibleLoading,
    promoteEligibleResult,
    error,
    actionError,
    actionNotice,
    uploadAndRun,
    promote,
    reject,
    markDuplicate,
    updateFields,
    reEvaluate,
    toggleSource,
    testSourceHealth,
    runSourceNow,
    reEvaluateAllManualReview,
    runDryRunQualification,
    runVerifyQualificationState,
    runPromoteEligibleCandidates,
  } = useProspecting()

  const [activeTab, setActiveTab] = useState('top')
  const [uploading, setUploading] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')
  const [verifyCopyNotice, setVerifyCopyNotice] = useState('')
  const [promoteEligibleCopyNotice, setPromoteEligibleCopyNotice] = useState('')

  // "Controlled Promotion Acceptance" round - this button creates REAL
  // sales_leads rows, unlike every read-only audit button above it. A
  // native confirm() is the one deliberate exception to "never block on a
  // dialog" in this admin UI - exactly the kind of hard-to-reverse,
  // production-write action worth one extra explicit click to avoid.
  function handlePromoteEligibleClick() {
    const eligibleCount = verifyResult?.autoPromotableCount
    const confirmed = window.confirm(
      `این عملیات، تمام نامزدهای واجد شرایط تبدیل خودکار (طبق آخرین بازبینی جامع${
        typeof eligibleCount === 'number' ? `: ${eligibleCount} مورد` : ''
      }) را به‌صورت واقعی وارد بانک لید (Lead Bank) می‌کند. این کار پیام/تماسی ارسال نمی‌کند، اما ایجاد لید یک نوشتار واقعی و برگشت‌ناپذیر در دیتابیس است. ادامه می‌دهید؟`,
    )
    if (!confirmed) return
    setPromoteEligibleCopyNotice('')
    runPromoteEligibleCandidates()
  }

  async function handleCopyPromoteEligible() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(promoteEligibleResult, null, 2))
      setPromoteEligibleCopyNotice('کپی شد.')
    } catch {
      setPromoteEligibleCopyNotice('کپی خودکار ممکن نشد - متن را به‌صورت دستی انتخاب و کپی کنید.')
    }
  }

  async function handleCopyDryRun() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(dryRunResult, null, 2))
      setCopyNotice('کپی شد.')
    } catch {
      setCopyNotice('کپی خودکار ممکن نشد - متن را به‌صورت دستی انتخاب و کپی کنید.')
    }
  }

  async function handleCopyVerify() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(verifyResult, null, 2))
      setVerifyCopyNotice('کپی شد.')
    } catch {
      setVerifyCopyNotice('کپی خودکار ممکن نشد - متن را به‌صورت دستی انتخاب و کپی کنید.')
    }
  }

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
      {actionNotice && <p className="lead-form-hint">{actionNotice}</p>}

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

      {!loading && activeTab === 'manual_review' && (
        <div className="page-toolbar" style={{ marginBottom: 8 }}>
          {/* Phase 23D, item 10: rescore all EXISTING manual_review
              candidates under Smart Qualification 2.0 - safe/idempotent,
              never promotes or deletes anything, see
              reEvaluateManualReviewCandidates() in discoveryPipeline.js. */}
          <button type="button" className="btn-link" disabled={reEvaluatingAll} onClick={reEvaluateAllManualReview}>
            {reEvaluatingAll ? 'در حال ارزیابی مجدد...' : 'ارزیابی مجدد همه موارد نیازمند بررسی (Smart Qualification 2.0)'}
          </button>
          {/* Dry run: calculates what Smart Qualification 2.0 WOULD do to
              every current manual_review candidate WITHOUT writing
              anything to the database (dryRunQualification() in
              discoveryPipeline.js / mode:'dry_run_qualification' in the
              Edge Function). Purely for review - copy the JSON output and
              share it, nothing here changes any candidate's status. */}
          <button
            type="button"
            className="btn-link"
            disabled={dryRunLoading}
            onClick={() => {
              setCopyNotice('')
              runDryRunQualification()
            }}
          >
            {dryRunLoading ? 'در حال محاسبه پیش‌نمایش...' : 'پیش‌نمایش Smart Qualification 2.0 (بدون تغییر در دیتابیس)'}
          </button>
          {/* Phase 23D-FINAL.1: the ONE comprehensive, read-only audit -
              ALWAYS covers manual_review + rejected + qualified
              server-side (never just manual_review), and always reports
              the full real database status distribution too
              (databaseStatusCounts, auditedCount, excludedCount) so its
              scope is self-evident from the result itself, not from which
              button was clicked (runComprehensiveAudit() /
              mode:'comprehensive_audit'). Safe to run before or after the
              re-evaluate button above - never writes anything itself. */}
          <button
            type="button"
            className="btn-link"
            disabled={verifyLoading}
            onClick={() => {
              setVerifyCopyNotice('')
              runVerifyQualificationState()
            }}
          >
            {verifyLoading ? 'در حال اجرای بازبینی جامع...' : 'بازبینی جامع (manual_review + رد شده + واجد شرایط) — بدون نوشتن در دیتابیس'}
          </button>
          {/* "Controlled Promotion Acceptance" round - the ONE real-write
              bulk action on this page: promotes every candidate the
              comprehensive audit currently reports as auto-promotable into
              a real sales_leads row (mode:'promote_eligible_candidates').
              Idempotent (see promoteEligibleCandidates() in
              discoveryPipeline.js) but NOT read-only - guarded by its own
              confirm() dialog, styled distinctly, and deliberately never
              auto-triggered. */}
          <button
            type="button"
            className="btn-link-danger"
            disabled={promoteEligibleLoading}
            onClick={handlePromoteEligibleClick}
          >
            {promoteEligibleLoading
              ? 'در حال تبدیل نامزدهای واجد شرایط به سرنخ...'
              : 'تبدیل گروهی نامزدهای واجد شرایط به سرنخ (نوشتار واقعی در دیتابیس)'}
          </button>
        </div>
      )}

      {!loading && activeTab === 'manual_review' && dryRunResult && (
        <div className="prospect-evidence-box" style={{ marginBottom: 12 }}>
          <p className="lead-form-hint">
            پیش‌نمایش (dry run) - هیچ تغییری در دیتابیس اعمال نشد. مجموع: {dryRunResult.total} | واجد شرایط:{' '}
            {dryRunResult.counts?.qualified ?? 0} | نیازمند بررسی: {dryRunResult.counts?.manual_review ?? 0} | رد شده:{' '}
            {dryRunResult.counts?.rejected ?? 0} | قابل تبدیل خودکار: {dryRunResult.autoPromotableCount ?? 0}
            {dryRunResult.errors ? ` | خطا: ${dryRunResult.errors}` : ''}
          </p>
          {dryRunResult.buyerFitCounts && (
            <p className="lead-form-hint">
              Buyer Fit — بالا: {dryRunResult.buyerFitCounts.high ?? 0} | متوسط: {dryRunResult.buyerFitCounts.medium ?? 0} | کم:{' '}
              {dryRunResult.buyerFitCounts.low ?? 0} | غیرمصرف‌کننده: {dryRunResult.buyerFitCounts.not_buyer ?? 0} | نامشخص:{' '}
              {dryRunResult.buyerFitCounts.unknown ?? 0}
            </p>
          )}
          <button type="button" className="btn-link" onClick={handleCopyDryRun}>
            کپی کردن نتیجه کامل (JSON)
          </button>
          {copyNotice && <span style={{ marginInlineStart: 8 }}>{copyNotice}</span>}
          <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: '0.8em', whiteSpace: 'pre-wrap', marginTop: 8 }}>
            {JSON.stringify(dryRunResult, null, 2)}
          </pre>
        </div>
      )}

      {!loading && activeTab === 'manual_review' && verifyResult && (
        <div className="prospect-evidence-box" style={{ marginBottom: 12 }}>
          <p className="lead-form-hint">
            بازبینی جامع - هیچ تغییری در دیتابیس اعمال نشد. وضعیت واقعی دیتابیس (databaseStatusCounts): واجد شرایط{' '}
            {verifyResult.databaseStatusCounts?.qualified ?? 0} | رد شده {verifyResult.databaseStatusCounts?.rejected ?? 0} | نیازمند بررسی{' '}
            {verifyResult.databaseStatusCounts?.manual_review ?? 0} | تکراری {verifyResult.databaseStatusCounts?.duplicate ?? 0} | تبدیل‌شده{' '}
            {verifyResult.databaseStatusCounts?.promoted ?? 0}
          </p>
          <p className="lead-form-hint">
            بررسی‌شده (auditedCount): {verifyResult.auditedCount ?? 0} = manual_review+رد شده+واجد شرایط | مستثنی‌شده (excludedCount):{' '}
            {verifyResult.excludedCount ?? 0} (تکراری+تبدیل‌شده) | قابل تبدیل خودکار: {verifyResult.autoPromotableCount ?? 0} | تعارض منطقی
            (logicalConflictCount): {verifyResult.logicalConflictCount ?? 0}
            {verifyResult.errors ? ` | خطا: ${verifyResult.errors}` : ''}
          </p>
          <p className="lead-form-hint">
            هویت تایید‌شده (verified): {verifyResult.identityVerifiedCount ?? 0} | هویت محتمل (probable): {verifyResult.identityProbableCount ?? 0} |
            هویت نامشخص (unresolved): {verifyResult.identityUnresolvedCount ?? 0} | تلاش برای بررسی وب‌سایت:{' '}
            {verifyResult.identityVerificationAttempted ?? 0} | نیازمند غنی‌سازی: {verifyResult.enrichmentNeededCount ?? 0} | نجات‌یافته از رد:{' '}
            {verifyResult.rescuedFalseNegatives ?? 0} | تنزل‌یافته از واجد شرایط: {verifyResult.downgradedFalsePositives ?? 0}
          </p>
          {verifyResult.buyerFitCounts && (
            <p className="lead-form-hint">
              Buyer Fit — بالا: {verifyResult.buyerFitCounts.high ?? 0} | متوسط: {verifyResult.buyerFitCounts.medium ?? 0} | کم:{' '}
              {verifyResult.buyerFitCounts.low ?? 0} | غیرمصرف‌کننده: {verifyResult.buyerFitCounts.not_buyer ?? 0} | نامشخص:{' '}
              {verifyResult.buyerFitCounts.unknown ?? 0}
            </p>
          )}
          <button type="button" className="btn-link" onClick={handleCopyVerify}>
            کپی کردن نتیجه کامل (JSON)
          </button>
          {verifyCopyNotice && <span style={{ marginInlineStart: 8 }}>{verifyCopyNotice}</span>}
          <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: '0.8em', whiteSpace: 'pre-wrap', marginTop: 8 }}>
            {JSON.stringify(verifyResult, null, 2)}
          </pre>
        </div>
      )}

      {!loading && activeTab === 'manual_review' && promoteEligibleResult && (
        <div className="prospect-evidence-box" style={{ marginBottom: 12 }}>
          <p className="lead-form-hint">
            تبدیل گروهی — این یک نوشتار واقعی بود. واجد شرایط قبل از اجرا: {promoteEligibleResult.eligibleBefore ?? 0} | تبدیل‌شده به لید:{' '}
            {promoteEligibleResult.promoted ?? 0} | از قبل تبدیل‌شده: {promoteEligibleResult.alreadyPromoted ?? 0} | رد‌شده به‌دلیل تطابق قبلی:{' '}
            {promoteEligibleResult.skippedExistingMatch ?? 0} | دیگر واجد شرایط نبود: {promoteEligibleResult.noLongerEligible ?? 0} | خطا:{' '}
            {promoteEligibleResult.failed ?? 0}
          </p>
          <button type="button" className="btn-link" onClick={handleCopyPromoteEligible}>
            کپی کردن نتیجه کامل (JSON)
          </button>
          {promoteEligibleCopyNotice && <span style={{ marginInlineStart: 8 }}>{promoteEligibleCopyNotice}</span>}
          <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: '0.8em', whiteSpace: 'pre-wrap', marginTop: 8 }}>
            {JSON.stringify(promoteEligibleResult, null, 2)}
          </pre>
        </div>
      )}

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
