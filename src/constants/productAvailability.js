// availability is stock status, kept separate from `active` (customer
// visibility) - a hidden/inactive product never reaches the customer
// catalog regardless of its availability value.
export const AVAILABILITY_LABELS = {
  available: 'موجود',
  made_to_order: 'سفارشی',
  unavailable: 'ناموجود',
}

export const AVAILABILITY_OPTIONS = [
  { value: 'available', label: 'موجود' },
  { value: 'made_to_order', label: 'سفارشی' },
  { value: 'unavailable', label: 'ناموجود' },
]

export const AVAILABILITY_TONE = {
  available: 'success',
  made_to_order: 'warning',
  unavailable: 'danger',
}

export function availabilityLabel(availability) {
  return AVAILABILITY_LABELS[availability] || AVAILABILITY_LABELS.available
}
