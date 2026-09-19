import { availabilityLabel } from '../constants/productAvailability'

// Fixed, always-meaningful fields - only rendered when the product actually
// has a value (never an empty technical row).
export function buildProductFixedSpecs(product) {
  const rows = []
  if (product.category) rows.push({ label: 'دسته‌بندی', value: product.category })
  if (product.polymer_base) rows.push({ label: 'پایه پلیمری', value: product.polymer_base })
  if (product.applications?.length) {
    rows.push({ label: 'کاربردها', value: product.applications.join('، ') })
  }
  if (product.packaging) rows.push({ label: 'بسته‌بندی', value: product.packaging })
  rows.push({ label: 'وضعیت موجودی', value: availabilityLabel(product.availability) })
  return rows
}

// mini_specs is free-form admin-entered label/value pairs (jsonb array) -
// display order is exactly the array order the admin arranged. `limit`
// slices it for the compact card view; omit it to show everything (detail
// page). Rows missing a label or value are never rendered.
export function buildMiniSpecs(product, limit) {
  const specs = Array.isArray(product.mini_specs)
    ? product.mini_specs.filter((row) => row?.label && row?.value)
    : []
  return typeof limit === 'number' ? specs.slice(0, limit) : specs
}
