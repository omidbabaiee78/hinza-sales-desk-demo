const ACTIONS = [
  { key: 'tag', label: 'افزودن تگ' },
  { key: 'priority', label: 'تغییر اولویت' },
  { key: 'status', label: 'تغییر وضعیت' },
  { key: 'followUp', label: 'تعیین پیگیری' },
  { key: 'channel', label: 'تغییر کانال ترجیحی' },
  { key: 'doNotContact', label: 'عدم تماس' },
]

// No bulk delete, no bulk messaging here by design (phase-15B scope).
export default function LeadBulkActionsBar({ selectedCount, onAction, onClearSelection }) {
  if (selectedCount === 0) return null
  return (
    <div className="lead-bulk-bar">
      <span className="lead-bulk-count">{selectedCount} سرنخ انتخاب شده</span>
      <div className="lead-bulk-actions">
        {ACTIONS.map((a) => (
          <button key={a.key} type="button" className="btn-secondary" onClick={() => onAction(a.key)}>
            {a.label}
          </button>
        ))}
      </div>
      <button type="button" className="btn-link" onClick={onClearSelection}>
        لغو انتخاب
      </button>
    </div>
  )
}
