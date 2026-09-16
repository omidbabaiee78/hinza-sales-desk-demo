import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('duplicate key')) return 'این رکورد قبلاً ثبت شده است.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در ارتباط با پایگاه داده. لطفاً دوباره تلاش کنید.'
}

async function fetchCustomers() {
  return supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })
}

export function useCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    fetchCustomers().then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setCustomers(data)
      }
      setLoading(false)
    })

    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  async function addCustomer(customer) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error: insertError } = await supabase
      .from('customers')
      .insert({ ...customer, user_id: user.id })
      .select()
      .single()

    if (insertError) throw new Error(translateDbError(insertError.message))
    setCustomers((prev) => [data, ...prev])
    return data
  }

  async function updateCustomer(id, updates) {
    const { data, error: updateError } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw new Error(translateDbError(updateError.message))
    setCustomers((prev) => prev.map((c) => (c.id === id ? data : c)))
    return data
  }

  async function deleteCustomer(id) {
    const { error: deleteError } = await supabase
      .from('customers')
      .delete()
      .eq('id', id)

    if (deleteError) throw new Error(translateDbError(deleteError.message))
    setCustomers((prev) => prev.filter((c) => c.id !== id))
  }

  return {
    customers,
    loading,
    error,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    refresh,
  }
}
