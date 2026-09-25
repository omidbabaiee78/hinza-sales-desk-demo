import { useMemo, useState } from 'react'
import { useProspecting } from '../../../hooks/useProspecting'
import { formatJalaliDateTime } from '../../../utils/formatters'
import { runStatusLabel, runTypeLabel } from '../../../prospecting/prospectingLabels'
import ErrorBanner from '../../common/ErrorBanner'
import ProspectCandidateCard from './ProspectCandidateCard'
import UploadCandidatesModal from './UploadCandidatesModal'
import SourceManagementSection from './SourceManagementSection'
import '../../common/DataTable.css'
import '../today/Today.css'
import '../automation/Automation.css'
import '../outreach/Outreach.css'
import './Prospecting.css'

const PRIMARY_TAB_KEY = 'manual_review'

// Candidate lists shown as plain chips; run history and source settings are
// technical and live under «ابزارهای بیشتر».
const CANDIDATE_TABS = [
  { key: PRIMARY_TAB_KEY, label: 'نیازمند بررسی شما' },
  { key: 'promoted', label: 'ثبت‌شده به‌عنوان سرنخ' },
  { key: 'top', label: 'مناسب، هنوز ثبت نشده' },
  { key: 'duplicate', label: 'تکراری' },
  { key: 'rejected', label: 'رد شده' },
]
const TOOL_TABS = [
  { key: 'runs', label: 'تاریخچهٔ اجراها' },
  { key: 'sources', label: 'منابع جست‌وجو' },
]
const TABS = [...CANDIDATE_TABS, ...TOOL_TABS]
const TAB_KEYS = new Set(TABS.map((t) => t.key))
const REVIEWED_STATUSES = new Set(['qualified', 'manual_review', 'rejected', 'duplicate', 'promoted'])

// Phase 24, STEP 5 - a run's duration/trigger type/dry-run+budget usage are
// all already recorded (prospect_discovery_runs.run_type/started_at/
// finished_at/summary), just not previously surfaced in this table.
function formatRunDuration(run) {
  if (!run.started_at || !run.finished_at) return '—'
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return '<۱ ثانیه'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} دقیقه ${seconds} ثانیه` : `${seconds} ثانیه`
}

function isToday(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function AdminProspectingPage({ initialTab }) {
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

  const [activeTab, setActiveTab] = useState(TAB_KEYS.has(initialTab) ? initialTab : PRIMARY_TAB_KEY)
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
      found: candidates.length,
      newToday: candidates.filter((c) => isToday(c.created_at)).length,
      reviewed: candidates.filter((c) => REVIEWED_STATUSES.has(c.status)).length,
      promoted: buckets.promoted.length,
      duplicates: buckets.duplicate.length,
      needsReview: buckets.manual_review.length,
      rejected: buckets.rejected.length,
    }),
    [candidates, buckets],
  )
  const lastRun = runs[0]

  async function handleUploadSubmit(rows) {
    setUploading(true)
    try {
      await uploadAndRun(rows)
    } finally {
      setUploading(false)
    }
  }

  const visibleCandidates = activeTab === 'runs' || activeTab === 'sources' ? [] : buckets[activeTab] || []
  const activeTabLabel = TABS.find((tab) => tab.key === activeTab)?.label || ''

  return (
    <div className="prospecting-page">
      <div className="page-toolbar">
        <div>
          <h2>کشف مشتری</h2>
          <p className="today-subtitle">سیستم شرکت‌ها را پیدا و بررسی می‌کند و موارد مناسب را به‌عنوان سرنخ ثبت می‌کند. فهرست دستی هم می‌توانید اضافه کنید.</p>
        </div>
      </div>

      <ErrorBanner message={error} />
      {actionError && <ErrorBanner message={actionError} />}
      {actionNotice && <p className="lead-form-hint">{actionNotice}</p>}

      <section className="lead-detail-card admin-upload-card">
        <div>
          <h3>آپلود فهرست دستی</h3>
          <p className="lead-form-hint">فایل اکسل یا CSV شرکت‌ها را آپلود کنید. همان بررسی‌ها و حذف موارد تکراری روی این فهرست هم انجام می‌شود و فقط بعد از بررسی سایت، سرنخ ثبت می‌شود.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setUploading(true)}>
          آپلود فهرست جدید
        </button>
      </section>

      <p className="lead-form-hint admin-status-line">
        آخرین اجرای خودکار:{' '}
        {lastRun
          ? `${formatJalaliDateTime(lastRun.started_at)} · ${runStatusLabel(lastRun.status)} · ${lastRun.candidates_found} شرکت پیدا شد · ${
              lastRun.summary?.dryRun ? 0 : lastRun.candidates_promoted
            } سرنخ ثبت شد`
          : loading
            ? '...'
            : 'هنوز اجرایی ثبت نشده است.'}
      </p>

      <div className="today-summary-grid">
        <button type="button" className="today-summary-card admin-stat tone-contacted" onClick={() => setActiveTab(PRIMARY_TAB_KEY)}>
          <span className="today-summary-value">{loading ? '—' : summary.found}</span>
          <span className="today-summary-label">شرکت پیداشده (کل)</span>
          <span className="admin-stat-hint">{loading ? '' : `${summary.newToday} مورد امروز`}</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-contacted" onClick={() => setActiveTab(PRIMARY_TAB_KEY)}>
          <span className="today-summary-value">{loading ? '—' : summary.reviewed}</span>
          <span className="today-summary-label">بررسی‌شده توسط سیستم</span>
          <span className="admin-stat-hint">شامل همهٔ موارد زیر</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-won" onClick={() => setActiveTab('promoted')}>
          <span className="today-summary-value">{loading ? '—' : summary.promoted}</span>
          <span className="today-summary-label">ثبت‌شده به‌عنوان سرنخ</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-contacted" onClick={() => setActiveTab('duplicate')}>
          <span className="today-summary-value">{loading ? '—' : summary.duplicates}</span>
          <span className="today-summary-label">تکراری</span>
          <span className="admin-stat-hint">دوباره ثبت نشد</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-offer" onClick={() => setActiveTab(PRIMARY_TAB_KEY)}>
          <span className="today-summary-value">{loading ? '—' : summary.needsReview}</span>
          <span className="today-summary-label">نیازمند بررسی شما</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-lost" onClick={() => setActiveTab('rejected')}>
          <span className="today-summary-value">{loading ? '—' : summary.rejected}</span>
          <span className="today-summary-label">رد شده</span>
          <span className="admin-stat-hint">نامناسب (مثلاً فروشنده یا فهرست آگهی)</span>
        </button>
      </div>

      <p className="admin-note">
        این عددها هم‌پوشانی دارند و نباید با هم جمع شوند: «بررسی‌شده» شامل ثبت‌شده، تکراری، نیازمند بررسی و ردشده است. «شرکت پیداشده» نتیجهٔ جست‌وجوست و با تعداد
        سرنخ‌ها یکی نیست؛ فقط موارد «ثبت‌شده به‌عنوان سرنخ» وارد فهرست سرنخ‌ها می‌شوند.
      </p>

      <div className="today-filters">
        <div className="today-filter-group">
          {CANDIDATE_TABS.map((tab) => (
            <button key={tab.key} type="button" className={`today-chip${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)}>
              {tab.label}
              {!loading && buckets[tab.key] ? ` (${buckets[tab.key].length})` : ''}
            </button>
          ))}
        </div>
        {TOOL_TABS.some((t) => t.key === activeTab) && <p className="prospecting-current-view-note">نمای فعلی: {activeTabLabel}</p>}
      </div>

      {!loading && promoteEligibleResult && (
        <div className="prospect-evidence-box prospecting-primary-result">
          <p className="lead-form-hint">
            تبدیل گروهی — این یک نوشتار واقعی بود. واجد شرایط قبل از اجرا: {promoteEligibleResult.eligibleBefore ?? 0} | تبدیل‌شده به لید:{' '}
            {promoteEligibleResult.promoted ?? 0} | از قبل تبدیل‌شده: {promoteEligibleResult.alreadyPromoted ?? 0} | رد‌شده به‌دلیل تطابق قبلی:{' '}
            {promoteEligibleResult.skippedExistingMatch ?? 0} | دیگر واجد شرایط نبود: {promoteEligibleResult.noLongerEligible ?? 0} | خطا:{' '}
            {promoteEligibleResult.failed ?? 0}
          </p>
          <details className="prospecting-json-details">
            <summary>نمایش نتیجه کامل (JSON)</summary>
            <button type="button" className="btn-link" onClick={handleCopyPromoteEligible}>
              کپی کردن نتیجه کامل (JSON)
            </button>
            {promoteEligibleCopyNotice && <span style={{ marginInlineStart: 8 }}>{promoteEligibleCopyNotice}</span>}
            <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: '0.8em', whiteSpace: 'pre-wrap', marginTop: 8 }}>
              {JSON.stringify(promoteEligibleResult, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Secondary / diagnostic tools + the less-used queue views - tucked
          away behind one collapsible panel so they don't compete for
          attention with the primary workflow above. */}
      <details className="prospecting-more-panel admin-more-tools" open={TOOL_TABS.some((t) => t.key === activeTab) || undefined}>
        <summary>ابزارهای بیشتر (تاریخچه، منابع، ابزارهای گروهی و تشخیصی)</summary>

        <div className="prospecting-more-section">
          <p className="prospecting-more-section-title">تاریخچه و منابع</p>
          <div className="today-filter-group">
            {TOOL_TABS.map((tab) => (
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

        {!loading && (
          <div className="prospecting-more-section">
            <p className="prospecting-more-section-title">کارهای گروهی (روی دادهٔ واقعی اثر دارند)</p>
            <div className="prospecting-primary-actions">
              <button type="button" className="btn-secondary" disabled={reEvaluatingAll} onClick={reEvaluateAllManualReview}>
                {reEvaluatingAll ? 'در حال ارزیابی مجدد...' : 'ارزیابی مجدد همه موارد نیازمند بررسی'}
              </button>
              <button type="button" className="btn-secondary prospecting-promote-btn" disabled={promoteEligibleLoading} onClick={handlePromoteEligibleClick}>
                {promoteEligibleLoading ? 'در حال تبدیل نامزدهای واجد شرایط به سرنخ...' : 'تبدیل گروهی نامزدهای واجد شرایط به سرنخ'}
              </button>
            </div>
          </div>
        )}

        <div className="prospecting-more-section">
          <p className="prospecting-more-section-title">ابزارهای تشخیصی (بدون تغییر در داده)</p>
          <div className="today-filter-group">
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
          </div>

          {dryRunResult && (
            <div className="prospect-evidence-box" style={{ marginTop: 8 }}>
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
              <details className="prospecting-json-details">
                <summary>نمایش نتیجه کامل (JSON)</summary>
                <button type="button" className="btn-link" onClick={handleCopyDryRun}>
                  کپی کردن نتیجه کامل (JSON)
                </button>
                {copyNotice && <span style={{ marginInlineStart: 8 }}>{copyNotice}</span>}
                <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: '0.8em', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                  {JSON.stringify(dryRunResult, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {verifyResult && (
            <div className="prospect-evidence-box" style={{ marginTop: 8 }}>
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
              <details className="prospecting-json-details">
                <summary>نمایش نتیجه کامل (JSON)</summary>
                <button type="button" className="btn-link" onClick={handleCopyVerify}>
                  کپی کردن نتیجه کامل (JSON)
                </button>
                {verifyCopyNotice && <span style={{ marginInlineStart: 8 }}>{verifyCopyNotice}</span>}
                <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: '0.8em', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                  {JSON.stringify(verifyResult, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </details>

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
              <th>نوع اجرا</th>
              <th>وضعیت</th>
              <th>یافت‌شده</th>
              <th>جدید</th>
              <th>ثبت‌شده به‌عنوان سرنخ</th>
              <th>تکراری</th>
              <th>خطا</th>
              <th>درخواست خارجی</th>
              <th>مدت</th>
              <th>زمان شروع</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={11} className="profile-empty">
                  اجرایی ثبت نشده است.
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.prospect_sources?.name || 'همه منابع'}</td>
                <td>
                  {runTypeLabel(run.run_type)}
                  {run.summary?.dryRun && <span className="today-priority-dot tone-contacted" style={{ marginInlineStart: 6 }}>Dry-run</span>}
                </td>
                <td>{runStatusLabel(run.status)}</td>
                <td>{run.candidates_found}</td>
                <td>{run.candidates_created}</td>
                <td>{run.summary?.dryRun ? `۰ (پیش‌بینی: ${run.summary?.wouldPromoteCount ?? 0})` : run.candidates_promoted}</td>
                <td>{run.duplicates_detected}</td>
                <td>{run.errors_count}</td>
                <td>
                  {run.summary?.externalRequestsUsed ?? 0}/{run.summary?.externalRequestBudget ?? '—'}
                </td>
                <td>{formatRunDuration(run)}</td>
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
