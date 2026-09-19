import { computeNextBestAction } from '../../../utils/leadIntelligence'

export default function LeadNextActionBadge({ lead }) {
  return <span className="lead-next-action">{computeNextBestAction(lead)}</span>
}
