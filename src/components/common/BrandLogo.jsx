import { useState } from 'react'
import { BRAND_LOGO_SRC, BRAND_NAME_FA } from '../../constants/brand'
import './BrandLogo.css'

// Falls back to a simple text mark if the real logo file isn't present yet,
// so a missing /hinza-logo.png never shows a broken-image icon.
export default function BrandLogo({ size = 'md', withText = false, className = '' }) {
  const [failed, setFailed] = useState(false)

  return (
    <span className={`brand-logo brand-logo-${size} ${className}`.trim()}>
      {failed ? (
        <span className="brand-logo-fallback" aria-hidden="true">
          HP
        </span>
      ) : (
        <img
          src={BRAND_LOGO_SRC}
          alt={`لوگوی ${BRAND_NAME_FA}`}
          onError={() => setFailed(true)}
        />
      )}
      {withText && <span className="brand-logo-text">{BRAND_NAME_FA}</span>}
    </span>
  )
}
