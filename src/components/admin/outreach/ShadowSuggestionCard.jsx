import { useState } from 'react'
import { formatJalaliDateTime } from '../../../utils/formatters'
import { outreachChannelLabel, outreachStatusLabel, shadowSuggestionStatusLabel } from '../../../outreach/outreachLabels'
import MessagePreviewModal from '../../crm/MessagePreviewModal'

function isoDateNDaysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

const SEND_STATUS_LABELS = {
  not_sent: 'ارسال نشده',
  ready_to_send: 'آماده ارسال',
  sending: 'در حال ارسال...',
  sent: 'ارسال‌شده',
  failed: 'ارسال ناموفق',
}

// Phase 26 - approve()/edit() still only ever mark this row approved-for-
// future-send (never sends anything by themselves). "ارسال آزمایشی" is the
// ONE new action that can trigger a REAL provider call - but ALWAYS in test
// mode (see services/outreachSend.js) - this UI never exposes a production
// send button in this phase, matching the phase's explicit scope (STEP 5/
// 15: manual approval required, real customer sends must stay impossible
// until credentials + a later, separate go-live decision).
export default function ShadowSuggestionCard({ suggestion, onOpenLead, handlers, sending, sendResult }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const lead = suggestion.sales_leads
  const displayName = lead?.company_name || lead?.contact_name || '—'
  const isBlocked = suggestion.outreach_status === 'blocked'
  const isReview = suggestion.outreach_status === 'manual_review'
  const isDecided = ['approved', 'edited', 'dismissed'].includes(suggestion.status)
  const canSendTest = ['approved', 'edited'].includes(suggestion.status) && suggestion.send_status !== 'sent'
  const messageText = suggestion.message_final || suggestion.message_draft

  async function run(fn, ...args) {
    setBusy(true)
    try {
      await fn(...args)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`outreach-card${isBlocked ? ' outreach-card-blocked' : ''}${isReview ? ' outreach-card-review' : ''}`}>
      <div className="outreach-card-main">
        <div className="outreach-card-top">
          <span className="automation-card-type">{outreachStatusLabel(suggestion.outreach_status)}</span>
          {suggestion.priority != null && (
            <span className={`automation-priority-badge tone-${suggestion.priority <= 20 ? 'lost' : suggestion.priority <= 50 ? 'offer' : 'contacted'}`}>
              اولویت {suggestion.priority}
            </span>
          )}
          {suggestion.channel && <span className="outreach-channel-badge">{outreachChannelLabel(suggestion.channel)}</span>}
          <span className="outreach-channel-badge">{shadowSuggestionStatusLabel(suggestion.status)}</span>
          {suggestion.send_status && suggestion.send_status !== 'not_sent' && (
            <span className="outreach-channel-badge">{SEND_STATUS_LABELS[suggestion.send_status] || suggestion.send_status}</span>
          )}
        </div>
        <div className="automation-card-who">{displayName}</div>
        {(lead?.city || lead?.industry) && <div className="today-item-context">{[lead?.city, lead?.industry].filter(Boolean).join(' — ')}</div>}

        {suggestion.reasons?.length > 0 && (
          <ul className="outreach-reason-list">
            {suggestion.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}

        {messageText && <div className="outreach-message-preview">{messageText}</div>}

        <div className="automation-card-meta">
          {suggestion.suggested_send_at && <span>زمان پیشنهادی ارسال: {formatJalaliDateTime(suggestion.suggested_send_at)}</span>}
          {suggestion.next_available_at && <span>زمان مجاز بعدی: {formatJalaliDateTime(suggestion.next_available_at)}</span>}
          <span>تولید شده: {formatJalaliDateTime(suggestion.generated_at)}</span>
        </div>

        {sendResult && (
          <div className="prospect-evidence-box">
            {sendResult.ok ? (
              <p className="lead-form-hint">
                ارسال آزمایشی موفق بود — ارائه‌دهنده: {sendResult.provider || '—'} | شناسه پیام: {sendResult.providerMessageId || '—'}
              </p>
            ) : (
              <>
                <p className="lead-form-hint">ارسال آزمایشی انجام نشد:</p>
                <ul className="outreach-reason-list">
                  {(sendResult.reasons || [sendResult.errorMessage || 'خطای نامشخص']).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <div className="automation-card-actions" onClick={(e) => e.stopPropagation()}>
        {onOpenLead && suggestion.lead_id && (
          <button type="button" className="btn-link" onClick={() => onOpenLead(suggestion.lead_id)}>
            مشاهده سرنخ
          </button>
        )}

        {!isDecided && suggestion.status === 'pending' && (
          <>
            <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.approve, suggestion.id)}>
              تأیید (فقط آماده‌سازی، بدون ارسال)
            </button>
            <button type="button" className="btn-link" onClick={() => setEditing(true)}>
              ویرایش متن
            </button>
            <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.snooze, suggestion.id, isoDateNDaysFromNow(1))}>
              فردا
            </button>
            <button type="button" className="btn-link" disabled={busy} onClick={() => run(handlers.snooze, suggestion.id, isoDateNDaysFromNow(3))}>
              ۳ روز
            </button>
            <button
              type="button"
              className="btn-link btn-link-danger"
              disabled={busy}
              onClick={() => run(handlers.dismiss, suggestion.id, 'توسط ادمین رد شد.')}
            >
              رد کردن
            </button>
          </>
        )}

        {canSendTest && (
          <button type="button" className="btn-link" disabled={sending} onClick={() => handlers.sendTest(suggestion.id)}>
            {sending ? 'در حال ارسال آزمایشی...' : 'ارسال آزمایشی (Send Test)'}
          </button>
        )}
      </div>

      {canSendTest && <p className="outreach-test-mode-banner">حالت آزمایشی — ارسال واقعی به مشتریان غیرفعال است</p>}

      {editing && (
        <MessagePreviewModal
          title="ویرایش متن پیشنهادی (فقط ذخیره - ارسال نمی‌شود)"
          initialMessage={messageText}
          primaryLabel="ذخیره به‌عنوان تأییدشده"
          onConfirm={(finalText) => run(handlers.edit, suggestion.id, finalText).then(() => setEditing(false))}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  )
}
