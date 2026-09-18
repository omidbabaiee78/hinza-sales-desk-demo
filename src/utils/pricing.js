// Loyalty and special discounts are alternatives, never additive: whichever
// is larger for this company/product is the one suggested to the admin.
export function resolveSuggestedDiscountPercent(suggestion) {
  if (!suggestion) return 0
  const loyalty = Number(suggestion.auto_discount_percent) || 0
  const special = Number(suggestion.special_discount_percent) || 0
  return Math.max(loyalty, special)
}

// How many more paid invoices remain until the loyalty discount activates,
// or null once it's already active. UI hint only - the percent itself
// always comes from the RPC.
export function invoicesUntilNextTier({
  paidInvoiceCount,
  everyPaidInvoices,
  autoDiscountPercent,
  maxAutoDiscountPercent,
}) {
  const every = Number(everyPaidInvoices) || 0
  if (!every) return null
  if (Number(autoDiscountPercent) >= Number(maxAutoDiscountPercent)) return null
  const count = Number(paidInvoiceCount) || 0
  const remainder = count % every
  return every - remainder
}
