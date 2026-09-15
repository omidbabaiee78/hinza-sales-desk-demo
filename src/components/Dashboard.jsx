import './Dashboard.css'

function isFollowUpDue(customer) {
  if (!customer.nextFollowUp) return false
  if (customer.status === 'Won' || customer.status === 'Lost') return false
  const today = new Date().toISOString().slice(0, 10)
  return customer.nextFollowUp <= today
}

export default function Dashboard({ customers }) {
  const total = customers.length
  const needsFollowUp = customers.filter(isFollowUpDue).length
  const won = customers.filter((c) => c.status === 'Won').length
  const lost = customers.filter((c) => c.status === 'Lost').length

  const cards = [
    { label: 'Total Customers', value: total, tone: 'neutral' },
    { label: 'Needs Follow-up', value: needsFollowUp, tone: 'warning' },
    { label: 'Won', value: won, tone: 'success' },
    { label: 'Lost', value: lost, tone: 'danger' },
  ]

  return (
    <div className="dashboard-grid">
      {cards.map((card) => (
        <div className={`dashboard-card tone-${card.tone}`} key={card.label}>
          <span className="dashboard-card-value">{card.value}</span>
          <span className="dashboard-card-label">{card.label}</span>
        </div>
      ))}
    </div>
  )
}
