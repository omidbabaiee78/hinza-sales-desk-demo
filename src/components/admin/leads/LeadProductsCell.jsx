export default function LeadProductsCell({ products, needNote }) {
  if ((!products || products.length === 0) && !needNote) return <span>—</span>
  const shown = (products || []).slice(0, 2)
  const extra = (products || []).length - shown.length
  return (
    <div className="lead-product-lines">
      {shown.map((p) => (
        <span key={p.id} className="lead-cell-clamp" title={`${p.code} ${p.name_fa}`}>
          {p.code} {p.name_fa}
        </span>
      ))}
      {extra > 0 && <span className="lead-product-more">+{extra} محصول</span>}
      {needNote && (!products || products.length === 0) && (
        <span className="lead-need-note-line lead-cell-clamp" title={needNote}>
          {needNote}
        </span>
      )}
    </div>
  )
}
