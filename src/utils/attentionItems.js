// Fixed display order and styling for the three simple groups the
// automatic "needs attention" list is bucketed into.
export const ATTENTION_GROUPS = [
  { key: 'action', label: 'نیاز به اقدام' },
  { key: 'waiting', label: 'منتظر مشتری' },
  { key: 'financial', label: 'مالی' },
]

export const ATTENTION_GROUP_TONE = {
  action: 'warning',
  waiting: 'neutral',
  financial: 'danger',
}

export function attentionGroupLabel(key) {
  return ATTENTION_GROUPS.find((group) => group.key === key)?.label || key
}
