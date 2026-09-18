export const BRAND_NAME_FA = 'هینزا پلیمر'
export const BRAND_TAGLINE = 'سامانه سفارش و پیگیری مشتریان'
export const BRAND_LOGO_SRC = '/hinza-logo.png'

export const CONTACT = {
  mobile: '09122077239',
  office: '02155600104',
  website: 'hinzapolymer.com',
  // WhatsApp deep links need the international form (no leading zero).
  whatsappIntl: '989122077239',
}

export function telHref(number) {
  return `tel:${number}`
}

export function whatsappHref(intlNumber) {
  return `https://wa.me/${intlNumber}`
}

export function websiteHref(domain) {
  return `https://${domain}`
}
