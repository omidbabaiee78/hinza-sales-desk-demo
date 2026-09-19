import { formatRial } from '../../../utils/formatters'
import './Reports.css'

// A small, dependency-free grouped bar chart (native SVG + <title> hover
// tooltips) - reuses the app's own existing brand colors (accent blue for
// "فروش", the existing success-green token for "وصولی") rather than
// introducing a new palette for two simple series. Single shared axis
// (both series are Rial amounts), legend always shown since there are two
// series, and identity is also carried by the legend text, not color alone.
export default function SalesTrendChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="profile-empty">در این بازه فروشی ثبت نشده است.</p>
  }

  const maxValue = Math.max(1, ...data.map((d) => Math.max(d.sales, d.payments)))
  const chartHeight = 160

  return (
    <div className="reports-trend-chart">
      <div className="reports-trend-legend">
        <span className="reports-legend-item">
          <span className="reports-legend-dot sales" /> فروش
        </span>
        <span className="reports-legend-item">
          <span className="reports-legend-dot payments" /> وصولی
        </span>
      </div>

      <div className="reports-trend-bars" role="img" aria-label="نمودار روند فروش و وصولی">
        {data.map((bucket) => (
          <div className="reports-trend-bucket" key={bucket.key}>
            <div className="reports-trend-bar-pair" style={{ height: chartHeight }}>
              <div
                className="reports-trend-bar sales"
                style={{ height: `${(bucket.sales / maxValue) * 100}%` }}
                title={`فروش ${bucket.label}: ${formatRial(bucket.sales)}`}
              />
              <div
                className="reports-trend-bar payments"
                style={{ height: `${(bucket.payments / maxValue) * 100}%` }}
                title={`وصولی ${bucket.label}: ${formatRial(bucket.payments)}`}
              />
            </div>
            <span className="reports-trend-bucket-label">{bucket.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
