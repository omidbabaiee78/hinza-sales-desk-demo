import { useState } from 'react'
import * as authService from '../lib/authService'

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
      const result = await authService.registerCustomer({
        fullName,
        companyName,
        mobile,
        email: email || null,
        province,
        city,
        password,
      })

      await authService.signInWithIdentifier(result.loginEmail, password)

      return result
    } finally {
      setSubmitting(false)
    }
  }

  return { registerCustomer, submitting }
}
