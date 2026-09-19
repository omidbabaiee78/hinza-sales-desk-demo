import { FOLLOW_UP_STATE_LABELS, followUpState } from '../../../utils/leadFollowUp'
import { formatJalaliDate } from '../../../utils/formatters'

export default function LeadFollowUpBadge({ nextFollowUpAt }) {
  const state = followUpState(nextFollowUpAt)
  if (state === 'none') return <span className="lead-followup-none">—</span>
  return (
    <span className={`lead-followup-badge tone-${state}`}>
      {FOLLOW_UP_STATE_LABELS[state]}
      {nextFollowUpAt && <span className="lead-followup-date"> ({formatJalaliDate(nextFollowUpAt)})</span>}
    </span>
  )
}
