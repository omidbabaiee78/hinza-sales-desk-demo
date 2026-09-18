import { BRAND_NAME_FA, CONTACT, telHref, whatsappHref, websiteHref } from '../../constants/brand'
import BrandLogo from './BrandLogo'
import PolymerDots from './PolymerDots'
import Footer from './Footer'
import QuickContact from './QuickContact'
import './ContactPage.css'

export default function ContactPage({ onBack }) {
  return (
    <div className="contact-page">
      <div className="contact-card">
        <button type="button" className="btn-secondary contact-back" onClick={onBack}>
          بازگشت
        </button>

        <BrandLogo size="lg" />
        <h1>تماس با هینزا</h1>
        <p className="contact-brand-name">{BRAND_NAME_FA}</p>
        <PolymerDots className="contact-dots" />

        <div className="contact-list">
          <div className="contact-row contact-row-primary">
            <div>
              <span className="contact-label">موبایل فروش</span>
              <span className="contact-value" dir="ltr">
                {CONTACT.mobile}
              </span>
            </div>
            <a className="btn-primary" href={telHref(CONTACT.mobile)}>
              تماس با فروش
            </a>
          </div>

          <div className="contact-row">
            <div>
              <span className="contact-label">واتساپ</span>
              <span className="contact-value" dir="ltr">
                {CONTACT.mobile}
              </span>
            </div>
            <a
              className="btn-secondary"
              href={whatsappHref(CONTACT.whatsappIntl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              واتساپ
            </a>
          </div>

          <div className="contact-row">
            <div>
              <span className="contact-label">تلفن دفتر</span>
              <span className="contact-value" dir="ltr">
                {CONTACT.office}
              </span>
            </div>
            <a className="btn-secondary" href={telHref(CONTACT.office)}>
              تماس با دفتر
            </a>
          </div>

          <div className="contact-row">
            <div>
              <span className="contact-label">وب‌سایت</span>
              <span className="contact-value" dir="ltr">
                {CONTACT.website}
              </span>
            </div>
            <a
              className="btn-secondary"
              href={websiteHref(CONTACT.website)}
              target="_blank"
              rel="noopener noreferrer"
            >
              وب‌سایت
            </a>
          </div>
        </div>
      </div>

      <Footer />
      <QuickContact />
    </div>
  )
}
