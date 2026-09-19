import { useState } from 'react'
import './ProductImage.css'

// Branded placeholder (never a broken-image icon): the products table has no
// image column yet, so `src` is always undefined today and every card shows
// this fallback. If an image_url column is added later, passing it in as
// `src` starts using real photos automatically, with the same graceful
// onError fallback BrandLogo already uses.
export default function ProductImage({ src, alt, size = 'md' }) {
  const [failed, setFailed] = useState(false)
  const showImage = src && !failed

  return (
    <div className={`product-image product-image-${size}`}>
      {showImage ? (
        <img src={src} alt={alt} onError={() => setFailed(true)} />
      ) : (
        <div className="product-image-fallback" aria-hidden="true">
          <span className="product-image-dot product-image-dot-cyan" />
          <span className="product-image-dot product-image-dot-orange" />
          <span className="product-image-dot product-image-dot-red" />
        </div>
      )}
    </div>
  )
}
