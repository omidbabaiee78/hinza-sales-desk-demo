import { useMemo, useState } from 'react'
import { useSalesLeads } from '../../../hooks/useSalesLeads'
import { useCompanyDirectory } from '../../../hooks/useCompanyDirectory'
import { useAdminProfiles } from '../../../hooks/useAdminProfiles'
import { followUpState } from '../../../utils/leadFollowUp'
import { gregorianIsoToJalaali, todayJalaali } from '../../../utils/jalali'
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  leadPriorityLabel,
  leadSourceLabel,
  leadStatusLabel,
} from '../../../utils/leadStatus'
import { LEAD_SMART_SEGMENTS, computeDuplicateRiskLeadIds, smartSortCompare } from '../../../utils/leadIntelligence'
import ErrorBanner from '../../common/ErrorBanner'
import LeadsListView from './LeadsListView'
import LeadPipelineView from './LeadPipelineView'
import LeadFormModal from './LeadFormModal'
import LeadActivityFormModal from './LeadActivityFormModal'
import LeadImportModal from './LeadImportModal'
import LeadBulkActionsBar from './LeadBulkActionsBar'
import LeadBulkActionsModal from './LeadBulkActionsModal'
import '../../common/DataTable.css'
import './Leads.css'

const FOLLOW_UP_FILTERS = [
  { value: '', label: 'همه' },
  { value: 'overdue', label: 'عقب‌افتاده' },
  { value: 'today', label: 'امروز' },
  { value: 'upcoming', label: 'آینده' },
  { value: 'none', label: 'بدون پیگیری' },
]

function convertedThisMonth(lead) {
  if (lead.status !== 'converted' || !lead.converted_at) return false
  const today = todayJalaali()
  const converted = gregorianIsoToJalaali(lead.converted_at.slice(0, 10))
  return converted && converted.jy === today.jy && converted.jm === today.jm
}

export default function AdminLeadsPage({ onOpenLead }) {
  const { leads, loading, error, refresh } = useSalesLeads()
  const { companies } = useCompanyDirectory()
  const { admins } = useAdminProfiles()

  const [view, setView] = useState('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [followUpFilter, setFollowUpFilter] = useState('')
  const [segmentFilter, setSegmentFilter] = useState('')
  const [sortMode, setSortMode] = useState('smart')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [quickFollowUpLeadId, setQuickFollowUpLeadId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkAction, setBulkAction] = useState(null)

  const cities = useMemo(() => [...new Set(leads.map((l) => l.city).filter(Boolean))].sort(), [leads])
  const industries = useMemo(() => [...new Set(leads.map((l) => l.industry).filter(Boolean))].sort(), [leads])
  const duplicateRiskIds = useMemo(() => computeDuplicateRiskLeadIds(leads), [leads])

  const summary = useMemo(() => {
    const active = leads.filter((l) => l.status !== 'converted' && l.status !== 'lost')
    return {
      active: active.length,
      overdue: active.filter((l) => followUpState(l.next_follow_up_at) === 'overdue').length,
      today: active.filter((l) => followUpState(l.next_follow_up_at) === 'today').length,
      negotiating: leads.filter((l) => l.status === 'negotiating').length,
      convertedThisMonth: leads.filter(convertedThisMonth).length,
    }
  }, [leads])

  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase()
    const segment = LEAD_SMART_SEGMENTS.find((s) => s.key === segmentFilter)
    const filtered = leads.filter((lead) => {
      if (statusFilter && lead.status !== statusFilter) return false
      if (cityFilter && lead.city !== cityFilter) return false
      if (industryFilter && lead.industry !== industryFilter) return false
      if (sourceFilter && lead.source !== sourceFilter) return false
      if (priorityFilter && lead.priority !== priorityFilter) return false
      if (assignedFilter && lead.assigned_to !== assignedFilter) return false
      if (followUpFilter && followUpState(lead.next_follow_up_at) !== followUpFilter) return false
      if (segment && !segment.test(lead, { duplicateRiskIds })) return false
      if (query) {
        const text = [lead.company_name, lead.contact_name, lead.mobile, lead.phone, lead.email, lead.website, lead.city, lead.industry, ...(lead.tags || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        const matchesText = text.includes(query)
        const matchesProduct = (lead.products || []).some((p) =>
          `${p.code} ${p.name_fa}`.toLowerCase().includes(query),
        )
        if (!matchesText && !matchesProduct) return false
      }
      return true
    })
    if (sortMode === 'smart') {
      return [...filtered].sort(smartSortCompare)
    }
    return filtered
  }, [
    leads,
    search,
    statusFilter,
    cityFilter,
    industryFilter,
    sourceFilter,
    priorityFilter,
    assignedFilter,
    followUpFilter,
    segmentFilter,
    sortMode,
    duplicateRiskIds,
  ])

  function toggleSelect(leadId) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }

  function toggleSelectAll(checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) filteredLeads.forEach((l) => next.add(l.id))
      else filteredLeads.forEach((l) => next.delete(l.id))
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function handleBulkActionDone() {
    setBulkAction(null)
    clearSelection()
    refresh()
  }

  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h2>سرنخ‌های فروش</h2>
          <p className="lead-page-subtitle">بانک مشتریان بالقوه Hinza Polymer</p>
        </div>
        <div className="crm-view-tabs">
          <button type="button" className={`crm-view-tab${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>
            لیست
          </button>
          <button
            type="button"
            className={`crm-view-tab${view === 'pipeline' ? ' active' : ''}`}
            onClick={() => setView('pipeline')}
          >
            قیف فروش
          </button>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowCreateModal(true)}>
          + افزودن سرنخ
        </button>
        <button type="button" className="btn-primary" onClick={() => setShowImportModal(true)}>
          افزودن گروهی از Excel
        </button>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      <div className="lead-chips">
        <div className="lead-chip">
          <span className="lead-chip-count">{loading ? '—' : summary.active}</span>
          <span className="lead-chip-label">کل سرنخ‌های فعال</span>
        </div>
        <div className="lead-chip">
          <span className="lead-chip-count">{loading ? '—' : summary.overdue}</span>
          <span className="lead-chip-label">پیگیری عقب‌افتاده</span>
        </div>
        <div className="lead-chip">
          <span className="lead-chip-count">{loading ? '—' : summary.today}</span>
          <span className="lead-chip-label">پیگیری امروز</span>
        </div>
        <div className="lead-chip">
          <span className="lead-chip-count">{loading ? '—' : summary.negotiating}</span>
          <span className="lead-chip-label">در مذاکره</span>
        </div>
        <div className="lead-chip">
          <span className="lead-chip-count">{loading ? '—' : summary.convertedThisMonth}</span>
          <span className="lead-chip-label">تبدیل‌شده این ماه</span>
        </div>
      </div>

      {view === 'list' && (
        <>
          <div className="lead-smart-segments">
            {LEAD_SMART_SEGMENTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`lead-segment-chip${segmentFilter === s.key ? ' active' : ''}`}
                onClick={() => setSegmentFilter((prev) => (prev === s.key ? '' : s.key))}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="orders-filters">
            <input
              type="text"
              className="search-input"
              placeholder="جستجو بر اساس شرکت، شخص تماس، موبایل، تلفن، ایمیل، وب‌سایت، شهر، صنعت، تگ یا محصول..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">همه وضعیت‌ها</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {leadStatusLabel(s)}
                </option>
              ))}
            </select>
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
              <option value="">همه شهرها</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
            <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
              <option value="">همه صنایع</option>
              {industries.map((industry) => (
                <option key={industry} value={industry}>
                  {industry}
                </option>
              ))}
            </select>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">همه منابع</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {leadSourceLabel(s)}
                </option>
              ))}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="">همه اولویت‌ها</option>
              {LEAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {leadPriorityLabel(p)}
                </option>
              ))}
            </select>
            <select value={followUpFilter} onChange={(e) => setFollowUpFilter(e.target.value)}>
              {FOLLOW_UP_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  پیگیری: {f.label}
                </option>
              ))}
            </select>
            {admins.length > 0 && (
              <select value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value)}>
                <option value="">همه فروشنده‌ها</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name || 'بدون نام'}
                  </option>
                ))}
              </select>
            )}
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="smart">مرتب‌سازی: هوشمند</option>
              <option value="default">مرتب‌سازی: جدیدترین</option>
            </select>
          </div>

          <LeadBulkActionsBar
            selectedCount={selectedIds.size}
            onAction={setBulkAction}
            onClearSelection={clearSelection}
          />

          <LeadsListView
            leads={filteredLeads}
            loading={loading}
            onOpenLead={onOpenLead}
            onQuickFollowUp={setQuickFollowUpLeadId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
          />
        </>
      )}

      {view === 'pipeline' && <LeadPipelineView leads={leads} onOpenLead={onOpenLead} refresh={refresh} />}

      {showCreateModal && (
        <LeadFormModal
          leads={leads}
          companies={companies}
          admins={admins}
          onSaved={() => {
            setShowCreateModal(false)
            refresh()
          }}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      {showImportModal && (
        <LeadImportModal
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            setShowImportModal(false)
            refresh()
          }}
        />
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

      {bulkAction && (
        <LeadBulkActionsModal
          action={bulkAction}
          leadIds={[...selectedIds]}
          onDone={handleBulkActionDone}
          onCancel={() => setBulkAction(null)}
        />
      )}
    </div>
  )
}
