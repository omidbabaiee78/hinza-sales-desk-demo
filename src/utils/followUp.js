export function isOverdue(customer) {
  if (!customer.next_follow_up) return false
  if (customer.status === 'won' || customer.status === 'lost') return false
  const today = new Date().toISOString().slice(0, 10)
  return customer.next_follow_up < today
}
