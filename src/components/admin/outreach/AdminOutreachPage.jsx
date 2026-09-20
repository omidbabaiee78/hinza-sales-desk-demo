import { useMemo, useState } from 'react'
import { useOutreachHub } from '../../../hooks/useOutreachHub'
import { formatJalaliDateTime } from '../../../utils/formatters'
import { attemptStatusLabel, outreachChannelLabel } from '../../../outreach/outreachLabels'
import { taskTypeLabel } from '../../../automation/taskLabels'
import ErrorBanner from '../../common/ErrorBanner'
import OutreachCard from './OutreachCard'
import '../../common/DataTable.css'
import '../today/Today.css'
import '../automation/Automation.css'
import './Outreach.css'

const TABS = [
  { key: 'ready', label: 'آماده اقدام' },
  { key: 'approval', label: 'نیازمند تأیید' },
  { key: 'outside_window', label: 'خارج از زمان تماس' },
  { key: 'blocked', label: 'مسدود' },
  { key: 'history', label: 'تاریخچه' },
]

export default function AdminOutreachPage({ onOpenLead }) {
  const {
    opportunities,
    historyAttempts,
    loading,
    reconciling,
    error,
    actionError,
    refresh,
    approve,
    snooze,
    dismiss,
    recordAttempt,
    recordCompletedAttempt,
    markDoNotContact,
  } = useOutreachHub()

  const [activeTab, setActiveTab] = useState('ready')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const handlers = { approve, snooze, dismiss, recordAttempt, recordCompletedAttempt, markDoNotContact, refresh }

  const buckets = useMemo(() => {
    const ready = []
    const approvalNeeded = []
    const outsideWindow = []
    const blocked = []

    for (const o of opportunities) {
      if (o.outreachStatus === 'blocked' || o.outreachStatus === 'manual_review') {
        blocked.push(o)
        continue
      }
      if (o.taskStatus === 'waiting_approval') {
        approvalNeeded.push(o)
        continue
      }
      if (!o.withinContactWindow) {
        outsideWindow.push(o)
        continue
      }
      ready.push(o)
    }

    return { ready, approvalNeeded, outsideWindow, blocked }
  }, [opportunities])

  const overdueCount = useMemo(
    () => opportunities.filter((o) => o.purpose === 'lead_followup_overdue').length,
    [opportunities],
  )

  function openOverdue() {
    setActiveTab('ready')
    setOverdueOnly(true)
  }

  const visibleReady = overdueOnly ? buckets.ready.filter((o) => o.purpose === 'lead_followup_overdue') : buckets.ready

  const listByTab = {
    ready: visibleReady,
    approval: buckets.approvalNeeded,
    outside_window: buckets.outsideWindow,
    blocked: buckets.blocked,
  }

  return (
    <div className="outreach-page">
      <div className="page-toolbar">
        <div>
          <h2>پیگیری فروش</h2>
          <p className="today-subtitle">الان باید با چه کسی تماس بگیرم؟ — پیشنهاد تماس، آماده‌سازی پیام و ثبت نتیجه، بدون ارسال خودکار.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => refresh({ withReconcile: true })} disabled={reconciling}>
          {reconciling ? 'در حال به‌روزرسانی...' : 'به‌روزرسانی'}
        </button>
      </div>

      <ErrorBanner message={error} onRetry={() => refresh({ withReconcile: true })} />
      {actionError && <ErrorBanner message={actionError} />}

      <div className="today-summary-grid">
        <button type="button" className="today-summary-card tone-contacted" onClick={() => { setActiveTab('ready'); setOverdueOnly(false) }}>
          <span className="today-summary-value">{loading ? '—' : buckets.ready.length}</span>
          <span className="today-summary-label">آماده اقدام</span>
        </button>
        <button type="button" className="today-summary-card tone-offer" onClick={() => setActiveTab('approval')}>
          <span className="today-summary-value">{loading ? '—' : buckets.approvalNeeded.length}</span>
          <span className="today-summary-label">نیازمند تأیید</span>
        </button>
        <button type="button" className="today-summary-card tone-contacted" onClick={() => setActiveTab('outside_window')}>
          <span className="today-summary-value">{loading ? '—' : buckets.outsideWindow.length}</span>
          <span className="today-summary-label">خارج از زمان تماس</span>
        </button>
        <button type="button" className="today-summary-card tone-lost" onClick={() => setActiveTab('blocked')}>
          <span className="today-summary-value">{loading ? '—' : buckets.blocked.length}</span>
          <span className="today-summary-label">مسدود</span>
        </button>
        <button type="button" className="today-summary-card tone-lost" onClick={openOverdue}>
          <span className="today-summary-value">{loading ? '—' : overdueCount}</span>
          <span className="today-summary-label">پیگیری عقب‌افتاده</span>
        </button>
      </div>

      <div className="today-filters">
        <div className="today-filter-group">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`today-chip${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => {
                setActiveTab(tab.key)
                if (tab.key !== 'ready') setOverdueOnly(false)
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="profile-empty">در حال بارگذاری...</p>}

      {!loading && activeTab !== 'history' && listByTab[activeTab].length === 0 && (
        <div className="today-empty-state">
          <p className="today-empty-title">موردی در این بخش وجود ندارد.</p>
        </div>
      )}

      {!loading && activeTab !== 'history' && listByTab[activeTab].length > 0 && (
        <div className="today-item-list">
          {listByTab[activeTab].map((opportunity) => (
            <OutreachCard key={opportunity.taskId} opportunity={opportunity} onOpenLead={onOpenLead} handlers={handlers} />
          ))}
        </div>
      )}

      {!loading && activeTab === 'history' && (
        <table className="data-table">
          <thead>
            <tr>
              <th>سرنخ</th>
              <th>هدف</th>
              <th>کانال</th>
              <th>وضعیت</th>
              <th>زمان</th>
            </tr>
          </thead>
          <tbody>
            {historyAttempts.length === 0 && (
              <tr>
                <td colSpan={5} className="profile-empty">
                  تاریخچه‌ای ثبت نشده است.
                </td>
              </tr>
            )}
            {historyAttempts.map((row) => (
              <tr key={row.id}>
                <td>{row.sales_leads?.company_name || row.sales_leads?.contact_name || '—'}</td>
                <td>{taskTypeLabel(row.purpose)}</td>
                <td>{outreachChannelLabel(row.channel)}</td>
                <td>{attemptStatusLabel(row.status)}</td>
                <td>{formatJalaliDateTime(row.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
