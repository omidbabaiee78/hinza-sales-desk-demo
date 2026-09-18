// Presentation-only helper: the balance NUMBER always comes straight from
// the company_balance_rial RPC. This just decides how to word/tone it.
export function describeBalance(balanceRial) {
  const value = Number(balanceRial) || 0
  if (value > 0) return { label: 'مانده قابل پرداخت', amount: value, tone: 'warning' }
  if (value < 0) return { label: 'بستانکار', amount: Math.abs(value), tone: 'success' }
  return { label: 'تسویه', amount: 0, tone: 'success' }
}
