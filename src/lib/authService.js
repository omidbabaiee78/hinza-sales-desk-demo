import { supabase } from './supabaseClient'

function translateAuthError(message) {
  const map = {
    'Invalid login credentials': 'شماره موبایل یا رمز عبور اشتباه است.',
    'User already registered': 'کاربری با این شماره موبایل قبلاً ثبت‌نام کرده است.',
    'Phone not confirmed': 'شماره موبایل شما هنوز تأیید نشده است.',
    'Password should be at least 6 characters':
      'رمز عبور باید حداقل ۶ کاراکتر باشد.',
    'Unable to validate phone number: invalid format':
      'شماره موبایل نامعتبر است.',
  }
  return map[message] || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
}

// Phone + password auth today. Kept behind this module so an OTP/SMS
// verification step can be inserted later without changing any caller.
export async function signInWithPhone(phone, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    phone,
    password,
  })
  if (error) throw new Error(translateAuthError(error.message))
  return data
}

export async function signUpWithPhone(phone, password) {
  const { data, error } = await supabase.auth.signUp({ phone, password })
  if (error) throw new Error(translateAuthError(error.message))
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
