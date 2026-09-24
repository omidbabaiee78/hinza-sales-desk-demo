import { BRAND_NAME_FA, CONTACT } from '../constants/brand.js'
import { normalizeEmail } from '../prospecting/normalization.js'
import { extractEvidence, matchedIndustryKeys } from '../prospecting/evidenceEngine.js'
import { suggestProductFit } from '../prospecting/productFit.js'
import { TARGET_INDUSTRIES } from '../prospecting/industryTaxonomy.js'
import { sanitizeIndustryLabelsForCustomerFacing } from './shadowMessageComposer.js'
import { sendIdempotencyKey } from './sendGate.js'
import { qualifyingAttempts } from './cooldown.js'
import { hasUsableText } from './shared.js'
import { tehranDateKey } from '../utils/leadFollowUp.js'

// ---------------------------------------------------------------------------
// Email outreach - the pure rules shared by the runner (autoEmailPipeline.js)
// and the admin page, so both always agree on what happened to each lead.
//
// Every lead ends up in exactly one state:
//   sent      - the intro reached the provider for this lead's address
//   queued    - an approved intro email is waiting for the next send slot
//   ready     - eligible; the next run queues it
//   attention - needs a human: no_email, invalid_email, opted_out, failed,
//               uncertain (never retried automatically), bounced
//   skipped   - deliberately not emailed: closed (converted/lost),
//               already_in_contact (a logged contact, or the lead has moved
//               past «new» - negotiating, sample, quote...), duplicate_address,
//               dismissed
// One intro per normalized ADDRESS: an address that was sent, failed,
// uncertain or claimed (email_outreach_recipients) is never emailed again,
// whichever lead it belongs to.
// ---------------------------------------------------------------------------

export const AUTO_EMAIL_DEFAULT_LIMIT = 3
export const AUTO_EMAIL_MAX_LIMIT = 10
export const AUTO_EMAIL_DEFAULT_DAILY_CAP = 20
export const MAX_QUEUE_PER_RUN = 50

export function resolveAutoEmailLimit(settings) {
  const raw = Number(settings?.auto_email_max_per_run)
  if (!Number.isFinite(raw) || raw < 1) return AUTO_EMAIL_DEFAULT_LIMIT
  return Math.min(Math.floor(raw), AUTO_EMAIL_MAX_LIMIT)
}

export function resolveDailyCap(settings) {
  const raw = Number(settings?.auto_email_daily_cap)
  if (!Number.isFinite(raw) || raw < 1) return AUTO_EMAIL_DEFAULT_DAILY_CAP
  return Math.min(Math.floor(raw), 100)
}

// Real sends that count toward today's cap (Tehran calendar day): claimed
// (in flight), sent or uncertain - never a definite failure. The database
// function claim_email_outreach_recipient() applies the same rule and is
// what actually enforces it; this is for display and reports.
const COUNTS_TOWARD_CAP = new Set(['claimed', 'sent', 'uncertain'])

export function countSentToday(recipients, now = new Date()) {
  const today = tehranDateKey(now)
  return (recipients || []).filter((r) => COUNTS_TOWARD_CAP.has(r.status) && r.claimed_at && tehranDateKey(new Date(r.claimed_at)) === today).length
}

export const EMAIL_STATE_REASONS = {
  no_email: 'ایمیل ندارد',
  invalid_email: 'ایمیل نامعتبر است',
  opted_out: 'لغو دریافت / عدم تماس',
  failed: 'ارسال ناموفق (سرویس ایمیل رد کرد)',
  uncertain: 'نتیجه ارسال نامشخص است - ارسال مجدد خودکار انجام نمی‌شود',
  bounced: 'ایمیل تحویل نشد (bounce/شکایت)',
  closed: 'سرنخ تبدیل‌شده یا ازدست‌رفته است',
  already_in_contact: 'قبلاً با این سرنخ تماس گرفته شده یا در حال پیگیری است (ایمیل معرفی لازم نیست)',
  duplicate_address: 'این نشانی قبلاً برای سرنخ دیگری استفاده شده است',
  dismissed: 'پیشنهاد ایمیل این سرنخ توسط ادمین رد شده است',
}

// Leads that are never emailed, with the reason shown on the «ردشده» tab.
export const SKIP_KINDS = new Set(['no_email', 'invalid_email', 'opted_out', 'closed', 'already_in_contact', 'duplicate_address', 'dismissed'])

export const EMAIL_STATE_ACTIONS = {
  no_email: 'در صفحه سرنخ، ایمیل شرکت را اضافه کنید.',
  invalid_email: 'در صفحه سرنخ، ایمیل را اصلاح کنید (فقط یک نشانی).',
  opted_out: 'اقدامی لازم نیست؛ به این نشانی ایمیل ارسال نمی‌شود.',
  failed: 'نشانی را بررسی و در صورت نیاز دستی تماس بگیرید.',
  uncertain: 'وضعیت را در داشبورد Resend با شناسه پیام بررسی کنید؛ سیستم خودکار دوباره نمی‌فرستد.',
  bounced: 'نشانی را اصلاح کنید یا از راه دیگری تماس بگیرید.',
}

// Statuses come only from Resend (resend-webhook). A hard bounce or
// complaint also suppresses the address (recipient.suppressed_at).
const BAD_PROVIDER_STATUSES = new Set(['bounced', 'complained', 'failed', 'canceled'])

function isBounced(attempt, recipient) {
  return BAD_PROVIDER_STATUSES.has(attempt?.provider_status) || Boolean(recipient?.suppressed_at)
}

export function leadSource(lead) {
  return (lead?.tags || []).includes('prospecting') ? 'discovered' : 'manual'
}

function byCreatedAt(a, b) {
  return String(a.created_at || '').localeCompare(String(b.created_at || ''))
}

function latest(rows) {
  return rows.reduce((best, r) => (!best || String(r.updated_at || r.created_at) > String(best.updated_at || best.created_at) ? r : best), null)
}

export function buildEmailOutreachState({ leads = [], suggestions = [], attempts = [], recipients = [], replies = [] }) {
  const recipientByAddress = new Map(recipients.map((r) => [r.normalized_email, r]))
  const emailSuggestionsByLead = new Map()
  for (const s of suggestions) {
    if (s.channel !== 'email') continue
    const list = emailSuggestionsByLead.get(s.lead_id) || []
    list.push(s)
    emailSuggestionsByLead.set(s.lead_id, list)
  }
  const attemptsByLead = new Map()
  for (const a of attempts) {
    const list = attemptsByLead.get(a.lead_id) || []
    list.push(a)
    attemptsByLead.set(a.lead_id, list)
  }
  const optedOutLeadIds = new Set(replies.filter((r) => r.final_intent === 'do_not_contact' || r.predicted_intent === 'do_not_contact').map((r) => r.lead_id))
  const optedOutAddresses = new Set(leads.filter((l) => l.do_not_contact).map((l) => normalizeEmail(l.email)).filter(Boolean))

  const entries = []

  for (const lead of [...leads].sort(byCreatedAt)) {
    const entry = { lead, source: leadSource(lead), email: null, state: null, kind: null, suggestion: null, attempt: null }
    entries.push(entry)
    const set = (state, kind = null) => {
      entry.state = state
      entry.kind = kind
      return entry
    }

    if (!hasUsableText(lead.email)) {
      set('attention', 'no_email')
      continue
    }
    const email = normalizeEmail(lead.email)
    entry.email = email
    if (!email) {
      set('attention', 'invalid_email')
      continue
    }

    const own = (emailSuggestionsByLead.get(lead.id) || []).sort(byCreatedAt)
    const leadAttempts = attemptsByLead.get(lead.id) || []
    const realAttemptsFor = (s) => leadAttempts.filter((a) => a.idempotency_key === sendIdempotencyKey(s.id, false))
    const realAttempts = own.flatMap(realAttemptsFor)
    const sentAttempt = latest(realAttempts.filter((a) => a.status === 'sent' && !a.test_mode))
    const recipient = recipientByAddress.get(email)

    if (sentAttempt) {
      entry.suggestion = own.find((s) => s.id === sentAttempt.suggestion_id) || null
      entry.attempt = sentAttempt
      set('sent', isBounced(sentAttempt, recipient) ? 'bounced' : null)
      continue
    }
    if (recipient && recipient.lead_id === lead.id) {
      entry.suggestion = own.find((s) => s.id === recipient.suggestion_id) || null
      entry.attempt = latest(realAttempts)
      if (recipient.status === 'sent') set('sent', isBounced(entry.attempt, recipient) ? 'bounced' : null)
      else set('attention', recipient.status === 'failed' ? 'failed' : 'uncertain')
      continue
    }
    if (recipient) {
      set('skipped', 'duplicate_address')
      continue
    }
    if (realAttempts.some((a) => a.status === 'prepared')) {
      entry.attempt = latest(realAttempts)
      set('attention', 'uncertain')
      continue
    }
    if (realAttempts.some((a) => a.status === 'failed')) {
      entry.attempt = latest(realAttempts)
      set('attention', 'failed')
      continue
    }
    if (lead.do_not_contact || optedOutLeadIds.has(lead.id) || optedOutAddresses.has(email)) {
      set('attention', 'opted_out')
      continue
    }
    if (lead.status === 'converted' || lead.status === 'lost') {
      set('skipped', 'closed')
      continue
    }
    if (lead.last_contact_at || (lead.status && lead.status !== 'new') || qualifyingAttempts(leadAttempts).length > 0) {
      set('skipped', 'already_in_contact')
      continue
    }
    const active = own.find((s) => ['approved', 'edited', 'pending'].includes(s.status) && (s.send_status || 'not_sent') === 'not_sent')
    if (!active && own.some((s) => s.status === 'dismissed')) {
      set('skipped', 'dismissed')
      continue
    }
    entry.suggestion = active || null
    set(active && ['approved', 'edited'].includes(active.status) ? 'queued' : 'ready')
  }

  // Two eligible leads with the same address: only one is emailed - the one
  // already queued, otherwise the oldest lead.
  const winners = new Map()
  for (const entry of entries) {
    if (entry.state !== 'queued' && entry.state !== 'ready') continue
    const current = winners.get(entry.email)
    if (!current || (entry.state === 'queued' && current.state !== 'queued')) winners.set(entry.email, entry)
  }
  for (const entry of entries) {
    if ((entry.state === 'queued' || entry.state === 'ready') && winners.get(entry.email) !== entry) {
      entry.state = 'skipped'
      entry.kind = 'duplicate_address'
    }
  }
  return entries
}

export function summarizeEmailOutreach(entries) {
  const counts = { sent: 0, queued: 0, ready: 0, attention: 0, skipped: 0, no_email: 0, failed: 0, bounced: 0, found: 0, not_emailed: 0 }
  for (const e of entries) {
    counts[e.state] += 1
    if (e.kind === 'no_email') counts.no_email += 1
    if (['failed', 'uncertain'].includes(e.kind)) counts.failed += 1
    if (e.kind === 'bounced') counts.bounced += 1
    if (e.lead.email_source_url) counts.found += 1
    if (SKIP_KINDS.has(e.kind)) counts.not_emailed += 1
  }
  return counts
}

// ---------------------------------------------------------------------------
// Message. Concise, formal, addressed to the company by its real name - no
// "<name> عزیز" greeting. Products/industry only from matched discovery
// evidence, always hedged; without evidence the email stays generic (and is
// still sent - missing product fit never blocks it).
// ---------------------------------------------------------------------------

export function productHintsFor({ candidate }) {
  if (!candidate) return { industryLabels: [], products: [] }
  const evidence = extractEvidence(candidate)
  const industryLabels = sanitizeIndustryLabelsForCustomerFacing(
    matchedIndustryKeys(evidence)
      .map((key) => TARGET_INDUSTRIES.find((i) => i.key === key)?.label)
      .filter(Boolean),
  )
  return { industryLabels, products: suggestProductFit(evidence).products }
}

function joinFa(list) {
  return list.filter(Boolean).slice(0, 2).join(' و ')
}

function formatOfficePhone(number) {
  return /^0\d{10}$/.test(number || '') ? `${number.slice(0, 3)}-${number.slice(3)}` : number || ''
}

export function composeAutoIntroEmail({ companyName, industryLabels = [], products = [] }) {
  const name = String(companyName || '').trim() || 'مجموعه شما'
  const industry = joinFa(sanitizeIndustryLabelsForCustomerFacing(industryLabels))
  const productList = joinFa(products)

  let fitLine = null
  if (productList) {
    fitLine = `با توجه به فعالیت ${name}${industry ? ` در حوزه ${industry}` : ''}، ${productList} ممکن است برای شما مرتبط باشد.`
  } else if (industry) {
    fitLine = `با توجه به فعالیت ${name} در حوزه ${industry}، ممکن است محصولات ما برای شما مرتبط باشد.`
  }

  const lines = [
    'با سلام و احترام،',
    '',
    `${BRAND_NAME_FA} تأمین‌کننده مستربچ و مواد پلیمری برای واحدهای تولیدی است.${fitLine ? ` ${fitLine}` : ''}`,
    `اگر ${name} در حال حاضر به این محصولات نیاز دارد، کافی است به همین ایمیل پاسخ دهید تا کاتالوگ و مشخصات فنی را ارسال کنیم.`,
    '',
    'با احترام،',
    `واحد فروش ${BRAND_NAME_FA}`,
    [formatOfficePhone(CONTACT.office), CONTACT.website].filter(Boolean).join(' | '),
  ]
  return { subject: `معرفی ${BRAND_NAME_FA} به ${name}`, message: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Next run of a simple pg_cron schedule ("M H * * *", H may be a number,
// a range a-b or a list). pg_cron runs in UTC. Returns null for anything
// more complex rather than guessing.
// ---------------------------------------------------------------------------

function parseField(field, max) {
  if (field === '*') return Array.from({ length: max + 1 }, (_, i) => i)
  const values = new Set()
  for (const part of field.split(',')) {
    const range = /^(\d+)-(\d+)$/.exec(part)
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i += 1) values.add(i)
    } else if (/^\d+$/.test(part)) values.add(Number(part))
    else return null
  }
  return [...values].filter((v) => v <= max).sort((a, b) => a - b)
}

export function nextCronRun(schedule, now = new Date()) {
  const parts = String(schedule || '').trim().split(/\s+/)
  if (parts.length !== 5 || parts.slice(2).some((p) => p !== '*')) return null
  const minutes = parseField(parts[0], 59)
  const hours = parseField(parts[1], 23)
  if (!minutes?.length || !hours?.length) return null
  for (let day = 0; day < 2; day += 1) {
    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h, m))
        if (t > now) return t
      }
    }
  }
  return null
}
