import { FLOW, MORE_TOOLS, OVERVIEW_KEY, PAGE_LABELS } from './adminSections'

const toFa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])

// Shown at the top of every admin page: where you are, a way back to
// «نمای کلی», and Previous/Next through the workflow.
export default function AdminSectionNav({ activeKey, detailLabel, onNavigate }) {
  const index = FLOW.findIndex((p) => p.key === activeKey)
  const page = FLOW[index]
  const isTool = index === -1 && MORE_TOOLS.some((t) => t.key === activeKey)
  const prev = index > 0 ? FLOW[index - 1] : null
  const next = index >= 0 && index < FLOW.length - 1 ? FLOW[index + 1] : null

  const crumbs = []
  if (activeKey !== OVERVIEW_KEY) crumbs.push({ label: 'نمای کلی', key: OVERVIEW_KEY })
  if (isTool) crumbs.push({ label: 'ابزارهای بیشتر' })
  if (page?.group.tabs) crumbs.push({ label: page.group.label })
  crumbs.push({ label: PAGE_LABELS[activeKey] || '', key: detailLabel ? activeKey : null })
  if (detailLabel) crumbs.push({ label: detailLabel })

  return (
    <nav className="admin-section-nav" aria-label="مسیر صفحه">
      <ol className="admin-breadcrumb">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={i} aria-current={last ? 'page' : undefined}>
              {c.key && !last ? (
                <button type="button" className="btn-link" onClick={() => onNavigate(c.key)}>
                  {c.label}
                </button>
              ) : (
                <span className={last ? 'admin-breadcrumb-current' : ''}>{c.label}</span>
              )}
            </li>
          )
        })}
      </ol>

      {index >= 0 ? (
        <div className="admin-step-nav">
          {prev ? (
            <button type="button" className="btn-secondary admin-step-btn" onClick={() => onNavigate(prev.key)}>
              → قبلی: {prev.label}
            </button>
          ) : (
            <span />
          )}
          <span className="admin-step-count">
            مرحله {toFa(index + 1)} از {toFa(FLOW.length)}
          </span>
          {next ? (
            <button type="button" className="btn-secondary admin-step-btn" onClick={() => onNavigate(next.key)}>
              بعدی: {next.label} ←
            </button>
          ) : (
            <span />
          )}
        </div>
      ) : (
        <div className="admin-step-nav">
          <button type="button" className="btn-secondary admin-step-btn" onClick={() => onNavigate(OVERVIEW_KEY)}>
            → بازگشت به نمای کلی
          </button>
        </div>
      )}
    </nav>
  )
}
