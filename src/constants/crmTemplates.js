import { formatQuantity } from '../utils/formatters'

// "سفارش 001003" or, when the order's products are known, "سفارش 001003 –
// مستربچ سفید 7101" - productSummary is already pre-built (up to 2 products
// + "و X محصول دیگر") by summarizeOrderProducts, so this just appends it.
function orderReference(orderNumber, productSummary) {
  return productSummary ? `سفارش ${orderNumber} – ${productSummary}` : `سفارش ${orderNumber}`
}

// Short, professional, human Persian templates - the admin can still edit
// the generated text before sending (message preview modal always lets them).
const TEMPLATES = {
  quote_followup: ({ customerName, orderNumber, productSummary }) =>
    `سلام ${customerName} عزیز،\nدر خصوص ${orderReference(orderNumber, productSummary)} و قیمت اعلام‌شده خواستم پیگیری کنم.\nدر صورت نیاز به راهنمایی یا اصلاح سفارش در خدمت شما هستیم.\nهینزا پلیمر`,
  payment_followup: ({ customerName, invoiceNumber, outstandingAmount }) =>
    `سلام ${customerName} عزیز،\nیادآوری بابت مانده فاکتور ${invoiceNumber} به مبلغ ${formatQuantity(outstandingAmount)} ریال.\nدر صورت انجام پرداخت لطفاً این پیام را نادیده بگیرید.\nسپاس\nهینزا پلیمر`,
  inactive_followup: ({ customerName }) =>
    `سلام ${customerName} عزیز،\nوقت بخیر.\nمدتی از آخرین همکاری ما گذشته و خواستم برای نیاز جدید مجموعه شما در خصوص مواد و مستربچ پیگیری کنم.\nهینزا پلیمر`,
  order_followup: ({ customerName, orderNumber, productSummary }) =>
    `سلام ${customerName} عزیز،\nدر خصوص ${orderReference(orderNumber, productSummary)} جهت پیگیری با شما در تماس هستیم.\nدر صورت نیاز به هماهنگی بیشتر در خدمت شما هستیم.\nهینزا پلیمر`,
  general: ({ customerName }) => `سلام ${customerName} عزیز،\nوقت بخیر.\nهینزا پلیمر`,
}

export function buildCrmMessage(templateKey, vars) {
  const build = TEMPLATES[templateKey] || TEMPLATES.general
  return build(vars || {})
}
