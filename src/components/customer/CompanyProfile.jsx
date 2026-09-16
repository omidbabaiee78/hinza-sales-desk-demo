import { formatJalaliDate } from '../../utils/formatters'
import './CompanyProfile.css'

function InfoRow({ label, value, ltr }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value" dir={ltr ? 'ltr' : undefined}>
        {value || '—'}
      </span>
    </div>
  )
}

export default function CompanyProfile({ profile, company }) {
  return (
    <div className="profile-grid">
      <section className="profile-card">
        <h2>اطلاعات نماینده</h2>
        <InfoRow label="نام و نام خانوادگی" value={profile.full_name} />
        <InfoRow label="شماره موبایل" value={profile.phone} ltr />
        <InfoRow label="ایمیل" value={profile.email} ltr />
        <InfoRow label="تاریخ عضویت" value={formatJalaliDate(profile.created_at)} />
      </section>

      <section className="profile-card">
        <h2>اطلاعات شرکت</h2>
        {company ? (
          <>
            <InfoRow label="نام شرکت" value={company.name} />
            <InfoRow label="استان" value={company.province} />
            <InfoRow label="شهر" value={company.city} />
          </>
        ) : (
          <p className="profile-empty">اطلاعات شرکت هنوز ثبت نشده است.</p>
        )}
      </section>
    </div>
  )
}
