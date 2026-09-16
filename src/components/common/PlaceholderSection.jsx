export default function PlaceholderSection({ title, description }) {
  return (
    <div className="placeholder-section">
      <h2>{title}</h2>
      <p>{description || 'این بخش به‌زودی راه‌اندازی می‌شود.'}</p>
    </div>
  )
}
