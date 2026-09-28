// Simple CRM: pure helpers for the /admin/crm page. A CRM record is an
// independent copy - prefilled from a lead at most once, never written
// back to it.

export const CRM_SOURCES = {
  email_outreach: 'ایمیل خودکار',
  manual_outreach: 'تماس دستی روزانه',
  manual_entry: 'ورود دستی',
}

export const CRM_FIELDS = ['company_name', 'contact_name', 'phone', 'email', 'city', 'product_interest', 'notes', 'source']

export function emptyCrmForm() {
  return { company_name: '', contact_name: '', phone: '', email: '', city: '', product_interest: '', notes: '', source: 'manual_entry' }
}

export function crmFormFromRecord(record) {
  const form = emptyCrmForm()
  for (const key of CRM_FIELDS) form[key] = record?.[key] ?? form[key]
  return form
}

// Where the opportunity came from: ticked in Daily Manual Outreach wins
// over having been emailed; otherwise a plain manual entry.
export function guessCrmSource({ manualContacted, emailed }) {
  if (manualContacted) return 'manual_outreach'
  if (emailed) return 'email_outreach'
  return 'manual_entry'
}

export function crmFormFromLead(lead, flags = {}) {
  return {
    ...emptyCrmForm(),
    company_name: lead?.company_name || lead?.contact_name || '',
    contact_name: lead?.contact_name || '',
    phone: lead?.mobile || lead?.phone || '',
    email: lead?.email || '',
    city: lead?.city || lead?.province || '',
    source: guessCrmSource(flags),
  }
}

// Form -> row. Trims, turns blanks into null, keeps notes' line breaks.
export function crmPayload(form) {
  const row = {}
  for (const key of CRM_FIELDS) {
    const value = typeof form[key] === 'string' ? (key === 'notes' ? form[key].replace(/\s+$/, '') : form[key].trim()) : form[key]
    row[key] = value === '' || value == null ? null : value
  }
  if (!row.company_name) throw new Error('نام شرکت لازم است.')
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new Error('ایمیل معتبر نیست.')
  if (!CRM_SOURCES[row.source]) row.source = 'manual_entry'
  return row
}

const latin = (value) => String(value ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))

export function matchesCrmSearch(record, query) {
  const q = latin(query).trim().toLowerCase()
  if (!q) return true
  const digits = q.replace(/\D/g, '')
  return ['company_name', 'contact_name', 'phone', 'email', 'city', 'product_interest', 'notes'].some((key) => {
    const value = latin(record[key]).toLowerCase()
    if (value.includes(q)) return true
    return key === 'phone' && digits.length >= 3 && value.replace(/\D/g, '').includes(digits)
  })
}

export function crmErrorMessage(error) {
  if (error?.code === '23505') return 'این سرنخ قبلاً به CRM اضافه شده است.'
  if (error?.code === '42501') return 'اجازهٔ این کار را ندارید.'
  return error?.message && !error.code ? error.message : 'ذخیره انجام نشد. دوباره امتحان کنید.'
}
