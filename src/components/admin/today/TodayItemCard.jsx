import { useState } from 'react'
import { formatJalaliDate, formatRial } from '../../../utils/formatters'
import { followUpIsoFromDate } from '../../../utils/leadFollowUp'
import { updateLead } from '../../../services/salesLeads'
import { PRIORITY_BUCKET_LABELS, TODAY_ACTION_TYPE_LABELS, priorityBucketForTier } from '../../../utils/todayQueue'
import LeadQuickContact from '../leads/LeadQuickContact'

const PRIORITY_TONE = { urgent: 'lost', important: 'offer', normal: 'contacted' }

// Local-calendar-date arithmetic (never UTC-slice, which can shift the day
// near midnight) - only ever used for the "فردا"/"۳ روز" quick snooze,
// which just needs a plain calendar date, same precision the Jalali date
// picker itself works at.
function isoDateNDaysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function PriorityDot({ tier }) {
  const bucket = priorityBucketForTier(tier)
  return (
    <span className={`today-priority-dot tone-${PRIORITY_TONE[bucket]}`} title={PRIORITY_BUCKET_LABELS[bucket]}>
      {PRIORITY_BUCKET_LABELS[bucket]}
    </span>
  )
}

function LeadQuickActions({ item, onOpenLead, onQuickFollowUp, onSnoozed }) {
  const [snoozing, setSnoozing] = useState(false)

  async function snooze(days) {
    setSnoozing(true)
    try {
      await updateLead(item.refId, { fields: { next_follow_up_at: followUpIsoFromDate(isoDateNDaysFromNow(days)) } })
      onSnoozed()
    } finally {
      setSnoozing(false)
    }
  }

  return (
    <div className="today-item-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn-link" onClick={() => onOpenLead(item.refId)}>
        مشاهده
      </button>
      <LeadQuickContact phone={item.phone} compact />
      <button type="button" className="btn-link" onClick={() => onQuickFollowUp(item.refId)}>
        ثبت پیگیری
      </button>
      <button type="button" className="btn-link" disabled={snoozing} onClick={() => snooze(1)}>
        فردا
      </button>
      <button type="button" className="btn-link" disabled={snoozing} onClick={() => snooze(3)}>
        ۳ روز
      </button>
    </div>
  )
}

function OrderQuickActions({ item, onOpenOrder }) {
  return (
    <div className="today-item-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn-link" onClick={() => onOpenOrder(item.refId)}>
        مشاهده سفارش
      </button>
    </div>
  )
}

function InvoiceQuickActions({ item, onOpenInvoice }) {
  return (
    <div className="today-item-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn-link" onClick={() => onOpenInvoice(item.refId)}>
        مشاهده فاکتور
      </button>
    </div>
  )
}

function SuggestionQuickActions({ item, suggestionActions, onOpenSmartSuggestions }) {
  const suggestion = item.suggestion
  return (
    <div className="today-item-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn-link" onClick={() => suggestionActions.call(suggestion)}>
        تماس
      </button>
      <button
        type="button"
        className="btn-link"
        onClick={() => suggestionActions.whatsapp(suggestion, suggestion.message_final || suggestion.message_draft)}
      >
        واتساپ
      </button>
      {/* Same action + same label as the CRM Smart Suggestions panel's own
          "رد پیشنهاد" button - never a fake "done" label, since actually
          contacting the customer (تماس/واتساپ above) is what marks a
          suggestion `acted` in the real system. */}
      <button type="button" className="btn-link btn-link-danger" onClick={() => suggestionActions.dismiss(suggestion)}>
        رد پیشنهاد
      </button>
      <button type="button" className="btn-link" onClick={onOpenSmartSuggestions}>
        مشاهده در پیشنهادهای هوشمند
      </button>
    </div>
  )
}

function ItemQuickActions({ item, handlers }) {
  if (item.refType === 'lead') {
    return (
      <LeadQuickActions
        item={item}
        onOpenLead={handlers.onOpenLead}
        onQuickFollowUp={handlers.onQuickFollowUp}
        onSnoozed={handlers.onRefresh}
      />
    )
  }
  if (item.refType === 'order') return <OrderQuickActions item={item} onOpenOrder={handlers.onOpenOrder} />
  if (item.refType === 'invoice') return <InvoiceQuickActions item={item} onOpenInvoice={handlers.onOpenInvoice} />
  if (item.refType === 'suggestion') {
    return (
      <SuggestionQuickActions
        item={item}
        suggestionActions={handlers.suggestionActions}
        onOpenSmartSuggestions={handlers.onOpenSmartSuggestions}
      />
    )
  }
  return null
}

function ItemRow({ item, handlers }) {
  return (
    <div className="today-item-row">
      <div className="today-item-main">
        <div className="today-item-top">
          <span className="today-item-title">{TODAY_ACTION_TYPE_LABELS[item.type] || item.title}</span>
          <PriorityDot tier={item.tier} />
        </div>
        <div className="today-item-who">{item.company}</div>
        {item.context && <div className="today-item-context">{item.context}</div>}
        <div className="today-item-reason">{item.reason}</div>
        <div className="today-item-meta">
          {item.dueAt && item.refType !== 'lead' && <span>سررسید: {formatJalaliDate(item.dueAt)}</span>}
          {item.amount > 0 && <span>مانده: {formatRial(item.amount)}</span>}
          {item.ageDays > 0 && <span>{item.ageDays} روز</span>}
        </div>
      </div>
      <ItemQuickActions item={item} handlers={handlers} />
    </div>
  )
}

// Renders either one standalone item, or (kind === 'group') one company
// header with every one of its items nested underneath - "پاکسان - ۲ مورد
// نیازمند توجه" instead of two visually repetitive top-level cards. Nothing
// is hidden either way; a group just shows all its items together.
export default function TodayItemCard({ entry, handlers }) {
  if (entry.kind === 'group') {
    return (
      <div className="today-card today-card-group">
        <div className="today-group-header">
          <span className="today-group-company">{entry.company}</span>
          <span className="today-group-count">{entry.items.length} مورد نیازمند توجه</span>
        </div>
        {entry.items.map((item) => (
          <ItemRow key={item.id} item={item} handlers={handlers} />
        ))}
      </div>
    )
  }

  return (
    <div className="today-card">
      <ItemRow item={entry} handlers={handlers} />
    </div>
  )
}
