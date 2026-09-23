import { useState } from 'react'
import { buildEmailBody } from '../../../outreach/sendGate'
import '../../common/Modal.css'

// Read-only confirmation for the controlled first-email action. Shows the
// exact recipient, subject and body the server will send - the body is
// built with the SAME buildEmailBody() sendPipeline.js uses (message +
// opt-out footer), and the caller passes emailSubjectFor(). Nothing here is
// editable, so what the admin confirms is what is sent. Editing stays in
// the existing "ویرایش متن" flow.

export default function FirstEmailConfirmModal({ recipientName, recipientEmail, subject, message, onConfirm, onCancel }) {
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>تأیید ارسال اولین ایمیل</h2>
        <p className="outreach-test-mode-banner">
          این ایمیل برای مشتری واقعی ارسال می‌شود و قابل بازگشت نیست. (اگر حالت آزمایشی سیستم روشن باشد، سرور آن را فقط به نشانی آزمایشی می‌فرستد.)
        </p>
        <div className="info-row">
          <span className="info-label">گیرنده</span>
          <span className="info-value">
            {recipientName} — <span dir="ltr">{recipientEmail}</span>
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">موضوع</span>
          <span className="info-value">{subject}</span>
        </div>
        <div className="outreach-message-preview" style={{ whiteSpace: 'pre-wrap' }}>{buildEmailBody(message)}</div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
            انصراف
          </button>
          <button type="button" className="btn-primary" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'در حال ارسال...' : 'بله، همین ایمیل ارسال شود'}
          </button>
        </div>
      </div>
    </div>
  )
}
