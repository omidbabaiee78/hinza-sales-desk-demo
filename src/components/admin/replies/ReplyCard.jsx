import { formatJalaliDateTime } from '../../../utils/formatters'
import { intentLabel, getIntentDefinition } from '../../../replyIntelligence/intentDefinitions'
import { replyChannelLabel, replyConfidenceLabel } from '../../../replyIntelligence/replyIntelligenceLabels'

export default function ReplyCard({ reply, onOpenLead, onReview }) {
  const def = getIntentDefinition(reply.final_intent || reply.predicted_intent)
  const displayName = reply.sales_leads?.company_name || reply.sales_leads?.contact_name || '—'

  return (
    <div className="reply-card">
      <div className="reply-card-main">
        <div className="outreach-card-top">
          <span className="automation-card-type">{intentLabel(reply.final_intent || reply.predicted_intent)}</span>
          <span className="outreach-channel-badge">{replyChannelLabel(reply.channel)}</span>
          {!reply.admin_confirmed && <span className="outreach-channel-badge">جدید</span>}
        </div>
        <div className="automation-card-who">{displayName}</div>
        <div className="reply-card-message">{reply.raw_message}</div>
        <div className="automation-card-meta">
          <span>{replyConfidenceLabel(reply.confidence)}</span>
          <span>اقدام پیشنهادی: {def.suggestedAction}</span>
          <span>دریافت‌شده: {formatJalaliDateTime(reply.created_at)}</span>
          {reply.outreach_attempt_id && <span>مرتبط با تلاش ارتباط قبلی</span>}
          {reply.automation_task_id && <span>مرتبط با کار خودکار</span>}
        </div>
      </div>
      <div className="reply-card-actions" onClick={(e) => e.stopPropagation()}>
        {onOpenLead && reply.lead_id && (
          <button type="button" className="btn-link" onClick={() => onOpenLead(reply.lead_id)}>
            مشاهده سرنخ
          </button>
        )}
        <button type="button" className="btn-link" onClick={() => onReview(reply)}>
          بررسی / ویرایش
        </button>
      </div>
    </div>
  )
}
