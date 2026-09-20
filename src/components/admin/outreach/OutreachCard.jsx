import { useState } from 'react'
import { formatJalaliDateTime } from '../../../utils/formatters'
import { taskTypeLabel } from '../../../automation/taskLabels'
import { outreachChannelLabel } from '../../../outreach/outreachLabels'
import { whatsappChannel } from '../../../outreach/channels/whatsapp'
import { phoneChannel } from '../../../outreach/channels/phone'
import { emailChannel } from '../../../outreach/channels/email'
import MessagePreviewModal from '../../crm/MessagePreviewModal'
import LeadActivityFormModal from '../leads/LeadActivityFormModal'
import DoNotContactConfirmModal from './DoNotContactConfirmModal'
import ReplyReviewModal from '../replies/ReplyReviewModal'

function isoDateNDaysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00:00+03:30`
}

// activityType for "mark completed": phone/whatsapp are real contact types
// the rest of the app already recognizes (stamps last_contact_at) - sms/
// email have no such enum value anywhere else in the app, so completing
// those logs a plain timeline note instead of silently inventing new
// contact-type business logic.
function completionActivityType(channel) {
  if (channel === 'phone' || channel === 'whatsapp') return channel
  return 'note'
}

export default function OutreachCard({ opportunity, onOpenLead, handlers }) {
  const [activeModal, setActiveModal] = useState(null) // 'whatsapp' | 'sms' | 'email' | 'complete' | 'doNotContact' | 'reply'
  const [busy, setBusy] = useState(false)

  const { lead, leadId, taskId, task, channel, message, subject, outreachStatus, reasons, withinContactWindow, nextAvailableAt } =
    opportunity

  const displayName = opportunity.companyName || opportunity.contactName || '—'
  const isBlocked = outreachStatus === 'blocked'
  const isManualReview = outreachStatus === 'manual_review'

  async function run(fn, ...args) {
    setBusy(true)
    try {
      await fn(...args)
    } finally {
      setBusy(false)
    }
  }

  function handleWhatsappConfirm(finalMessage) {
    const prepared = whatsappChannel.prepare({ lead, message: finalMessage })
    if (prepared) window.open(prepared.href, '_blank', 'noopener')
    handlers.recordAttempt(opportunity, { channel: 'whatsapp', status: 'opened', messageSnapshot: finalMessage })
    setActiveModal(null)
  }

  function handleSmsCopy(finalMessage) {
    handlers.recordAttempt(opportunity, { channel: 'sms', status: 'copied', messageSnapshot: finalMessage })
  }

  function handleSmsConfirm(finalMessage) {
    handlers.recordAttempt(opportunity, { channel: 'sms', status: 'copied', messageSnapshot: finalMessage })
    setActiveModal(null)
  }

  function handleEmailConfirm(finalMessage) {
    const prepared = emailChannel.prepare({ lead, message: finalMessage, subject })
    if (prepared) window.location.href = prepared.href
    handlers.recordAttempt(opportunity, { channel: 'email', status: 'opened', messageSnapshot: finalMessage, subjectSnapshot: subject })
    setActiveModal(null)
  }

  function handlePhoneCallClick() {
    handlers.recordAttempt(opportunity, { channel: 'phone', status: 'opened' })
  }

  async function handleCopyPhoneNumber(number) {
    try {
      await navigator.clipboard.writeText(number)
    } catch {
      // Clipboard API unavailable - the number is still shown on screen.
    }
    handlers.recordAttempt(opportunity, { channel: 'phone', status: 'copied' })
  }

  function handleActivitySaved() {
    handlers.recordCompletedAttempt(opportunity, { channel, messageSnapshot: message })
    setActiveModal(null)
  }

  function handleReplySaved() {
    setActiveModal(null)
    handlers.refresh?.({ withReconcile: true })
  }

  const phonePrepared = channel === 'phone' ? phoneChannel.prepare({ lead }) : null

  return (
    <div className={`outreach-card${isBlocked ? ' outreach-card-blocked' : ''}${isManualReview ? ' outreach-card-review' : ''}`}>
      <div className="outreach-card-main">
        <div className="outreach-card-top">
          <span className="automation-card-type">{taskTypeLabel(task.task_type)}</span>
          <span className={`automation-priority-badge tone-${task.priority <= 20 ? 'lost' : task.priority <= 50 ? 'offer' : 'contacted'}`}>
            اولویت {task.priority}
          </span>
          {channel && <span className="outreach-channel-badge">{outreachChannelLabel(channel)}</span>}
        </div>
        <div className="automation-card-who">{displayName}</div>
        {(opportunity.city || opportunity.industry) && (
          <div className="today-item-context">{[opportunity.city, opportunity.industry].filter(Boolean).join(' — ')}</div>
        )}
        <div className="automation-card-reason">{opportunity.reason}</div>

        {isBlocked || isManualReview ? (
          <ul className="outreach-reason-list">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          message && <div className="outreach-message-preview">{message}</div>
        )}

        <div className="automation-card-meta">
          {opportunity.attemptCount > 0 && <span>{opportunity.attemptCount} بار تلاش قبلی</span>}
          {opportunity.lastOutreachAt && <span>آخرین اقدام: {formatJalaliDateTime(opportunity.lastOutreachAt)}</span>}
          {outreachStatus === 'eligible' && !withinContactWindow && nextAvailableAt && (
            <span>خارج از بازه تماس — بعد از {formatJalaliDateTime(nextAvailableAt.toISOString())}</span>
          )}
          {isBlocked && nextAvailableAt && <span>زمان مجاز بعدی: {formatJalaliDateTime(nextAvailableAt.toISOString())}</span>}
        </div>
      </div>

      <div className="automation-card-actions" onClick={(e) => e.stopPropagation()}>
        {onOpenLead && leadId && (
          <button type="button" className="btn-link" onClick={() => onOpenLead(leadId)}>
            مشاهده سرنخ
          </button>
        )}

        {outreachStatus === 'eligible' && withinContactWindow && (
          <>
            {channel === 'whatsapp' && (
              <button type="button" className="btn-link" onClick={() => setActiveModal('whatsapp')}>
                واتساپ
              </button>
            )}
            {channel === 'sms' && (
              <button type="button" className="btn-link" onClick={() => setActiveModal('sms')}>
                پیامک
              </button>
            )}
            {channel === 'email' && (
              <button type="button" className="btn-link" onClick={() => setActiveModal('email')}>
                ایمیل
              </button>
            )}
            {channel === 'phone' && phonePrepared && (
              <>
                <a className="btn-link" href={phonePrepared.href} onClick={handlePhoneCallClick}>
                  تماس
                </a>
                <button type="button" className="btn-link" onClick={() => handleCopyPhoneNumber(phonePrepared.number)}>
                  کپی شماره
                </button>
              </>
            )}
          </>
        )}

        {task.status === 'waiting_approval' && (
          <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.approve, taskId)}>
            تأیید
          </button>
        )}

        {(outreachStatus === 'eligible' || isManualReview) && (
          <button type="button" className="btn-link" onClick={() => setActiveModal('complete')}>
            ثبت انجام‌شده
          </button>
        )}

        {leadId && (
          <button type="button" className="btn-link" onClick={() => setActiveModal('reply')}>
            ثبت پاسخ
          </button>
        )}

        <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.snooze, taskId, isoDateNDaysFromNow(1))}>
          فردا
        </button>
        <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.snooze, taskId, isoDateNDaysFromNow(3))}>
          ۳ روز
        </button>
        <button
          type="button"
          className="btn-link"
          disabled={busy}
          onClick={() => run(handlers.dismiss, taskId, 'توسط ادمین رد شد.')}
        >
          رد کردن
        </button>
        {leadId && !lead?.do_not_contact && (
          <button type="button" className="btn-link btn-link-danger" onClick={() => setActiveModal('doNotContact')}>
            عدم تماس
          </button>
        )}
      </div>

      {activeModal === 'whatsapp' && (
        <MessagePreviewModal
          title="پیش‌نمایش پیام واتساپ"
          initialMessage={message}
          primaryLabel="باز کردن واتساپ"
          onConfirm={handleWhatsappConfirm}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'sms' && (
        <MessagePreviewModal
          title="متن پیامک (ارسال دستی)"
          initialMessage={message}
          primaryLabel="ثبت به‌عنوان کپی‌شده"
          showCopy
          onConfirm={handleSmsConfirm}
          onCopy={handleSmsCopy}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'email' && (
        <MessagePreviewModal
          title="پیش‌نمایش ایمیل"
          initialMessage={message}
          primaryLabel="باز کردن ایمیل"
          onConfirm={handleEmailConfirm}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'complete' && leadId && (
        <LeadActivityFormModal
          leadId={leadId}
          activityType={completionActivityType(channel)}
          onSaved={handleActivitySaved}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'doNotContact' && (
        <DoNotContactConfirmModal
          companyLabel={displayName}
          onConfirm={() => handlers.markDoNotContact(leadId).then(() => setActiveModal(null))}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'reply' && (
        <ReplyReviewModal
          mode="capture"
          leadId={leadId}
          outreachAttemptId={opportunity.lastOutreachAttemptId}
          automationTaskId={taskId}
          defaultChannel={channel || 'manual'}
          contactLabel={displayName}
          onSaved={handleReplySaved}
          onCancel={() => setActiveModal(null)}
        />
      )}
    </div>
  )
}
