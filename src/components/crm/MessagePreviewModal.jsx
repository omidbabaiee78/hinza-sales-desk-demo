import { useState } from 'react'
import '../common/Modal.css'

// Generic "edit then act" modal shared by WhatsApp and SMS quick actions -
// it never sends anything itself, it only hands the (possibly edited)
// message back to the caller via onConfirm.
export default function MessagePreviewModal({
  title,
  initialMessage,
  primaryLabel,
  showCopy,
  onConfirm,
  onCancel,
  onCopy,
}) {
  const [message, setMessage] = useState(initialMessage)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleConfirm() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      onCopy?.(message)
    } catch {
      // Clipboard API unavailable - the admin can still select and copy manually.
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <label>
          متن پیام
          <textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
            انصراف
          </button>
          {showCopy && (
            <button type="button" className="btn-secondary" onClick={handleCopy}>
              {copied ? 'کپی شد' : 'کپی متن'}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'در حال انجام...' : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
