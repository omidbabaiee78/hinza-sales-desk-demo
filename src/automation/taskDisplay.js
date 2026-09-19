// Display-only helpers - resolving "who" a task is about from whichever
// source FK it carries. Falls back to the task's own stored `context`
// (captured at creation time) when the live lookup map doesn't have the
// record for some reason, so a card never shows a blank name.
export function resolveTaskWho(task, { leadsById, companiesById, ordersById, invoicesById, suggestionsById }) {
  if (task.lead_id) {
    const lead = leadsById.get(task.lead_id)
    if (lead) return lead.company_name || lead.contact_name || '—'
    return task.context?.companyName || task.context?.contactName || '—'
  }
  if (task.order_id) {
    const order = ordersById.get(task.order_id)
    const company = order ? companiesById.get(order.company_id) : null
    return company?.name || '—'
  }
  if (task.invoice_id) {
    const invoice = invoicesById.get(task.invoice_id)
    const company = invoice ? companiesById.get(invoice.company_id) : null
    return company?.name || '—'
  }
  if (task.message_suggestion_id) {
    const suggestion = suggestionsById.get(task.message_suggestion_id)
    const company = suggestion ? companiesById.get(suggestion.company_id) : null
    return company?.name || '—'
  }
  if (task.company_id) {
    return companiesById.get(task.company_id)?.name || '—'
  }
  return '—'
}
