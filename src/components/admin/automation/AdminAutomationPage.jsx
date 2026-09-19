import { useMemo, useState } from 'react'
import { useAutomationTasks } from '../../../hooks/useAutomationTasks'
import ErrorBanner from '../../common/ErrorBanner'
import AutomationTaskCard from './AutomationTaskCard'
import AutomationRuleRow from './AutomationRuleRow'
import '../../common/DataTable.css'
import '../today/Today.css'
import './Automation.css'

const TABS = [
  { key: 'ready', label: 'صف کار' },
  { key: 'waiting_approval', label: 'نیازمند تأیید' },
  { key: 'failed', label: 'خطاها' },
  { key: 'history', label: 'تاریخچه' },
  { key: 'rules', label: 'قوانین' },
]

function isCompletedToday(task) {
  if (task.status !== 'completed' || !task.completed_at) return false
  const completed = new Date(task.completed_at)
  const now = new Date()
  return (
    completed.getFullYear() === now.getFullYear() &&
    completed.getMonth() === now.getMonth() &&
    completed.getDate() === now.getDate()
  )
}

export default function AdminAutomationPage({ onOpenLead, onOpenOrder, onOpenInvoice, onNavigate }) {
  const {
    settings,
    rules,
    activeTasks,
    historyTasks,
    companiesById,
    leadsById,
    ordersById,
    invoicesById,
    suggestionsById,
    loading,
    reconciling,
    error,
    actionError,
    lastReconcileSummary,
    reconcile,
    approve,
    cancel,
    snooze,
    retry,
    toggleGlobal,
    updateRuleEnabled,
    updateRuleAutonomyMode,
  } = useAutomationTasks()

  const [activeTab, setActiveTab] = useState('ready')
  const [togglingGlobal, setTogglingGlobal] = useState(false)

  const lookups = { leadsById, companiesById, ordersById, invoicesById, suggestionsById }
  const handlers = {
    onOpenLead,
    onOpenOrder,
    onOpenInvoice,
    onOpenSmartSuggestions: () => onNavigate('crm'),
    onApprove: approve,
    onCancel: cancel,
    onSnooze: snooze,
    onRetry: retry,
  }

  const readyTasks = useMemo(() => activeTasks.filter((t) => t.status === 'ready'), [activeTasks])
  const waitingApprovalTasks = useMemo(() => activeTasks.filter((t) => t.status === 'waiting_approval'), [activeTasks])
  const failedTasks = useMemo(() => activeTasks.filter((t) => t.status === 'failed'), [activeTasks])
  const completedTodayCount = useMemo(() => historyTasks.filter(isCompletedToday).length, [historyTasks])

  async function handleToggleGlobal() {
    setTogglingGlobal(true)
    try {
      await toggleGlobal(!settings.enabled)
    } finally {
      setTogglingGlobal(false)
    }
  }

  return (
    <div className="automation-page">
      <div className="page-toolbar">
        <div>
          <h2>اتوماسیون</h2>
          <p className="today-subtitle">شناسایی خودکار کارهای فروش بر اساس وضعیت واقعی سیستم — اجرای خارجی هنوز فعال نیست.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={reconcile} disabled={reconciling}>
          {reconciling ? 'در حال به‌روزرسانی...' : 'به‌روزرسانی موتور'}
        </button>
      </div>

      <ErrorBanner message={error} onRetry={reconcile} />
      {actionError && <ErrorBanner message={actionError} />}

      {settings && (
        <div className={`automation-global-status ${settings.enabled ? 'is-enabled' : 'is-disabled'}`}>
          <div>
            <strong>{settings.enabled ? 'اتوماسیون فعال است' : 'اتوماسیون متوقف است'}</strong>
            <p className="automation-hint">
              {settings.enabled
                ? 'کارهای جدید بر اساس قوانین فعال شناسایی و در صف قرار می‌گیرند.'
                : 'شناسایی کار جدید متوقف است؛ کارهای موجود همچنان قابل مدیریت‌اند.'}
            </p>
          </div>
          <button type="button" className="btn-secondary" disabled={togglingGlobal} onClick={handleToggleGlobal}>
            {settings.enabled ? 'غیرفعال کردن' : 'فعال کردن'}
          </button>
        </div>
      )}

      <div className="automation-summary-grid">
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{loading ? '—' : readyTasks.length}</span>
          <span className="today-summary-label">آماده اقدام</span>
        </div>
        <div className="today-summary-card tone-offer">
          <span className="today-summary-value">{loading ? '—' : waitingApprovalTasks.length}</span>
          <span className="today-summary-label">نیازمند تأیید</span>
        </div>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{loading ? '—' : failedTasks.length}</span>
          <span className="today-summary-label">خطا</span>
        </div>
        <div className="today-summary-card tone-won">
          <span className="today-summary-value">{loading ? '—' : completedTodayCount}</span>
          <span className="today-summary-label">امروز تکمیل‌شده</span>
        </div>
      </div>

      {lastReconcileSummary && (
        <p className="automation-hint">
          آخرین همگام‌سازی: {lastReconcileSummary.created} کار جدید، {lastReconcileSummary.promoted} آماده‌شده،{' '}
          {lastReconcileSummary.completed} تکمیل‌شده، {lastReconcileSummary.cancelled} لغوشده.
        </p>
      )}

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

      {!loading && activeTab === 'ready' && (
        <TaskList tasks={readyTasks} lookups={lookups} handlers={handlers} emptyMessage="کار آماده اقدامی وجود ندارد." />
      )}
      {!loading && activeTab === 'waiting_approval' && (
        <TaskList
          tasks={waitingApprovalTasks}
          lookups={lookups}
          handlers={handlers}
          emptyMessage="کاری منتظر تأیید نیست."
        />
      )}
      {!loading && activeTab === 'failed' && (
        <TaskList tasks={failedTasks} lookups={lookups} handlers={handlers} emptyMessage="خطایی ثبت نشده است." />
      )}
      {!loading && activeTab === 'history' && (
        <TaskList tasks={historyTasks} lookups={lookups} handlers={handlers} readOnly emptyMessage="تاریخچه‌ای وجود ندارد." />
      )}

      {!loading && activeTab === 'rules' && (
        <section className="today-section">
          <p className="automation-hint">
            تنظیم قوانین شناسایی کار. توجه: حتی در حالت «خودکار»، هیچ پیام یا اقدام مشتری‌محور به‌صورت خودکار ارسال نمی‌شود؛
            اتصال پیام‌رسانی خارجی هنوز فعال نیست.
          </p>
          <table className="data-table automation-rules-table">
            <thead>
              <tr>
                <th>قانون</th>
                <th>اولویت پایه</th>
                <th>حالت</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <AutomationRuleRow
                  key={rule.rule_key}
                  rule={rule}
                  onToggleEnabled={updateRuleEnabled}
                  onChangeMode={updateRuleAutonomyMode}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function TaskList({ tasks, lookups, handlers, readOnly, emptyMessage }) {
  if (tasks.length === 0) {
    return (
      <div className="today-empty-state">
        <p className="today-empty-title">{emptyMessage}</p>
      </div>
    )
  }
  return (
    <div className="today-item-list">
      {tasks.map((task) => (
        <AutomationTaskCard key={task.id} task={task} lookups={lookups} handlers={handlers} readOnly={readOnly} />
      ))}
    </div>
  )
}
