// Never blocks/merges - only informs. Admin explicitly decides whether to
// continue saving anyway. Never renders a raw UUID.
export default function LeadDuplicateWarning({ matches }) {
  if (!matches || matches.length === 0) return null
  return (
    <div className="lead-duplicate-warning">
      <p className="lead-duplicate-title">احتمالاً این سرنخ قبلاً ثبت شده است.</p>
      <ul>
        {matches.map((match) => (
          <li key={`${match.type}-${match.id}`}>
            <span className="lead-duplicate-type">{match.type === 'company' ? 'مشتری' : 'سرنخ'}</span>
            {match.label}
            {match.sub ? ` — ${match.sub}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
