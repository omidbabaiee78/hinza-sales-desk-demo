export const FOLLOW_UP_STATUS_LABELS = {
  open: 'باز',
  done: 'انجام شده',
  cancelled: 'لغو شده',
}

export function followUpStatusLabel(status) {
  return FOLLOW_UP_STATUS_LABELS[status] || status
}

function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Buckets a follow-up for display: closed ones keep their own status, an
// open one is "overdue"/"today"/"upcoming" based on due_at compared to the
// viewer's local clock (never by comparing raw ISO strings, since due_at is
// stored as a UTC instant).
export function followUpBucket(followUp, now = new Date()) {
  if (followUp.status !== 'open') return followUp.status
  const due = new Date(followUp.due_at)
  if (due.getTime() < now.getTime()) return 'overdue'
  if (isSameLocalDay(due, now)) return 'today'
  return 'upcoming'
}

export const FOLLOW_UP_BUCKET_LABELS = {
  overdue: 'عقب‌افتاده',
  today: 'امروز',
  upcoming: 'آینده',
  done: 'انجام شده',
  cancelled: 'لغو شده',
}

export const FOLLOW_UP_BUCKET_TONE = {
  overdue: 'danger',
  today: 'warning',
  upcoming: 'neutral',
  done: 'success',
  cancelled: 'neutral',
}
