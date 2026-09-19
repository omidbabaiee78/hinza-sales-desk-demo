import { useState } from 'react'
import { REASON_LABELS, CONFIDENCE_LABELS, CONFIDENCE_TONE } from '../../constants/smartSuggestionLabels'
import { formatJalaliDateTime } from '../../utils/formatters'
import MessagePreviewModal from './MessagePreviewModal'
import CrmSnoozeButton from './CrmSnoozeButton'
import './Crm.css'

function priorityLabel(priority) {
  if (priority <= 15) return { text: 'فوری', tone: 'danger' }
  if (priority <= 30) return { text: 'بالا', tone: 'warning' }
  if (priority <= 50) return { text: 'متوسط', tone: 'neutral' }
  return { text: 'پایین', tone: 'neutral' }
}

export default function SmartSuggestionCard({
  suggestion,
  companyName,
  contactName,
  onApprove,
  onEdit,
  onWhatsapp,
  onCall,
  onDismiss,
  onSnoozed,
  onOpenCustomer,
}) {
  const [activeModal, setActiveModal] = useState(null) // 'edit' | 'whatsapp' | null
  const context = suggestion.context || {}
  const priority = priorityLabel(suggestion.priority)
  const confidence = suggestion.confidence
  const currentText = suggestion.message_final || suggestion.message_draft

  const productLine = context.productSummary ? `محصول: ${context.productSummary}` : null
  const orderLine = context.orderNumber ? `سفارش ${context.orderNumber}` : null
  const invoiceLine = context.invoiceNumber ? `فاکتور ${context.invoiceNumber}` : null

  return (
    <div className="suggestion-card">
      <div className="suggestion-card-header">
        <div>
          {onOpenCustomer ? (
            <button
              type="button"
              className="suggestion-company suggestion-company-link"
              onClick={() => onOpenCustomer(suggestion.company_id)}
            >
              {companyName}
            </button>
          ) : (
            <div className="suggestion-company">{companyName}</div>
          )}
          {contactName && <div className="suggestion-contact">{contactName}</div>}
        </div>
        <div className="suggestion-badges">
          <span className={`suggestion-badge tone-${priority.tone}`}>اولویت: {priority.text}</span>
          <span className={`suggestion-badge tone-${CONFIDENCE_TONE[confidence]}`}>
            {CONFIDENCE_LABELS[confidence]}
          </span>
        </div>
      </div>

      <div className="suggestion-reason">{REASON_LABELS[suggestion.reason_key] || suggestion.reason_key}</div>

      {(orderLine || invoiceLine || productLine) && (
        <div className="suggestion-context">
          {[orderLine, invoiceLine, productLine].filter(Boolean).join(' — ')}
        </div>
      )}

      <div className="suggestion-message-box">{currentText}</div>

      <div className="suggestion-why">
        <span className="suggestion-why-label">چرا:</span> {suggestion.explanation}
      </div>

      <div className="suggestion-meta">
        زمان پیشنهادی تماس: {formatJalaliDateTime(suggestion.recommended_at)}
      </div>

      <div className="suggestion-actions">
        <button type="button" className="btn-link" onClick={() => onApprove(suggestion)}>
          تأیید متن
        </button>
        <button type="button" className="btn-link" onClick={() => setActiveModal('edit')}>
          ویرایش متن
        </button>
        <button type="button" className="btn-link" onClick={() => setActiveModal('whatsapp')}>
          واتساپ دستی
        </button>
        <button type="button" className="btn-link" onClick={() => onCall(suggestion)}>
          تماس
        </button>
        <CrmSnoozeButton
          companyId={suggestion.company_id}
          reasonKey={suggestion.reason_key}
          orderId={suggestion.order_id}
          invoiceId={suggestion.invoice_id}
          onDone={onSnoozed}
        />
        <button type="button" className="btn-link btn-link-danger" onClick={() => onDismiss(suggestion)}>
          رد پیشنهاد
        </button>
      </div>

      {activeModal === 'edit' && (
        <MessagePreviewModal
          title="ویرایش متن پیشنهادی"
          initialMessage={currentText}
          primaryLabel="ذخیره متن ویرایش‌شده"
          onConfirm={async (finalText) => {
            await onEdit(suggestion, finalText)
            setActiveModal(null)
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'whatsapp' && (
        <MessagePreviewModal
          title="پیش‌نمایش پیام واتساپ"
          initialMessage={currentText}
          primaryLabel="ارسال / باز کردن واتساپ"
          onConfirm={async (finalText) => {
            await onWhatsapp(suggestion, finalText)
            setActiveModal(null)
          }}
          onCancel={() => setActiveModal(null)}
        />
      )}
    </div>
  )
}
