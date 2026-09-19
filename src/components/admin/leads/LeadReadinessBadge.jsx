import { computeLeadReadiness } from '../../../utils/leadIntelligence'

function toneForScore(score) {
  if (score >= 70) return 'won'
  if (score >= 40) return 'offer'
  return 'lost'
}

// Explainable by design: the score is never shown without its reasons
// (title tooltip here; the detail page renders the same reasons inline).
export default function LeadReadinessBadge({ lead, showReasons }) {
  const { score, reasons } = computeLeadReadiness(lead)
  const tone = toneForScore(score)
  return (
    <div className="lead-readiness">
      <span className={`lead-status-badge tone-${tone}`} title={reasons.join(' / ')}>
        آمادگی پیگیری: {score}
      </span>
      {showReasons && reasons.length > 0 && (
        <ul className="lead-readiness-reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
