import { BRAND_NAME_FA, CONTACT } from '../../constants/brand'
import BrandLogo from './BrandLogo'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="app-footer">
      <BrandLogo size="sm" className="app-footer-logo" />
      <span className="app-footer-brand">{BRAND_NAME_FA}</span>
      <span className="app-footer-sep">·</span>
      <span dir="ltr">{CONTACT.mobile}</span>
      <span className="app-footer-sep">·</span>
      <span dir="ltr">{CONTACT.office}</span>
      <span className="app-footer-sep">·</span>
      <span dir="ltr">{CONTACT.website}</span>
    </footer>
  )
}
