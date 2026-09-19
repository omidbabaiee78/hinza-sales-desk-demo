import { useState } from 'react'
import { changeLeadStatus } from '../../../services/salesLeads'
import { PIPELINE_STATUSES, leadDisplayName, leadPriorityLabel, leadStatusLabel } from '../../../utils/leadStatus'
import LeadFollowUpBadge from './LeadFollowUpBadge'
import LeadProductsCell from './LeadProductsCell'

function PipelineCard({ lead, onOpenLead, onStatusChanged }) {
  const [busy, setBusy] = useState(false)

  async function handleStatusSelect(e) {
    const newStatus = e.target.value
    if (newStatus === lead.status) return
    setBusy(true)
    try {
      await changeLeadStatus(lead.id, newStatus)
      onStatusChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pipeline-card" onClick={() => onOpenLead(lead.id)}>
      <div className="pipeline-card-name">{leadDisplayName(lead)}</div>
      <div className="pipeline-card-sub">{lead.city || '—'}</div>
      <LeadProductsCell products={lead.products} needNote={lead.need_note} />
      <div className="pipeline-card-row">
        <span className={`pipeline-priority tone-${lead.priority}`}>{leadPriorityLabel(lead.priority)}</span>
        <LeadFollowUpBadge nextFollowUpAt={lead.next_follow_up_at} />
      </div>
      <select
        value={lead.status}
        disabled={busy}
        onClick={(e) => e.stopPropagation()}
        onChange={handleStatusSelect}
      >
        {PIPELINE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {leadStatusLabel(s)}
          </option>
        ))}
      </select>
    </div>
  )
}

export default function LeadPipelineView({ leads, onOpenLead, refresh }) {
  const activeLeads = leads.filter((l) => PIPELINE_STATUSES.includes(l.status))

  return (
    <div className="pipeline-board">
      {PIPELINE_STATUSES.map((status) => {
        const columnLeads = activeLeads.filter((l) => l.status === status)
        return (
          <div key={status} className="pipeline-column">
            <div className="pipeline-column-header">
              <span>{leadStatusLabel(status)}</span>
              <span className="pipeline-column-count">{columnLeads.length}</span>
            </div>
            <div className="pipeline-column-body">
              {columnLeads.length === 0 && <p className="pipeline-column-empty">—</p>}
              {columnLeads.map((lead) => (
                <PipelineCard key={lead.id} lead={lead} onOpenLead={onOpenLead} onStatusChanged={refresh} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
