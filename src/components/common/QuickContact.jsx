import { useEffect, useRef, useState } from 'react'
import { CONTACT, telHref, whatsappHref } from '../../constants/brand'
import './QuickContact.css'

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3 0 .7-.2 1z"
      />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 2a8 8 0 0 1 6.7 12.4c-.1.2-.1.4-.1.6l.6 2.2-2.3-.6c-.2-.1-.4 0-.6.1A8 8 0 1 1 12 4zm-2.9 4.2c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.1 1.8 2.9 4.5 4 .6.3 1.1.4 1.5.5.6.2 1.2.1 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.2-.2-.5-.3-.3-.2-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.3-.7.8-.8 1-.1.1-.3.2-.5.1-.3-.2-1.1-.4-2-1.3-.7-.7-1.2-1.5-1.4-1.8-.1-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.1-.5-.1-.2-.6-1.5-.9-2-.2-.5-.4-.4-.6-.4z"
      />
    </svg>
  )
}

function OfficeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v4h5a1 1 0 0 1 1 1v11h-2v-2h-2v2h-4v-4H9v4H4zm2-2h2v-2H6v2zm0-4h2v-2H6v2zm0-4h2V9H6v2zm4 8h2v-2h-2v2zm0-4h2v-2h-2v2zm0-4h2V9h-2v2zm7 8h1v-8h-3v8h2z"
      />
    </svg>
  )
}

// Reusable floating "quick contact" control shown on public/auth/customer
// screens only (never inside the Admin experience). Pure CSS/SVG - no
// icon library, no images.
export default function QuickContact() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handleOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div className="quick-contact" ref={rootRef}>
      {open && (
        <div className="quick-contact-menu" role="menu">
          <a className="quick-contact-item" href={telHref(CONTACT.mobile)} role="menuitem">
            <PhoneIcon />
            تماس با فروش
          </a>
          <a
            className="quick-contact-item"
            href={whatsappHref(CONTACT.whatsappIntl)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
          >
            <WhatsAppIcon />
            واتساپ
          </a>
          <a className="quick-contact-item" href={telHref(CONTACT.office)} role="menuitem">
            <OfficeIcon />
            تلفن دفتر
          </a>
        </div>
      )}
      <button
        type="button"
        className="quick-contact-fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="تماس سریع"
      >
        <PhoneIcon />
        <span className="quick-contact-fab-label">تماس سریع</span>
      </button>
    </div>
  )
}
