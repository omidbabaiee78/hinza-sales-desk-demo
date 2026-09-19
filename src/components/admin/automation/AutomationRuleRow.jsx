import { useState } from 'react'
import { taskTypeLabel } from '../../../automation/taskLabels'

const MODE_OPTIONS = [
  { value: 'observe', label: 'مشاهده' },
  { value: 'approval', label: 'با تأیید' },
  { value: 'auto', label: 'خودکار' },
]

export default function AutomationRuleRow({ rule, onToggleEnabled, onChangeMode }) {
  const [busy, setBusy] = useState(false)

  async function handleToggle() {
    setBusy(true)
    try {
      await onToggleEnabled(rule.rule_key, !rule.enabled)
    } finally {
      setBusy(false)
    }
  }

  async function handleModeChange(e) {
    setBusy(true)
    try {
      await onChangeMode(rule.rule_key, e.target.value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className={rule.enabled ? '' : 'automation-rule-disabled'}>
      <td>{taskTypeLabel(rule.rule_key)}</td>
      <td>{rule.priority ?? '—'}</td>
      <td>
        <select value={rule.autonomy_mode} disabled={busy || !rule.enabled} onChange={handleModeChange}>
          {MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <label className="automation-rule-toggle">
          <input type="checkbox" checked={rule.enabled} disabled={busy} onChange={handleToggle} />
          <span>{rule.enabled ? 'فعال' : 'غیرفعال'}</span>
        </label>
      </td>
    </tr>
  )
}
