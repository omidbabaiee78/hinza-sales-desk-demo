import { useState } from 'react'
import { formatJalaliDateTime } from '../../../utils/formatters'
import { autonomyModeLabel, taskStatusLabel, taskTypeLabel } from '../../../automation/taskLabels'
import { resolveTaskWho } from '../../../automation/taskDisplay'

function priorityTone(priority) {
  if (priority <= 20) return 'lost'
  if (priority <= 50) return 'offer'
  return 'contacted'
}

function sourceRefLabel(task) {
  if (task.context?.orderNumber) return `سفارش ${task.context.orderNumber}`
  if (task.context?.invoiceNumber) return `فاکتور ${task.context.invoiceNumber}`
  if (task.context?.messagePreview) return 'پیشنهاد پیام'
  if (task.lead_id) return 'سرنخ'
  return null
}

function isoDateNDaysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00:00+03:30`
}

export default function AutomationTaskCard({ task, lookups, handlers, readOnly }) {
  const [busy, setBusy] = useState(false)

  const who = resolveTaskWho(task, lookups)

  async function run(fn, ...args) {
    setBusy(true)
    try {
      await fn(...args)
    } finally {
      setBusy(false)
    }
  }

  function handleOpen() {
    if (task.lead_id) handlers.onOpenLead(task.lead_id)
    else if (task.order_id) handlers.onOpenOrder(task.order_id)
    else if (task.invoice_id) handlers.onOpenInvoice(task.invoice_id)
    else if (task.message_suggestion_id) handlers.onOpenSmartSuggestions()
  }

  return (
    <div className="automation-card">
      <div className="automation-card-main">
        <div className="automation-card-top">
          <span className="automation-card-type">{taskTypeLabel(task.task_type)}</span>
          <span className={`automation-priority-badge tone-${priorityTone(task.priority)}`}>اولویت {task.priority}</span>
        </div>
        <div className="automation-card-who">{who}</div>
        <div className="automation-card-reason">{task.reason}</div>
        <div className="automation-card-meta">
          <span>حالت: {autonomyModeLabel(task.autonomy_mode)}</span>
          <span>وضعیت: {taskStatusLabel(task.status)}</span>
          {sourceRefLabel(task) && <span>{sourceRefLabel(task)}</span>}
          {task.due_at && <span>سررسید: {formatJalaliDateTime(task.due_at)}</span>}
          {task.status === 'snoozed' && task.available_at && (
            <span>فعال‌سازی: {formatJalaliDateTime(task.available_at)}</span>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="automation-card-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn-link" onClick={handleOpen}>
            مشاهده
          </button>
          {task.status === 'waiting_approval' && (
            <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.onApprove, task.id)}>
              تأیید
            </button>
          )}
          {task.status === 'failed' && (
            <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.onRetry, task.id)}>
              تلاش مجدد
            </button>
          )}
          {(task.status === 'ready' || task.status === 'waiting_approval') && (
            <>
              <button
                type="button"
                className="btn-link"
                disabled={busy}
                onClick={() => run(handlers.onSnooze, task.id, isoDateNDaysFromNow(1))}
              >
                فردا
              </button>
              <button
                type="button"
                className="btn-link"
                disabled={busy}
                onClick={() => run(handlers.onSnooze, task.id, isoDateNDaysFromNow(3))}
              >
                ۳ روز
              </button>
            </>
          )}
          {task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'expired' && (
            <button
              type="button"
              className="btn-link btn-link-danger"
              disabled={busy}
              onClick={() => run(handlers.onCancel, task.id)}
            >
              لغو
            </button>
          )}
        </div>
      )}
    </div>
  )
}
