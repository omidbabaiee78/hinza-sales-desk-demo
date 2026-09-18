import './PolymerDots.css'

// Purely decorative: a handful of small circles echoing the logo's accent
// colors, meant to evoke polymer pellets / pigment granules without ever
// competing with real content. Hidden from assistive tech.
export default function PolymerDots({ className = '' }) {
  return (
    <span className={`polymer-dots ${className}`.trim()} aria-hidden="true">
      <span className="polymer-dot polymer-dot-cyan" />
      <span className="polymer-dot polymer-dot-orange" />
      <span className="polymer-dot polymer-dot-red" />
      <span className="polymer-dot polymer-dot-green" />
      <span className="polymer-dot polymer-dot-purple" />
    </span>
  )
}
