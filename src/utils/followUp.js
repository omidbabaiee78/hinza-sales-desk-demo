export function isOverdue(customer) {
  if (!customer.nextFollowUp) return false
  if (customer.status === 'Won' || customer.status === 'Lost') return false
  const today = new Date().toISOString().slice(0, 10)
  return customer.nextFollowUp < today
}
