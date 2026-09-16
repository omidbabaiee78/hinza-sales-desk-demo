import './Dashboard.css'

function isFollowUpDue(customer) {
  if (!customer.next_follow_up) return false
  if (customer.status === 'won' || customer.status === 'lost') return false
  const today = new Date().toISOString().slice(0, 10)
  return customer.next_follow_up <= today
}

export default function Dashboard({ customers }) {
  const total = customers.length
  const needsFollowUp = customers.filter(isFollowUpDue).length
  const won = customers.filter((c) => c.status === 'won').length
  const lost = customers.filter((c) => c.status === 'lost').length

  const cards = [
    { label: 'کل مشتریان', value: total, tone: 'neutral' },
    { label: 'نیازمند پیگیری', value: needsFollowUp, tone: 'warning' },
    { label: 'فروش موفق', value: won, tone: 'success' },
    { label: 'از دست رفته', value: lost, tone: 'danger' },
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
