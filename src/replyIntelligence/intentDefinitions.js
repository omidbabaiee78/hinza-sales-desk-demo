// ---------------------------------------------------------------------------
// Phase 20 - Reply Intelligence: the ONE place the reply-intent taxonomy
// lives. Every other module (classifyReply, recommendNextAction, the
// Outreach/Reply Inbox UI) reads this registry rather than hardcoding
// labels/behavior per intent - adding a new intent later means adding one
// entry here, never touching UI components.
//
// Deliberately NOT enforced by a DB CHECK constraint (see
// supabase/sql/phase20_reply_intelligence.sql) so this list can grow without
// a migration - validity is enforced here, at the single source of truth,
// and every write path (classifyReply's output, the admin override dropdown)
// only ever uses a key from this object.
// ---------------------------------------------------------------------------

export const REPLY_INTENTS = {
  interested: {
    key: 'interested',
    label: 'علاقه‌مند',
    severity: 'positive',
    suggestedAction: 'ادامه گفتگو و نیازسنجی محصول',
    actionKey: 'prepare_needs_assessment',
    requiresHumanReview: false,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: true,
  },
  price_request: {
    key: 'price_request',
    label: 'درخواست قیمت',
    severity: 'high',
    suggestedAction: 'آماده‌سازی و اعلام قیمت',
    actionKey: 'prepare_quote',
    requiresHumanReview: false,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: true,
  },
  product_question: {
    key: 'product_question',
    label: 'سؤال درباره محصول',
    severity: 'medium',
    suggestedAction: 'بررسی و پاسخ به سؤال محصول',
    actionKey: 'answer_product_question',
    requiresHumanReview: false,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: true,
  },
  sample_request: {
    key: 'sample_request',
    label: 'درخواست نمونه',
    severity: 'medium',
    suggestedAction: 'بررسی امکان ارسال نمونه',
    actionKey: 'review_sample_request',
    requiresHumanReview: false,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: true,
  },
  call_requested: {
    key: 'call_requested',
    label: 'درخواست تماس',
    severity: 'high',
    suggestedAction: 'تماس در اولین فرصت (اولویت بالا)',
    actionKey: 'create_call_task',
    requiresHumanReview: false,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: true,
  },
  follow_up_later: {
    key: 'follow_up_later',
    label: 'پیگیری در آینده',
    severity: 'medium',
    suggestedAction: 'تنظیم پیگیری برای زمان درخواستی',
    actionKey: 'set_follow_up',
    requiresHumanReview: false,
    expectsFollowUp: true,
    blocksOutreach: false,
    requiresFollowThroughAction: false,
  },
  not_now: {
    key: 'not_now',
    label: 'فعلاً نیاز ندارد',
    severity: 'low',
    suggestedAction: 'پیگیری در آینده نزدیک',
    actionKey: 'schedule_later_follow_up',
    requiresHumanReview: false,
    expectsFollowUp: true,
    blocksOutreach: false,
    requiresFollowThroughAction: false,
  },
  not_interested: {
    key: 'not_interested',
    label: 'عدم تمایل',
    severity: 'medium',
    suggestedAction: 'کاهش پیگیری فعال - مسدود نشود مگر با تأیید جداگانه',
    actionKey: 'reduce_outreach',
    requiresHumanReview: true,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: false,
  },
  do_not_contact: {
    key: 'do_not_contact',
    label: 'درخواست عدم تماس',
    severity: 'critical',
    suggestedAction: 'توقف کامل تماس پس از تأیید ادمین',
    actionKey: 'block_contact',
    requiresHumanReview: true,
    expectsFollowUp: false,
    blocksOutreach: true,
    requiresFollowThroughAction: false,
  },
  wrong_contact: {
    key: 'wrong_contact',
    label: 'مخاطب/شماره اشتباه',
    severity: 'high',
    suggestedAction: 'توقف تماس تا اصلاح اطلاعات تماس',
    actionKey: 'mark_wrong_contact',
    requiresHumanReview: true,
    expectsFollowUp: false,
    blocksOutreach: true,
    requiresFollowThroughAction: false,
  },
  already_supplied: {
    key: 'already_supplied',
    label: 'همکاری با تأمین‌کننده دیگر',
    severity: 'low',
    suggestedAction: 'پیگیری بلندمدت، بدون اقدام فوری',
    actionKey: 'long_term_follow_up',
    requiresHumanReview: false,
    expectsFollowUp: true,
    blocksOutreach: false,
    requiresFollowThroughAction: false,
  },
  needs_more_information: {
    key: 'needs_more_information',
    label: 'نیاز به اطلاعات بیشتر',
    severity: 'medium',
    suggestedAction: 'ارسال اطلاعات تکمیلی',
    actionKey: 'provide_more_information',
    requiresHumanReview: false,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: true,
  },
  unknown: {
    key: 'unknown',
    label: 'نامشخص',
    severity: 'low',
    suggestedAction: 'بررسی دستی پاسخ',
    actionKey: 'manual_review',
    requiresHumanReview: true,
    expectsFollowUp: false,
    blocksOutreach: false,
    requiresFollowThroughAction: false,
  },
}

export const REPLY_INTENT_KEYS = Object.keys(REPLY_INTENTS)

export function getIntentDefinition(intentKey) {
  return REPLY_INTENTS[intentKey] || REPLY_INTENTS.unknown
}

export function intentLabel(intentKey) {
  return getIntentDefinition(intentKey).label
}
