import { formatRial } from '../utils/formatters'

// Persian given name is conventionally the FIRST word of full_name - this
// deliberately avoids guessing "آقای"/"خانم" (we don't store a gender/title
// field, and inventing one would be a fact we don't actually have).
function firstName(fullName) {
  if (!fullName) return null
  const trimmed = fullName.trim()
  return trimmed ? trimmed.split(/\s+/)[0] : null
}

function greeting(contactName) {
  const name = firstName(contactName)
  return name ? `سلام ${name} عزیز،` : 'سلام،'
}

// Deterministic variant selection: pick the first template whose
// `when()` matches the context. Order matters - most specific first.
function selectVariant(variants, ctx) {
  const match = variants.find((variant) => variant.when(ctx))
  return (match || variants[variants.length - 1]).build(ctx)
}

const TEMPLATES = {
  quoted_waiting_customer: [
    {
      when: (ctx) => ctx.stage === 1 && ctx.productSummary,
      build: (ctx) =>
        `${greeting(ctx.contactName)} قیمت ${ctx.productSummary} سفارش ${ctx.orderNumber} آماده شده. اگر تأیید بفرمایید برای آماده‌سازی اقدام می‌کنیم.`,
    },
    {
      when: (ctx) => ctx.stage === 1,
      build: (ctx) =>
        `${greeting(ctx.contactName)} قیمت سفارش ${ctx.orderNumber} آماده شده. اگر مورد تأیید هست خبر بدید تا ادامه بدیم.`,
    },
    {
      when: (ctx) => ctx.stage === 2 && ctx.productSummary,
      build: (ctx) =>
        `${greeting(ctx.contactName)} درباره قیمت ${ctx.productSummary} سفارش ${ctx.orderNumber} که پیش‌تر ارسال شد، خواستم ببینم بررسی شد یا نیاز به تغییری هست؟`,
    },
    {
      when: () => true,
      build: (ctx) =>
        `${greeting(ctx.contactName)} درباره قیمت سفارش ${ctx.orderNumber} که پیش‌تر ارسال شد، خواستم ببینم بررسی شد یا تغییری لازم داره؟`,
    },
  ],

  ready_for_delivery: [
    {
      when: () => true,
      build: (ctx) =>
        `${greeting(ctx.contactName)} سفارش ${ctx.orderNumber} آماده تحویل شده. لطفاً زمان مناسب دریافت رو بفرمایید تا هماهنگ کنیم.`,
    },
  ],

  order_confirmed: [
    {
      when: (ctx) => Boolean(ctx.contactName),
      build: (ctx) =>
        `${greeting(ctx.contactName)} سفارش ${ctx.orderNumber} تأیید شد و در حال آماده‌سازی است. اگر نکته‌ای برای هماهنگی هست بفرمایید.`,
    },
    {
      when: () => true,
      build: (ctx) => `${greeting(ctx.contactName)} سفارش ${ctx.orderNumber} تأیید شد و در حال آماده‌سازی است.`,
    },
  ],

  delivered_followup: [
    {
      when: () => true,
      build: (ctx) =>
        `${greeting(ctx.contactName)} سفارش ${ctx.orderNumber} چند روزی است که تحویل شده. همه‌چیز مطابق انتظار بود؟`,
    },
  ],

  invoice_due_soon: [
    {
      when: () => true,
      build: (ctx) =>
        `${greeting(ctx.contactName)} سررسید فاکتور ${ctx.invoiceNumber} به مبلغ ${ctx.balanceText} نزدیک شده، خواستم یادآوری کرده باشم.`,
    },
  ],

  invoice_overdue: [
    {
      when: (ctx) => ctx.stage === 1,
      build: (ctx) =>
        `${greeting(ctx.contactName)} فاکتور ${ctx.invoiceNumber} به مبلغ ${ctx.balanceText} از سررسید گذشته. اگر امکانش هست هماهنگ کنید تا تسویه انجام شود.`,
    },
    {
      when: (ctx) => ctx.stage === 2,
      build: (ctx) =>
        `${greeting(ctx.contactName)} فاکتور ${ctx.invoiceNumber} حدود یک هفته از سررسید گذشته و مانده ${ctx.balanceText} دارد. ممنون می‌شوم پیگیری بفرمایید.`,
    },
    {
      when: () => true,
      build: (ctx) =>
        `${greeting(ctx.contactName)} فاکتور ${ctx.invoiceNumber} حدود دو هفته از سررسید گذشته، مانده ${ctx.balanceText}. لطفاً در اولین فرصت هماهنگ کنید.`,
    },
  ],
}

// Builds the customer-facing draft ONLY - never includes reason_key,
// priority, confidence, internal status names, or discount/CRM language.
export function composeMessage(reasonKey, context) {
  const variants = TEMPLATES[reasonKey]
  if (!variants) return null
  return selectVariant(variants, context)
}

// Shared context shape builder for order-based rules.
export function buildOrderMessageContext({ contactName, orderNumber, productSummary, stage }) {
  return { contactName: contactName || null, orderNumber, productSummary: productSummary || '', stage }
}

// Shared context shape builder for invoice-based rules.
export function buildInvoiceMessageContext({ contactName, invoiceNumber, remainingRial, stage }) {
  return {
    contactName: contactName || null,
    invoiceNumber,
    balanceText: formatRial(remainingRial),
    stage,
  }
}
