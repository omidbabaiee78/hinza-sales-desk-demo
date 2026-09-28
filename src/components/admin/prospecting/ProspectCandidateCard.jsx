import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { fetchCandidateEvidence } from '../../../prospecting/discoveryPipeline'
import { confidenceLabel, evidenceTypeLabel, queueStateLabel, reviewReasonLabel } from '../../../prospecting/prospectingLabels'
import { MAX_SITE_FETCH_ATTEMPTS } from '../../../prospecting/candidateQueue'
import { suggestProductFit } from '../../../prospecting/productFit'
import { formatJalaliDateTime } from '../../../utils/formatters'
import EditCandidateModal from './EditCandidateModal'

// When the scheduler is expected to read this candidate's website next.
function queueTiming(queueState) {
  if (queueState?.key !== 'waiting' && queueState?.key !== 'eligible') return null
  if (!queueState.expectedAt) return 'اجرای خودکار خاموش است؛ تا روشن شدن آن بررسی نمی‌شود.'
  const when = formatJalaliDateTime(queueState.expectedAt)
  if (queueState.reason === 'retry') {
    return `وب‌سایت دفعهٔ قبل باز نشد؛ تلاش ${queueState.attempt} از ${MAX_SITE_FETCH_ATTEMPTS}، در اولین اجرای خودکار از ${when}.`
  }
  return `نوبت ${queueState.queuePosition} در صف بررسی خودکار؛ تخمین زمان بررسی: ${when}`
}

export default function ProspectCandidateCard({ candidate, queueState, handlers, busy }) {
  const [expanded, setExpanded] = useState(false)
  const [evidence, setEvidence] = useState(null)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [editing, setEditing] = useState(false)

  async function toggleExpanded() {
    if (!expanded && evidence === null) {
      setLoadingEvidence(true)
      const rows = await fetchCandidateEvidence(supabase, candidate.id)
      setEvidence(rows)
      setLoadingEvidence(false)
    }
    setExpanded((v) => !v)
  }

  async function handleEditSave(fields) {
    await handlers.updateFields(candidate.id, fields)
    await handlers.reEvaluate(candidate.id)
    setEditing(false)
    setEvidence(null)
  }

  const fit = evidence ? suggestProductFit(evidence) : null
  const attention = queueState?.key === 'attention'
  const reasonText = attention
    ? [reviewReasonLabel(queueState.reason), candidate.match_explanation].filter(Boolean).join(' ')
    : candidate.rejection_reason || candidate.match_explanation || candidate.qualification_reason
  const timing = queueTiming(queueState)

  return (
    <div className="prospect-card">
      <div className="prospect-card-main">
        <div className="outreach-card-top">
          <span className="automation-card-type">{queueStateLabel(queueState?.key)}</span>
          {candidate.overall_score != null && <span className="automation-priority-badge tone-contacted">امتیاز {candidate.overall_score}</span>}
          {candidate.confidence && <span className="outreach-channel-badge">{confidenceLabel(candidate.confidence)}</span>}
        </div>
        <div className="automation-card-who">{candidate.canonical_name}</div>
        {(candidate.city || candidate.industry_guess) && (
          <div className="today-item-context">{[candidate.city, candidate.industry_guess].filter(Boolean).join(' — ')}</div>
        )}
        {reasonText && <div className="automation-card-reason">{reasonText}</div>}
        {timing && <div className="lead-form-hint">{timing}</div>}

        <div className="automation-card-meta">
          {candidate.mobile && <span>موبایل: {candidate.mobile}</span>}
          {candidate.phone && <span>تلفن: {candidate.phone}</span>}
          {candidate.prospect_sources?.name && <span>منبع: {candidate.prospect_sources.name}</span>}
          <span>آخرین مشاهده: {formatJalaliDateTime(candidate.last_seen_at)}</span>
        </div>

        <button type="button" className="btn-link" onClick={toggleExpanded}>
          {expanded ? 'بستن جزئیات' : 'دلیل انتخاب و محصول احتمالی مرتبط'}
        </button>

        {expanded && (
          <div className="prospect-evidence-box">
            {loadingEvidence && <p>در حال بارگذاری...</p>}
            {evidence && evidence.length === 0 && <p className="lead-form-hint">شواهدی ثبت نشده است.</p>}
            {evidence && evidence.length > 0 && (
              <ul className="outreach-reason-list prospect-evidence-list">
                {evidence.map((e, i) => (
                  <li key={i}>
                    {evidenceTypeLabel(e.evidenceType)}: {e.value}
                  </li>
                ))}
              </ul>
            )}
            {fit && fit.products.length > 0 && <p className="lead-form-hint">{fit.noteFa}</p>}
          </div>
        )}
      </div>

      <div className="automation-card-actions" onClick={(e) => e.stopPropagation()}>
        {candidate.website && (
          <a className="btn-link" href={candidate.website} target="_blank" rel="noopener noreferrer">
            باز کردن منبع
          </a>
        )}
        {(candidate.status === 'qualified' || candidate.status === 'manual_review') && (
          <button type="button" className="btn-link" disabled={busy} onClick={() => handlers.promote(candidate.id)}>
            تبدیل به سرنخ
          </button>
        )}
        {candidate.status !== 'promoted' && (
          <button type="button" className="btn-link" disabled={busy} onClick={() => setEditing(true)}>
            ویرایش اطلاعات
          </button>
        )}
        {candidate.status !== 'promoted' && (
          <button type="button" className="btn-link" disabled={busy} onClick={() => handlers.reEvaluate(candidate.id)}>
            ارزیابی مجدد
          </button>
        )}
        {candidate.status !== 'duplicate' && candidate.status !== 'promoted' && (
          <button
            type="button"
            className="btn-link"
            disabled={busy}
            onClick={() => handlers.markDuplicate(candidate.id, { explanation: 'ثبت‌شده توسط ادمین به‌عنوان تکراری.' })}
          >
            علامت‌گذاری تکراری
          </button>
        )}
        {candidate.status !== 'rejected' && candidate.status !== 'promoted' && (
          <button type="button" className="btn-link btn-link-danger" disabled={busy} onClick={() => handlers.reject(candidate.id)}>
            رد کردن
          </button>
        )}
      </div>

      {editing && <EditCandidateModal candidate={candidate} onSave={handleEditSave} onCancel={() => setEditing(false)} />}
    </div>
  )
}
