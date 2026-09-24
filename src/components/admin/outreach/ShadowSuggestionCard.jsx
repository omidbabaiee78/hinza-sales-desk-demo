import { useState } from 'react'
import { formatJalaliDateTime } from '../../../utils/formatters'
import { outreachChannelLabel, outreachStatusLabel, shadowSuggestionStatusLabel } from '../../../outreach/outreachLabels'
import MessagePreviewModal from '../../crm/MessagePreviewModal'
import FirstEmailConfirmModal from './FirstEmailConfirmModal'
import DoNotContactConfirmModal from './DoNotContactConfirmModal'
import { buildEmailPreview, emailSubjectFor } from '../../../outreach/sendGate'

function isoDateNDaysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

const SEND_STATUS_LABELS = {
  not_sent: 'ارسال نشده',
  ready_to_send: 'آماده ارسال',
  sending: 'در حال ارسال...',
  // send_status is only ever set by a PRODUCTION send - sendPipeline.js
  // never touches it for a test send - so 'sent' always means the prospect.
  sent: 'ارسال‌شده به مشتری',
  failed: 'ارسال ناموفق',
}

// Phase 26 - approve()/edit() still only ever mark this row approved-for-
// future-send (never sends anything by themselves). "ارسال آزمایشی" always
// goes to the test recipient (see services/outreachSend.js).
//
// "ارسال اولین ایمیل" is the one production action: email channel only,
// one approved suggestion per admin click, behind a read-only confirmation
// showing the exact recipient/subject/body. It is offered only when the
// suggestion isn't already sent/in flight AND firstEmailCheck (the same
// sendGate.js checks the server runs, pre-evaluated in useOutreachShadow)
// passes - otherwise a short Persian reason is shown instead. It is also
// disabled while ANY send on the page is in flight. The server re-runs the
// full gate on every click and stays the source of truth. WhatsApp has no
// production action here.
// One line per delivery state from sendGate.js classifySendAttempts - a
// test delivery is always labelled as the admin's test inbox, never as the
// prospect. Returns '' when there is no provider-send history yet.
const SEND_HISTORY_LABELS = [
  ['realDelivered', 'ارسال‌شده به مشتری'],
  ['testDelivered', 'آزمایشی (فقط به نشانی آزمایشی شما)'],
  ['realUncertain', 'نامشخص - نیاز به بررسی دستی'],
  ['testUncertain', 'آزمایشی نامشخص'],
  ['ambiguous', 'سابقه مبهم - نیاز به بررسی دستی'],
  ['failedOrBlocked', 'ناموفق یا مسدود'],
]

function sendHistorySummary(history) {
  if (!history) return ''
  return SEND_HISTORY_LABELS.filter(([key]) => history[key] > 0)
    .map(([key, label]) => `${label}: ${history[key]}`)
    .join(' · ')
}

function firstEmailBlockReasons(suggestion, recipientEmail, messageText, firstEmailCheck) {
  if (suggestion.send_status === 'sent') return ['این ایمیل قبلاً برای مشتری ارسال شده است.']
  if (suggestion.send_status === 'sending') return ['ارسال قبلی این ایمیل به مشتری هنوز نتیجه قطعی ندارد و باید دستی بررسی شود.']
  if (!recipientEmail) return ['این سرنخ نشانی ایمیل ندارد.']
  if (!messageText?.trim()) return ['متن پیام خالی است.']
  if (!firstEmailCheck) return ['در حال بررسی شرایط ارسال...']
  return firstEmailCheck.allowed ? [] : firstEmailCheck.reasons
}

export default function ShadowSuggestionCard({ suggestion, onOpenLead, handlers, sending, anySending, firstEmailCheck, sendResult }) {
  const [editing, setEditing] = useState(false)
  const [confirmingEmail, setConfirmingEmail] = useState(false)
  const [confirmingOptOut, setConfirmingOptOut] = useState(false)
  const [busy, setBusy] = useState(false)

  const lead = suggestion.sales_leads
  const displayName = lead?.company_name || lead?.contact_name || '—'
  const isBlocked = suggestion.outreach_status === 'blocked'
  const isReview = suggestion.outreach_status === 'manual_review'
  const isDecided = ['approved', 'edited', 'dismissed'].includes(suggestion.status)
  const canSendTest = ['approved', 'edited'].includes(suggestion.status) && suggestion.send_status !== 'sent'
  const messageText = suggestion.message_final || suggestion.message_draft
  const recipientEmail = lead?.email?.trim() || ''
  const emailPreview = suggestion.channel === 'email' ? buildEmailPreview({ suggestion, lead }) : null
  const isFirstEmailCandidate = suggestion.channel === 'email' && ['approved', 'edited'].includes(suggestion.status)
  const firstEmailBlocked = isFirstEmailCandidate ? firstEmailBlockReasons(suggestion, recipientEmail, messageText, firstEmailCheck) : []
  const canSendFirstEmail = isFirstEmailCandidate && firstEmailBlocked.length === 0
  const isFirstEmailResult = sendResult?.kind === 'first_email'
  const sendLabel = isFirstEmailResult ? 'ارسال ایمیل' : 'ارسال آزمایشی'

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

        {/* Email: the exact recipient/subject/body a real send would use
            (opt-out footer included), visible at every status so it can be
            reviewed before approving. Other channels show the plain text. */}
        {emailPreview ? (
          <div className="prospect-evidence-box">
            <div className="info-row">
              <span className="info-label">گیرنده</span>
              <span className="info-value" dir="ltr">
                {emailPreview.recipient || '—'}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">موضوع</span>
              <span className="info-value">{emailPreview.subject}</span>
            </div>
            {emailPreview.body && (
              <div className="outreach-message-preview" style={{ whiteSpace: 'pre-wrap' }}>
                {emailPreview.body}
              </div>
            )}
          </div>
        ) : (
          messageText && <div className="outreach-message-preview">{messageText}</div>
        )}

        <div className="automation-card-meta">
          {suggestion.suggested_send_at && <span>زمان پیشنهادی ارسال: {formatJalaliDateTime(suggestion.suggested_send_at)}</span>}
          {suggestion.next_available_at && <span>زمان مجاز بعدی: {formatJalaliDateTime(suggestion.next_available_at)}</span>}
          <span>تولید شده: {formatJalaliDateTime(suggestion.generated_at)}</span>
        </div>

        {sendResult && (
          <div className="prospect-evidence-box">
            {sendResult.ok ? (
              <p className="lead-form-hint">
                {sendResult.testMode
                  ? isFirstEmailResult
                    ? 'حالت آزمایشی سیستم روشن است؛ این ایمیل فقط به نشانی آزمایشی شما رفت، نه به مشتری.'
                    : 'ارسال آزمایشی موفق بود؛ فقط به نشانی آزمایشی شما رفت، نه به مشتری.'
                  : 'ارسال واقعی ثبت شد: سرویس ایمیل پیام را برای نشانی مشتری پذیرفت (تأیید تحویل به صندوق مشتری نیست).'}{' '}
                ارائه‌دهنده: {sendResult.provider || '—'} | شناسه پیام: {sendResult.providerMessageId || '—'}
              </p>
            ) : (
              <>
                <p className="lead-form-hint">{sendLabel} انجام نشد:</p>
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
          <button type="button" className="btn-link" disabled={anySending} onClick={() => handlers.sendTest(suggestion.id)}>
            {sending ? 'در حال ارسال...' : 'ارسال آزمایشی (Send Test)'}
          </button>
        )}

        {canSendFirstEmail && (
          <button type="button" className="btn-link" disabled={anySending} onClick={() => setConfirmingEmail(true)}>
            ارسال اولین ایمیل به مشتری
          </button>
        )}

        {/* Opt-out ("«لغو»" reply, or any stop request) - sets
            sales_leads.do_not_contact, which the server send gate blocks on. */}
        {suggestion.lead_id && handlers.markDoNotContact && !lead?.do_not_contact && (
          <button type="button" className="btn-link btn-link-danger" disabled={busy} onClick={() => setConfirmingOptOut(true)}>
            ثبت لغو دریافت (عدم تماس)
          </button>
        )}
        {lead?.do_not_contact && <span className="lead-status-badge tone-lost">عدم تماس</span>}
      </div>

      {isFirstEmailCandidate && firstEmailBlocked.length > 0 && (
        <p className="lead-form-hint">
          ارسال اولین ایمیل فعلاً ممکن نیست: {firstEmailBlocked[0]}
          {firstEmailBlocked.length > 1 && ` (و ${firstEmailBlocked.length - 1} مورد دیگر)`}
        </p>
      )}

      {isFirstEmailCandidate && sendHistorySummary(firstEmailCheck?.history) && (
        <p className="lead-form-hint">سابقه ارسال: {sendHistorySummary(firstEmailCheck.history)}</p>
      )}

      {canSendTest && !canSendFirstEmail && <p className="outreach-test-mode-banner">حالت آزمایشی — ارسال واقعی به مشتریان غیرفعال است</p>}

      {confirmingEmail && (
        <FirstEmailConfirmModal
          recipientName={displayName}
          recipientEmail={recipientEmail}
          subject={emailSubjectFor(suggestion)}
          message={messageText}
          onConfirm={async () => {
            setConfirmingEmail(false)
            await handlers.sendFirstEmail(suggestion.id)
          }}
          onCancel={() => setConfirmingEmail(false)}
        />
      )}

      {confirmingOptOut && (
        <DoNotContactConfirmModal
          companyLabel={displayName}
          onConfirm={async () => {
            await handlers.markDoNotContact(suggestion.lead_id)
            setConfirmingOptOut(false)
          }}
          onCancel={() => setConfirmingOptOut(false)}
        />
      )}

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
