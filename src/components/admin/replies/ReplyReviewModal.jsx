import { useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { normalizeReply } from '../../../replyIntelligence/normalizeReply'
import { classifyReply } from '../../../replyIntelligence/classifyReply'
import { recommendNextAction } from '../../../replyIntelligence/recommendNextAction'
import { getIntentDefinition, REPLY_INTENT_KEYS, intentLabel } from '../../../replyIntelligence/intentDefinitions'
import { processInboundReply, confirmInboundReply } from '../../../replyIntelligence/replyProcessor'
import { REPLY_CHANNELS, replyChannelLabel, replyConfidenceLabel } from '../../../replyIntelligence/replyIntelligenceLabels'
import { followUpIsoFromDate, followUpDateOnly } from '../../../utils/leadFollowUp'
import { formatJalaliDateTime } from '../../../utils/formatters'
import JalaliDateInput from '../../common/JalaliDateInput'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'
import './Replies.css'

// One shared review/confirm UI for BOTH entry points: the Outreach card's
// "ثبت پاسخ" action (mode="capture" - admin types the reply text) and the
// Reply Inbox's "بررسی / ویرایش" action (mode="edit" - the raw text is
// already recorded and never re-typed or overwritten, only its
// classification/follow-up/note can change).
//
// The live preview below (تشخیص سیستم / اطمینان / پیشنهاد اقدام / زمان
// پیگیری) is pure client-side computation via the same deterministic engine
// the DB write later uses - nothing here is provisional or a "different"
// answer than what gets stored.
export default function ReplyReviewModal({
  mode = 'capture',
  leadId,
  companyId,
  outreachAttemptId,
  automationTaskId,
  defaultChannel,
  contactLabel,
  existingReply,
  onSaved,
  onCancel,
}) {
  const [rawMessage, setRawMessage] = useState(existingReply?.raw_message || '')
  const [channel, setChannel] = useState(existingReply?.channel || defaultChannel || 'manual')
  const [note, setNote] = useState(existingReply?.admin_notes || '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [blockConfirmed, setBlockConfirmed] = useState(false)

  const normalization = useMemo(() => {
    if (mode === 'edit') {
      return { raw: existingReply.raw_message, normalized: existingReply.normalized_message || '', emojis: [] }
    }
    return normalizeReply(rawMessage)
  }, [mode, rawMessage, existingReply])

  const classification = useMemo(() => {
    if (mode === 'edit') {
      return { intentKey: existingReply.predicted_intent, confidence: existingReply.confidence }
    }
    return rawMessage.trim() ? classifyReply(normalization) : null
  }, [mode, normalization, rawMessage, existingReply])

  // The dropdown follows the LIVE classifier output as the admin types
  // (capture mode) until they explicitly pick something themselves - once
  // touched, their choice sticks even if they keep editing the text
  // afterward, never silently reverting to a fresh guess.
  const [intentTouched, setIntentTouched] = useState(false)
  const [manualIntentKey, setManualIntentKey] = useState(null)

  const liveIntentKey = mode === 'edit' ? existingReply.final_intent || existingReply.predicted_intent : classification?.intentKey || 'unknown'
  const selectedIntentKey = intentTouched ? manualIntentKey : liveIntentKey

  const [followUpDateStr, setFollowUpDateStr] = useState(() =>
    followUpDateOnly(existingReply?.recommended_follow_up_at || ''),
  )
  const [followUpTouched, setFollowUpTouched] = useState(Boolean(existingReply?.recommended_follow_up_at))

  const recommendation = useMemo(
    () => recommendNextAction({ intentKey: selectedIntentKey, normalizedText: normalization.normalized, now: new Date() }),
    [selectedIntentKey, normalization],
  )

  // Auto-fills the suggested follow-up date only until the admin edits it
  // themselves - never silently overwrites a manual choice.
  const effectiveFollowUpDateStr = followUpTouched ? followUpDateStr : followUpDateOnly(recommendation.followUpAt || '')

  const selectedDef = getIntentDefinition(selectedIntentKey)
  const canPreview = mode === 'edit' || rawMessage.trim().length > 0
  const needsBlockConfirm = selectedDef.blocksOutreach

  function handleIntentChange(nextKey) {
    setIntentTouched(true)
    setManualIntentKey(nextKey)
    setBlockConfirmed(false)
  }

  function handleFollowUpChange(value) {
    setFollowUpTouched(true)
    setFollowUpDateStr(value)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canPreview) return
    if (needsBlockConfirm && !blockConfirmed) return

    setError('')
    setSubmitting(true)
    const followUpAt = effectiveFollowUpDateStr ? followUpIsoFromDate(effectiveFollowUpDateStr) : null

    try {
      if (mode === 'capture') {
        const result = await processInboundReply(supabase, {
          leadId,
          companyId,
          outreachAttemptId,
          automationTaskId,
          channel,
          rawMessage,
          source: 'manual',
          confirmation: { finalIntentKey: selectedIntentKey, followUpAt, note },
        })
        onSaved(result)
      } else {
        const result = await confirmInboundReply(
          supabase,
          existingReply.id,
          { finalIntentKey: selectedIntentKey, followUpAt, note },
          { force: true },
        )
        onSaved(result)
      }
    } catch (err) {
      setError(err.message || 'ثبت پاسخ با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel reply-review-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === 'edit' ? 'ویرایش دسته‌بندی پاسخ' : 'ثبت پاسخ'}</h2>
        {contactLabel && <p className="lead-form-hint">{contactLabel}</p>}

        <form onSubmit={handleSubmit}>
          {mode === 'capture' ? (
            <>
              <label>
                متن پاسخ مشتری
                <textarea
                  rows={3}
                  value={rawMessage}
                  onChange={(e) => setRawMessage(e.target.value)}
                  placeholder="مثلاً: قیمت چند؟"
                  required
                />
              </label>
              <label>
                کانال دریافت پاسخ
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {REPLY_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {replyChannelLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="reply-raw-readonly">
              <span className="reply-raw-readonly-label">متن پاسخ (قابل ویرایش نیست)</span>
              <p>{existingReply.raw_message}</p>
              <span className="lead-form-hint">
                کانال: {replyChannelLabel(existingReply.channel)} — دریافت‌شده: {formatJalaliDateTime(existingReply.created_at)}
              </span>
            </div>
          )}

          {canPreview && (
            <div className="reply-preview-box">
              <div className="reply-preview-row">
                <span className="reply-preview-label">تشخیص سیستم</span>
                <span className="reply-preview-value">{intentLabel(classification?.intentKey)}</span>
              </div>
              <div className="reply-preview-row">
                <span className="reply-preview-label">اطمینان</span>
                <span className="reply-preview-value">{replyConfidenceLabel(classification?.confidence)}</span>
              </div>

              <label>
                دسته‌بندی نهایی (در صورت نیاز اصلاح کنید)
                <select value={selectedIntentKey} onChange={(e) => handleIntentChange(e.target.value)}>
                  {REPLY_INTENT_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {intentLabel(key)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="reply-preview-row">
                <span className="reply-preview-label">پیشنهاد اقدام بعدی</span>
                <span className="reply-preview-value">{selectedDef.suggestedAction}</span>
              </div>

              {selectedDef.expectsFollowUp && (
                <label>
                  تاریخ پیگیری بعدی
                  <JalaliDateInput value={effectiveFollowUpDateStr} onChange={handleFollowUpChange} />
                </label>
              )}
              {recommendation.followUpNote && <p className="lead-form-hint">{recommendation.followUpNote}</p>}

              {needsBlockConfirm && (
                <div className="reply-block-warning">
                  <p>
                    با ثبت این دسته‌بندی، تماس‌های آینده با این سرنخ متوقف می‌شود (عدم تماس). این تغییر همیشه از صفحه
                    سرنخ‌ها قابل بازگشت است.
                  </p>
                  <label className="product-form-availability">
                    <input type="checkbox" checked={blockConfirmed} onChange={(e) => setBlockConfirmed(e.target.checked)} />
                    متوجه‌ام و تأیید می‌کنم
                  </label>
                </div>
              )}

              <label>
                یادداشت ادمین (اختیاری)
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          )}

          <ErrorBanner message={error} />

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !canPreview || (needsBlockConfirm && !blockConfirmed)}>
              {submitting ? 'در حال ثبت...' : mode === 'edit' ? 'ذخیره تغییرات' : 'ثبت پاسخ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
