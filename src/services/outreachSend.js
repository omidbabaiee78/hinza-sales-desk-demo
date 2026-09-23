import { supabase } from '../lib/supabaseClient'

// Browser-side trigger for the Phase 26 outreach-send Edge Function.
// Deliberately the ONLY way this app ever calls it - no credential, no
// provider token, nothing secret ever reaches this file or the browser.
// The Edge Function attaches the current admin's own session automatically
// (supabase-js sends it as the Authorization header), the same pattern
// every other server-side action in this app already uses.
//
async function invokeOutreachSend(suggestionId, testMode, failureMessage) {
  const { data, error } = await supabase.functions.invoke('outreach-send', { body: { suggestionId, testMode } })
  if (error) {
    throw new Error(failureMessage)
  }
  if (data && data.ok === false && !data.reasons) {
    throw new Error(failureMessage)
  }
  return data
}

// Always explicitly testMode:true - goes to the EMAIL_TEST_RECIPIENT secret,
// never the prospect.
export function sendTestMessage(suggestionId) {
  return invokeOutreachSend(suggestionId, true, 'اجرای ارسال آزمایشی با خطا مواجه شد.')
}

// The controlled first-email action: one admin-confirmed email for one
// approved suggestion (the UI only offers it for channel 'email'). Every
// server-side check in sendGate.js still applies - outreach_enabled and
// email_provider_enabled must be on, and while provider_test_mode is on the
// server redirects this to the test recipient anyway. The returned
// `testMode` says which actually happened.
export function sendFirstEmail(suggestionId) {
  return invokeOutreachSend(suggestionId, false, 'اجرای ارسال ایمیل با خطا مواجه شد.')
}
