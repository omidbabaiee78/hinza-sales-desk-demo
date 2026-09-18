import { CONTACT, telHref, whatsappHref } from '../../constants/brand'
import './SupportBox.css'

export default function SupportBox() {
  return (
    <div className="support-box">
      <span className="support-box-text">نیاز به راهنمایی دارید؟</span>
      <div className="support-box-actions">
        <a className="btn-secondary" href={telHref(CONTACT.mobile)}>
          تماس
        </a>
        <a
          className="btn-secondary"
          href={whatsappHref(CONTACT.whatsappIntl)}
          target="_blank"
          rel="noopener noreferrer"
        >
          واتساپ
        </a>
      </div>
    </div>
  )
}
