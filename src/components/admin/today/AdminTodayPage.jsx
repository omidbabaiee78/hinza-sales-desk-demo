import { useMemo, useState } from 'react'
import { useTodayQueue } from '../../../hooks/useTodayQueue'
import { PRIORITY_BUCKET_LABELS, TODAY_ACTION_TYPES, priorityBucketForTier } from '../../../utils/todayQueue'
import ErrorBanner from '../../common/ErrorBanner'
import LeadActivityFormModal from '../leads/LeadActivityFormModal'
import TodayItemCard from './TodayItemCard'
import './Today.css'

const TEHRAN_TODAY_FORMATTER = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const TYPE_FILTERS = [
  { key: 'all', label: 'همه' },
  {
    key: 'lead',
    label: 'سرنخ',
    types: [TODAY_ACTION_TYPES.LEAD_FOLLOWUP_OVERDUE, TODAY_ACTION_TYPES.LEAD_FOLLOWUP_TODAY, TODAY_ACTION_TYPES.LEAD_FIRST_CONTACT],
  },
  {
    key: 'order',
    label: 'سفارش',
    types: [TODAY_ACTION_TYPES.ORDER_ADMIN_ACTION, TODAY_ACTION_TYPES.QUOTE_WAITING_CUSTOMER, TODAY_ACTION_TYPES.READY_FOR_DELIVERY],
  },
  { key: 'financial', label: 'مالی', types: [TODAY_ACTION_TYPES.INVOICE_OVERDUE, TODAY_ACTION_TYPES.INVOICE_DUE_SOON] },
  { key: 'message', label: 'پیام هوشمند', types: [TODAY_ACTION_TYPES.SMART_MESSAGE_SUGGESTION] },
]

const PRIORITY_FILTERS = [
  { key: 'all', label: 'همه' },
  { key: 'urgent', label: PRIORITY_BUCKET_LABELS.urgent },
  { key: 'important', label: PRIORITY_BUCKET_LABELS.important },
  { key: 'normal', label: PRIORITY_BUCKET_LABELS.normal },
]

function entryTypes(entry) {
  return entry.kind === 'group' ? entry.items.map((i) => i.type) : [entry.type]
}

function entryTier(entry) {
  return entry.kind === 'group' ? Math.min(...entry.items.map((i) => i.tier)) : entry.tier
}

export default function AdminTodayPage({ onOpenLead, onOpenOrder, onOpenInvoice, onOpenCustomer, onNavigate }) {
  const { queue, firstContactItems, loading, error, refresh, smartSuggestions } = useTodayQueue()
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [quickFollowUpLeadId, setQuickFollowUpLeadId] = useState(null)

  const flatItems = useMemo(() => queue.flatMap((entry) => (entry.kind === 'group' ? entry.items : [entry])), [queue])

  const counts = useMemo(
    () => ({
      overdue: flatItems.filter((i) => i.type === TODAY_ACTION_TYPES.LEAD_FOLLOWUP_OVERDUE).length,
      today: flatItems.filter((i) => i.type === TODAY_ACTION_TYPES.LEAD_FOLLOWUP_TODAY).length,
      orders: flatItems.filter((i) =>
        [TODAY_ACTION_TYPES.ORDER_ADMIN_ACTION, TODAY_ACTION_TYPES.READY_FOR_DELIVERY].includes(i.type),
      ).length,
      financial: flatItems.filter((i) =>
        [TODAY_ACTION_TYPES.INVOICE_OVERDUE, TODAY_ACTION_TYPES.INVOICE_DUE_SOON].includes(i.type),
      ).length,
      suggestions: flatItems.filter((i) => i.type === TODAY_ACTION_TYPES.SMART_MESSAGE_SUGGESTION).length,
    }),
    [flatItems],
  )

  const filteredQueue = useMemo(() => {
    const typeDef = TYPE_FILTERS.find((f) => f.key === typeFilter)
    return queue.filter((entry) => {
      if (typeDef?.types && !entryTypes(entry).some((t) => typeDef.types.includes(t))) return false
      if (priorityFilter !== 'all' && priorityBucketForTier(entryTier(entry)) !== priorityFilter) return false
      return true
    })
  }, [queue, typeFilter, priorityFilter])

  const handlers = {
    onOpenLead,
    onOpenOrder,
    onOpenInvoice,
    onOpenCustomer,
    onQuickFollowUp: setQuickFollowUpLeadId,
    onRefresh: refresh,
    onOpenSmartSuggestions: () => onNavigate('crm'),
    suggestionActions: smartSuggestions,
  }

  const groupedSections = [
    {
      key: 'leads',
      title: 'سرنخ‌ها',
      items: flatItems.filter((i) =>
        [TODAY_ACTION_TYPES.LEAD_FOLLOWUP_OVERDUE, TODAY_ACTION_TYPES.LEAD_FOLLOWUP_TODAY].includes(i.type),
      ),
    },
    {
      key: 'orders',
      title: 'سفارش‌ها',
      items: flatItems.filter((i) =>
        [TODAY_ACTION_TYPES.ORDER_ADMIN_ACTION, TODAY_ACTION_TYPES.QUOTE_WAITING_CUSTOMER, TODAY_ACTION_TYPES.READY_FOR_DELIVERY].includes(
          i.type,
        ),
      ),
    },
    {
      key: 'financial',
      title: 'مالی',
      items: flatItems.filter((i) => [TODAY_ACTION_TYPES.INVOICE_OVERDUE, TODAY_ACTION_TYPES.INVOICE_DUE_SOON].includes(i.type)),
    },
    {
      key: 'messages',
      title: 'پیشنهادهای هوشمند',
      items: flatItems.filter((i) => i.type === TODAY_ACTION_TYPES.SMART_MESSAGE_SUGGESTION),
    },
  ]

  const isEmpty = !loading && filteredQueue.length === 0
  const showFirstContact = !loading && (flatItems.length === 0 || flatItems.length < 5) && firstContactItems.length > 0

  return (
    <div className="today-page">
      <div className="page-toolbar">
        <div>
          <h2>امروز</h2>
          <p className="today-subtitle">
            کارهای مهم فروش و پیگیری در یک نگاه — {TEHRAN_TODAY_FORMATTER.format(new Date())}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      <div className="today-summary-grid">
        <button type="button" className="today-summary-card tone-lost" onClick={() => setTypeFilter('lead')}>
          <span className="today-summary-value">{loading ? '—' : counts.overdue}</span>
          <span className="today-summary-label">پیگیری عقب‌افتاده</span>
        </button>
        <button type="button" className="today-summary-card tone-offer" onClick={() => setTypeFilter('lead')}>
          <span className="today-summary-value">{loading ? '—' : counts.today}</span>
          <span className="today-summary-label">پیگیری امروز</span>
        </button>
        <button type="button" className="today-summary-card tone-contacted" onClick={() => setTypeFilter('order')}>
          <span className="today-summary-value">{loading ? '—' : counts.orders}</span>
          <span className="today-summary-label">سفارش نیازمند اقدام</span>
        </button>
        <button type="button" className="today-summary-card tone-lost" onClick={() => setTypeFilter('financial')}>
          <span className="today-summary-value">{loading ? '—' : counts.financial}</span>
          <span className="today-summary-label">مطالبات</span>
        </button>
        <button type="button" className="today-summary-card tone-won" onClick={() => setTypeFilter('message')}>
          <span className="today-summary-value">{loading ? '—' : counts.suggestions}</span>
          <span className="today-summary-label">پیشنهاد هوشمند</span>
        </button>
      </div>

      <div className="today-filters">
        <div className="today-filter-group">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`today-chip${typeFilter === f.key ? ' active' : ''}`}
              onClick={() => setTypeFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="today-filter-group">
          {PRIORITY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`today-chip${priorityFilter === f.key ? ' active' : ''}`}
              onClick={() => setPriorityFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <section className="today-section">
        <h3>کارهای پیشنهادی امروز</h3>

        {loading && <p className="profile-empty">در حال بررسی کارهای امروز...</p>}

        {isEmpty && (
          <div className="today-empty-state">
            <p className="today-empty-title">کار فوری ثبت‌شده‌ای برای امروز ندارید.</p>
            {flatItems.length === 0 && <p className="lead-form-hint">همه چیز تحت کنترل است.</p>}
          </div>
        )}

        {!loading && filteredQueue.length > 0 && (
          <div className="today-item-list">
            {filteredQueue.map((entry) => (
              <TodayItemCard key={entry.kind === 'group' ? `group-${entry.companyId}` : entry.id} entry={entry} handlers={handlers} />
            ))}
          </div>
        )}
      </section>

      {showFirstContact && (
        <section className="today-section">
          <h3>مشتریان بالقوه پیشنهادی برای تماس</h3>
          <p className="lead-form-hint">پیشنهاد برای توسعه فروش — بر اساس آمادگی پیگیری سرنخ‌های جدید</p>
          <div className="today-item-list">
            {firstContactItems.map((item) => (
              <TodayItemCard key={item.id} entry={{ kind: 'item', ...item }} handlers={handlers} />
            ))}
          </div>
        </section>
      )}

      {!loading &&
        groupedSections.map(
          (section) =>
            section.items.length > 0 && (
              <section key={section.key} className="today-section today-section-compact">
                <h3>
                  {section.title} <span className="today-section-count">({section.items.length})</span>
                </h3>
                <div className="today-item-list">
                  {section.items.map((item) => (
                    <TodayItemCard key={item.id} entry={{ kind: 'item', ...item }} handlers={handlers} />
                  ))}
                </div>
              </section>
            ),
        )}

      {quickFollowUpLeadId && (
        <LeadActivityFormModal
          leadId={quickFollowUpLeadId}
          activityType="followup"
          onSaved={() => {
            setQuickFollowUpLeadId(null)
            refresh()
          }}
          onCancel={() => setQuickFollowUpLeadId(null)}
        />
      )}
    </div>
  )
}
