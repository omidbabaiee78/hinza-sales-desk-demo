import { formatTomanEquivalent } from '../../utils/money'
import './MoneyEquivalent.css'

// Small muted "معادل: X تومان" helper line for RIAL amounts on
// customer-facing decision screens. Usability only - never the source of
// truth, and always excluded from print output by callers that render
// inside the printable invoice (via the shared .no-print class).
export default function MoneyEquivalent({ rial, className = '' }) {
  const text = formatTomanEquivalent(rial)
  if (!text) return null
  return <p className={`money-equivalent ${className}`.trim()}>{text}</p>
}
