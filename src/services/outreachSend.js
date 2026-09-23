import { supabase } from '../lib/supabaseClient'

// Browser-side trigger for the Phase 26 outreach-send Edge Function.
// Deliberately the ONLY way this app ever calls it - no credential, no
// provider token, nothing secret ever reaches this file or the browser.
// The Edge Function attaches the current admin's own session automatically
// (supabase-js sends it as the Authorization header), the same pattern
// every other server-side action in this app already uses.
//
// testMode is ALWAYS explicitly true here - this phase never exposes a way
// to trigger a production send from the UI at all (see
// ShadowSuggestionCard.jsx's own header comment).
export async function sendTestMessage(suggestionId) {
  const { data, error } = await supabase.functions.invoke('outreach-send', { body: { suggestionId, testMode: true } })
  if (error) {
    throw new Error('اجرای ارسال آزمایشی با خطا مواجه شد.')
  }
  if (data && data.ok === false && !data.reasons) {
    throw new Error('اجرای ارسال آزمایشی با خطا مواجه شد.')
  }
  return data
}
