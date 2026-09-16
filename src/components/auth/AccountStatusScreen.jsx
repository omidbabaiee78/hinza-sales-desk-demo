import './Auth.css'

const VARIANTS = {
  pending: {
    title: 'در انتظار تأیید هینزا',
    message:
      'ثبت‌نام شما با موفقیت انجام شد. اطلاعات شرکت شما توسط تیم هینزا بررسی می‌شود و پس از تأیید، امکان دسترسی به سفارش‌ها، فاکتورها و سایر بخش‌ها فراهم خواهد شد.',
  },
  rejected: {
    title: 'درخواست شما تأیید نشد',
    message:
      'متأسفانه درخواست عضویت شما در حال حاضر تأیید نشده است. برای پیگیری یا ارائه اطلاعات بیشتر، لطفاً با واحد فروش هینزا تماس بگیرید.',
  },
  unknown: {
    title: 'دسترسی شما مشخص نیست',
    message:
      'برای حساب کاربری شما نقش یا وضعیت مشخصی ثبت نشده است. لطفاً با پشتیبانی هینزا تماس بگیرید.',
  },
}

export default function AccountStatusScreen({ variant, onSignOut }) {
  const content = VARIANTS[variant] || VARIANTS.unknown

  return (
    <div className="status-screen">
      <div className="status-panel">
        <h1>{content.title}</h1>
        <p>{content.message}</p>
        <button type="button" className="btn-secondary" onClick={onSignOut}>
          خروج
        </button>
      </div>
    </div>
  )
}
