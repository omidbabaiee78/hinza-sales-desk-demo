import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import * as authService from '../lib/authService'
import { toE164Iran } from '../utils/phone'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('duplicate key')) return 'این اطلاعات قبلاً ثبت شده است.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در ثبت اطلاعات. لطفاً دوباره تلاش کنید.'
}

export function useRegisterCustomer() {
  const [submitting, setSubmitting] = useState(false)

  async function registerCustomer({
    fullName,
    companyName,
    mobile,
    email,
    province,
    city,
    password,
  }) {
    setSubmitting(true)
    try {
      const e164 = toE164Iran(mobile)
      const { user, session } = await authService.signUpWithPhone(
        e164,
        password,
      )

      if (!session || !user) {
        throw new Error(
          'ثبت‌نام انجام شد اما نیاز به تأیید دارد. لطفاً بعداً وارد شوید.',
        )
      }

      const { error: profileError } = await supabase.from('profiles').upsert(
        { id: user.id, full_name: fullName, email: email || null, phone: e164 },
        { onConflict: 'id' },
      )
      if (profileError) throw new Error(translateDbError(profileError.message))

      const { error: requestError } = await supabase
        .from('registration_requests')
        .insert({
          user_id: user.id,
          full_name: fullName,
          company_name: companyName,
          mobile: e164,
          email: email || null,
          province,
          city,
          status: 'pending',
        })
      if (requestError) throw new Error(translateDbError(requestError.message))

      return { user }
    } finally {
      setSubmitting(false)
    }
  }

  return { registerCustomer, submitting }
}
