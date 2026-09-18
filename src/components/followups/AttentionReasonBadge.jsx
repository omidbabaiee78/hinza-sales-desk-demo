import { ATTENTION_GROUP_TONE } from '../../utils/attentionItems'
import '../orders/StatusBadge.css'

export default function AttentionReasonBadge({ item }) {
  const tone = ATTENTION_GROUP_TONE[item.group] || 'neutral'
  return <span className={`order-status-badge tone-${tone}`}>{item.reason}</span>
}
