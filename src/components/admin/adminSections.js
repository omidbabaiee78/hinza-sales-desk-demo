// The one workflow this demo shows, in order. Main menu, breadcrumbs and
// Previous/Next buttons are all derived from this single list.
export const OVERVIEW_KEY = 'home'

export const GROUPS = [
  { key: 'home', label: 'نمای کلی' },
  { key: 'prospecting', label: 'کشف مشتری' },
  { key: 'leads', label: 'سرنخ‌ها' },
  {
    key: 'contact',
    label: 'ارتباط اولیه',
    defaultKey: 'outreach',
    tabs: [
      { key: 'outreach', label: 'ایمیل‌ها' },
      { key: 'channels', label: 'وضعیت کانال‌ها' },
      { key: 'replies', label: 'نتیجهٔ ارتباط' },
    ],
  },
]

// Linear order of the pages for Previous/Next.
export const FLOW = GROUPS.flatMap((group) =>
  group.tabs ? group.tabs.map((tab) => ({ ...tab, group })) : [{ key: group.key, label: group.label, group }],
)

// Older pages and technical tools: still reachable at their old URLs and
// from «ابزارهای بیشتر», but not part of the main menu.
export const MORE_TOOLS = [
  { key: 'automation', label: 'قوانین خودکار و وظایف' },
  { key: 'today', label: 'کارهای امروز (نمای قدیمی)' },
  { key: 'dashboard', label: 'داشبورد فروش (نمای قدیمی)' },
  { key: 'crm', label: 'مدیریت ارتباط با مشتری' },
  { key: 'customers', label: 'مشتریان' },
  { key: 'registrationRequests', label: 'درخواست‌های ثبت‌نام' },
  { key: 'orders', label: 'سفارش‌ها' },
  { key: 'products', label: 'محصولات' },
  { key: 'invoices', label: 'فاکتورها' },
  { key: 'payments', label: 'پرداخت‌ها' },
  { key: 'followUps', label: 'پیگیری‌ها' },
  { key: 'reports', label: 'گزارش‌ها' },
]

export const GROUPS_BY_KEY = new Map(GROUPS.map((g) => [g.key, g]))

export const GROUP_OF_KEY = (() => {
  const map = {}
  for (const group of GROUPS) {
    map[group.key] = group.key
    for (const tab of group.tabs || []) map[tab.key] = group.key
  }
  return map
})()

export const PAGE_LABELS = Object.fromEntries([...FLOW, ...MORE_TOOLS].map((p) => [p.key, p.label]))

export const ALL_VALID_KEYS = new Set([...FLOW.map((p) => p.key), ...MORE_TOOLS.map((p) => p.key)])

// /admin/<key>  or  /admin/leads/<leadId>
export function routeFromPathname(pathname) {
  const match = /^\/admin\/([a-zA-Z]+)(?:\/([0-9a-zA-Z-]+))?/.exec(pathname || '')
  const key = match && ALL_VALID_KEYS.has(match[1]) ? match[1] : OVERVIEW_KEY
  const leadId = key === 'leads' && match?.[2] ? match[2] : null
  return { key, leadId }
}
