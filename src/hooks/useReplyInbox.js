import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت پاسخ‌ها. لطفاً دوباره تلاش کنید.'
}

const LIST_LIMIT = 150

function fetchReplies() {
  return supabase
    .from('inbound_replies')
    .select('*, sales_leads(company_name, contact_name)')
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
}

// Orchestrates the /admin/replies Reply Inbox: a browsable, filterable list
// of every recorded inbound reply (mostly populated via the Outreach card's
// "ثبت پاسخ" action - see ReplyReviewModal), plus review/edit access for any
// row, confirmed or not.
export function useReplyInbox() {
  const [replies, setReplies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    async function load() {
      const { data, error: fetchError } = await fetchReplies()
      if (ignore) return
      if (fetchError) {
        setError(translateDbError(fetchError.message))
        setLoading(false)
        return
      }
      setError('')
      setReplies(data || [])
      setLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { replies, loading, error, refresh }
}
