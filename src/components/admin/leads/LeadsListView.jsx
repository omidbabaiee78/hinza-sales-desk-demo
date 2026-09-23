import { leadDisplayName } from '../../../utils/leadStatus'
import LeadStatusBadge from './LeadStatusBadge'
import LeadFollowUpBadge from './LeadFollowUpBadge'
import LeadQuickContact from './LeadQuickContact'

function LeadRowActions({ lead, onOpenLead, onQuickFollowUp }) {
  return (
    <div className="cell-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn-link" onClick={() => onOpenLead(lead.id)}>
        مشاهده
      </button>
      <LeadQuickContact phone={lead.mobile || lead.phone} compact />
      {lead.status !== 'converted' && lead.status !== 'lost' && (
        <button type="button" className="btn-link" onClick={() => onQuickFollowUp(lead.id)}>
          ثبت نتیجه تماس
        </button>
      )}
    </div>
  )
}

export default function LeadsListView({
  leads,
  loading,
  onOpenLead,
  onQuickFollowUp,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}) {
  const selectable = Boolean(selectedIds && onToggleSelect)
  const allSelected = selectable && leads.length > 0 && leads.every((l) => selectedIds.has(l.id))
  const colCount = selectable ? 6 : 5

  return (
    <>
      <div className="table-wrapper lead-table-wrapper">
        <table>
          <thead>
            <tr>
              {selectable && (
                <th>
                  <input type="checkbox" checked={allSelected} onChange={(e) => onToggleSelectAll(e.target.checked)} />
                </th>
              )}
              <th>شرکت</th>
              <th>تماس</th>
              <th>وضعیت</th>
              <th>پیگیری بعدی</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colCount} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty-row">
                  سرنخی با این فیلتر پیدا نشد.
                </td>
              </tr>
            )}
            {!loading &&
              leads.map((lead) => (
                <tr key={lead.id} className="clickable-row" onClick={() => onOpenLead(lead.id)}>
                  {selectable && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => onToggleSelect(lead.id)}
                      />
                    </td>
                  )}
                  <td>
                    <span className="lead-cell-clamp" title={lead.company_name || ''}>
                      {lead.company_name || '—'}
                    </span>
                    {lead.do_not_contact && <span className="lead-status-badge tone-lost lead-dnc-tag">عدم تماس</span>}
                  </td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {lead.mobile || lead.phone || lead.email || '—'}
                  </td>
                  <td>
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td>
                    <LeadFollowUpBadge nextFollowUpAt={lead.next_follow_up_at} />
                  </td>
                  <td>
                    <LeadRowActions lead={lead} onOpenLead={onOpenLead} onQuickFollowUp={onQuickFollowUp} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="lead-cards">
        {loading && <p className="profile-empty">در حال بارگذاری...</p>}
        {!loading && leads.length === 0 && <p className="profile-empty">سرنخی با این فیلتر پیدا نشد.</p>}
        {!loading &&
          leads.map((lead) => (
            <div key={lead.id} className="lead-card" onClick={() => onOpenLead(lead.id)}>
              <div className="lead-card-top">
                <div>
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleSelect(lead.id)}
                    />
                  )}
                  <div className="lead-card-name">{leadDisplayName(lead)}</div>
                  <div className="lead-card-sub">
                    {[lead.city, lead.industry].filter(Boolean).join(' / ') || '—'}
                  </div>
                </div>
                <LeadStatusBadge status={lead.status} />
              </div>
              <div className="lead-card-row">
                <span className="lead-card-label">پیگیری بعدی</span>
                <LeadFollowUpBadge nextFollowUpAt={lead.next_follow_up_at} />
              </div>
              <div className="lead-card-actions">
                <LeadRowActions lead={lead} onOpenLead={onOpenLead} onQuickFollowUp={onQuickFollowUp} />
              </div>
            </div>
          ))}
      </div>
    </>
  )
}
