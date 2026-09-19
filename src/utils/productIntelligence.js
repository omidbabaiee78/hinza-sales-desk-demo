// Builds "محصولات مشتری" rows from a flat list of delivered order_items,
// each already carrying the order's created_at as order_created_at. Only
// delivered orders should ever be passed in here - this file has no opinion
// on which statuses count, callers decide that (matches the app-wide rule
// that physical purchase history means delivered orders).
export function buildProductIntelligence(items) {
  const byProduct = new Map()

  for (const item of items || []) {
    if (!item.product_id) continue
    const entry = byProduct.get(item.product_id) || {
      productId: item.product_id,
      code: item.products?.code || '',
      name: item.products?.name_fa || 'محصول نامشخص',
      totalKg: 0,
      purchaseCount: 0,
      lastPurchaseAt: null,
      lastQuantityKg: null,
      lastFinalUnitPriceRial: null,
    }

    entry.totalKg += Number(item.quantity_kg) || 0
    entry.purchaseCount += 1

    const orderDate = item.order_created_at
    if (orderDate && (!entry.lastPurchaseAt || orderDate > entry.lastPurchaseAt)) {
      entry.lastPurchaseAt = orderDate
      entry.lastQuantityKg = Number(item.quantity_kg) || 0
      entry.lastFinalUnitPriceRial =
        item.unit_price_rial != null
          ? Math.round(
              Number(item.unit_price_rial) * (1 - (Number(item.discount_percent) || 0) / 100),
            )
          : null
    }

    byProduct.set(item.product_id, entry)
  }

  return [...byProduct.values()].sort((a, b) => b.totalKg - a.totalKg)
}

// Short "order product reference" for CRM messages, e.g.
// "مستربچ سفید 7101" or "مستربچ سفید 7101، مستربچ مشکی 4040 و 2 محصول دیگر".
// Reuses whatever order_items snapshot the caller already loaded - never
// issues its own query.
export function summarizeOrderProducts(items) {
  if (!items || items.length === 0) return ''

  const names = items
    .filter((item) => item.products?.name_fa || item.products?.code)
    .map((item) => {
      const name = item.products?.name_fa || 'محصول'
      return item.products?.code ? `${name} ${item.products.code}` : name
    })

  if (names.length === 0) return ''

  const shown = names.slice(0, 2)
  const extraCount = names.length - shown.length
  const summary = shown.join('، ')
  return extraCount > 0 ? `${summary} و ${extraCount} محصول دیگر` : summary
}
