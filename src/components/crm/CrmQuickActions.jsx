import { useState } from 'react'
import { telHref, whatsappHref } from '../../constants/brand'
import { toE164Iran } from '../../utils/phone'
import { buildCrmMessage } from '../../constants/crmTemplates'
import { logCrmCommunication } from '../../services/crmCommunications'
import MessagePreviewModal from './MessagePreviewModal'
import './Crm.css'

// Quick-contact row used both in the CRM list and the customer 360 profile.
// Logging a communication is always best-effort: if crm_communications
// doesn't exist yet (migration not applied), the tel:/WhatsApp/copy action
// still works, it just isn't recorded to history yet.
export default function CrmQuickActions({
  companyId,
  phone,
  customerName,
  templateKey,
  templateVars,
  relatedOrderId,
  relatedInvoiceId,
  onOpenOrder,
  onOpenInvoice,
  onOpenCustomer,
}) {
  const [activeModal, setActiveModal] = useState(null) // 'whatsapp' | 'sms' | null
  const intlPhone = phone ? toE164Iran(phone).replace('+', '') : ''
  const message = buildCrmMessage(templateKey, { customerName, ...templateVars })

  function logBestEffort(payload) {
    logCrmCommunication({
      companyId,
      orderId: relatedOrderId,
      invoiceId: relatedInvoiceId,
      ...payload,
    }).catch(() => {
      // Communication history isn't wired up yet - the action itself
      // (call/WhatsApp/copy) already happened, so this stays silent.
    })
  }

  function handleCallClick() {
    logBestEffort({ channel: 'phone', reason: templateKey, actionStatus: 'manual_action' })
  }

  function handleWhatsappConfirm(finalMessage) {
    window.open(
      `${whatsappHref(intlPhone)}?text=${encodeURIComponent(finalMessage)}`,
      '_blank',
      'noopener',
    )
    logBestEffort({
      channel: 'whatsapp',
      reason: templateKey,
      messageSnapshot: finalMessage,
      actionStatus: 'opened',
    })
    setActiveModal(null)
  }

  function handleSmsCopy(finalMessage) {
    logBestEffort({
      channel: 'sms',
      reason: templateKey,
      messageSnapshot: finalMessage,
      actionStatus: 'copied',
    })
  }

  function handleSmsConfirm(finalMessage) {
    logBestEffort({
      channel: 'sms',
      reason: templateKey,
      messageSnapshot: finalMessage,
      actionStatus: 'manual_action',
    })
    setActiveModal(null)
  }

  return (
    <div className="crm-quick-actions">
      {phone && (
        <a className="btn-link" href={telHref(phone)} onClick={handleCallClick}>
          تماس
        </a>
      )}
      {phone && (
        <button type="button" className="btn-link" onClick={() => setActiveModal('whatsapp')}>
          واتساپ
        </button>
      )}
      {phone && (
        <button type="button" className="btn-link" onClick={() => setActiveModal('sms')}>
          پیامک
        </button>
      )}
      {onOpenCustomer && (
        <button type="button" className="btn-link" onClick={() => onOpenCustomer(companyId)}>
          مشاهده مشتری
        </button>
      )}
      {relatedOrderId && onOpenOrder && (
        <button type="button" className="btn-link" onClick={() => onOpenOrder(relatedOrderId)}>
          مشاهده سفارش
        </button>
      )}
      {relatedInvoiceId && onOpenInvoice && (
        <button type="button" className="btn-link" onClick={() => onOpenInvoice(relatedInvoiceId)}>
          مشاهده فاکتور
        </button>
      )}

      {activeModal === 'whatsapp' && (
        <MessagePreviewModal
          title="پیش‌نمایش پیام واتساپ"
          initialMessage={message}
          primaryLabel="ارسال / باز کردن واتساپ"
          onConfirm={handleWhatsappConfirm}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'sms' && (
        <MessagePreviewModal
          title="متن پیامک (ارسال دستی)"
          initialMessage={message}
          primaryLabel="ثبت به‌عنوان پیگیری‌شده"
          showCopy
          onConfirm={handleSmsConfirm}
          onCopy={handleSmsCopy}
          onCancel={() => setActiveModal(null)}
        />
      )}
    </div>
  )
}
