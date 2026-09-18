import { followUpBucket, FOLLOW_UP_BUCKET_LABELS, FOLLOW_UP_BUCKET_TONE } from '../../utils/followUps'
import '../orders/StatusBadge.css'

export default function FollowUpStatusBadge({ followUp }) {
  const bucket = followUpBucket(followUp)
  const tone = FOLLOW_UP_BUCKET_TONE[bucket] || 'neutral'
  return <span className={`order-status-badge tone-${tone}`}>{FOLLOW_UP_BUCKET_LABELS[bucket]}</span>
}
