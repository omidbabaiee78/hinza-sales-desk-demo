import { useState } from 'react'
import { SNOOZE_OPTIONS, snoozeCompanyAttention } from '../../services/crmSnoozes'
import './Crm.css'

// A snoozed item never disappears permanently - it just stops being shown as
// active until snooze_until passes, at which point the next CRM list load
// picks it back up automatically.
export default function CrmSnoozeButton({ companyId, reasonKey, orderId, invoiceId, onDone }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handlePick(days) {
    setBusy(true)
    setError('')
    try {
      await snoozeCompanyAttention({ companyId, reasonKey, orderId, invoiceId, days })
      setOpen(false)
      onDone?.()
    } catch {
      setError('ثبت یادآوری با خطا مواجه شد.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="crm-snooze">
      <button type="button" className="btn-link" onClick={() => setOpen((v) => !v)}>
        یادآوری بعداً
      </button>
      {open && (
        <div className="crm-snooze-menu">
          {SNOOZE_OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              onClick={() => handlePick(option.days)}
              disabled={busy}
            >
              {option.label}
            </button>
          ))}
          {error && <div className="crm-snooze-error">{error}</div>}
        </div>
      )}
    </div>
  )
}
