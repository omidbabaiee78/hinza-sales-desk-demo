import { formatJalaliDate } from '../../../utils/formatters'
import { leadDisplayName, leadPriorityLabel } from '../../../utils/leadStatus'
import LeadStatusBadge from './LeadStatusBadge'
import LeadFollowUpBadge from './LeadFollowUpBadge'
import LeadProductsCell from './LeadProductsCell'
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
          ثبت پیگیری
        </button>
      )}
    </div>
  )
}

export default function LeadsListView({ leads, loading, onOpenLead, onQuickFollowUp }) {
  return (
    <>
      <div className="table-wrapper lead-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>شرکت</th>
              <th>شخص تماس</th>
              <th>شماره تماس</th>
              <th>شهر</th>
              <th>محصولات موردنیاز</th>
              <th>وضعیت</th>
              <th>اولویت</th>
              <th>آخرین تماس</th>
              <th>پیگیری بعدی</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-row">
                  سرنخی با این فیلتر پیدا نشد.
                </td>
              </tr>
            )}
            {!loading &&
              leads.map((lead) => (
                <tr key={lead.id} className="clickable-row" onClick={() => onOpenLead(lead.id)}>
                  <td>{lead.company_name || '—'}</td>
                  <td>{lead.contact_name || '—'}</td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {lead.mobile || lead.phone || '—'}
                  </td>
                  <td>{lead.city || '—'}</td>
                  <td>
                    <LeadProductsCell products={lead.products} needNote={lead.need_note} />
                  </td>
                  <td>
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td>{leadPriorityLabel(lead.priority)}</td>
                  <td>{lead.last_contact_at ? formatJalaliDate(lead.last_contact_at) : '—'}</td>
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
                  <div className="lead-card-name">{leadDisplayName(lead)}</div>
                  <div className="lead-card-sub">{lead.city || '—'}</div>
                </div>
                <LeadStatusBadge status={lead.status} />
              </div>
              <div className="lead-card-row">
                <span className="lead-card-label">محصولات موردنیاز</span>
                <LeadProductsCell products={lead.products} needNote={lead.need_note} />
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
