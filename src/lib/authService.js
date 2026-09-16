import { supabase } from './supabaseClient'
import { toInternalLoginEmail } from '../utils/phone'

const ERROR_MESSAGES = {
  invalid_mobile: 'شماره موبایل معتبر نیست',
  mobile_already_registered: 'این شماره موبایل قبلاً ثبت شده است',
  weak_password: 'رمز عبور باید حداقل ۸ کاراکتر باشد',
  too_many_attempts: 'تعداد تلاش‌ها زیاد بوده است. لطفاً کمی بعد دوباره امتحان کنید',
  invalid_email: 'ایمیل واردشده معتبر نیست',
  'Invalid login credentials': 'شماره موبایل/ایمیل یا رمز عبور اشتباه است.',
}

function translateAuthError(code) {
  return ERROR_MESSAGES[code] || 'خطایی رخ داد. لطفاً بعداً دوباره تلاش کنید.'
}

async function extractFunctionErrorCode(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json()
      return body?.error || body?.code
    }
  } catch {
    // response body wasn't JSON or already consumed - fall through
  }
  return null
}

// A login identifier is either a real admin email or an Iranian mobile
// number, which is translated to the same hidden internal alias the
// customer-register edge function creates the Auth user under.
export function resolveLoginEmail(identifier) {
  const trimmed = String(identifier || '').trim()
  if (trimmed.includes('@')) return trimmed
  return toInternalLoginEmail(trimmed)
}

export async function signInWithIdentifier(identifier, password) {
  const email = resolveLoginEmail(identifier)
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw new Error(translateAuthError(error.message))
  return data
}

// Registration itself (creating the Auth user, the pending profile and the
// registration_request) happens entirely server-side in the customer-register
// edge function, which is the only place that may act with elevated
// privileges. The browser never sees a service-role key.
export async function registerCustomer(payload) {
  const { data, error } = await supabase.functions.invoke('customer-register', {
    body: payload,
  })

  if (error) {
    const code = await extractFunctionErrorCode(error)
    throw new Error(translateAuthError(code))
  }
  if (!data?.success) {
    throw new Error(translateAuthError(data?.error || data?.code))
  }
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(translateAuthError(error.message))
}

export function getSession() {
  return supabase.auth.getSession()
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback)
}
