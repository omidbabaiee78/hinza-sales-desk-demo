import { useState } from 'react'
import { useLeadDetail } from '../../../hooks/useLeadDetail'
import { useCompanyDirectory } from '../../../hooks/useCompanyDirectory'
import { useAdminProfiles } from '../../../hooks/useAdminProfiles'
import { useSalesLeads } from '../../../hooks/useSalesLeads'
import { formatJalaliDate, formatJalaliDateTime } from '../../../utils/formatters'
import { leadPreferredChannelLabel, leadPriorityLabel, leadSourceLabel } from '../../../utils/leadStatus'
import LoadingScreen from '../../common/LoadingScreen'
import ErrorBanner from '../../common/ErrorBanner'
import LeadStatusBadge from './LeadStatusBadge'
import LeadFollowUpBadge from './LeadFollowUpBadge'
import LeadQuickContact from './LeadQuickContact'
import LeadActivityTimeline from './LeadActivityTimeline'
import LeadReadinessBadge from './LeadReadinessBadge'
import LeadNextActionBadge from './LeadNextActionBadge'
import LeadChannelIcons from './LeadChannelIcons'
import LeadFormModal from './LeadFormModal'
import LeadActivityFormModal from './LeadActivityFormModal'
import LeadStatusChangeModal from './LeadStatusChangeModal'
import LeadLostModal from './LeadLostModal'
import LeadConvertModal from './LeadConvertModal'
import '../../common/DataTable.css'
import './Leads.css'

const QUICK_ACTIVITY_BUTTONS = [
  { type: 'phone', label: 'ثبت تماس' },
  { type: 'note', label: 'ثبت یادداشت' },
  { type: 'meeting', label: 'ثبت جلسه' },
  { type: 'sample', label: 'ثبت نمونه' },
  { type: 'quote', label: 'ثبت قیمت' },
  { type: 'followup', label: 'ثبت پیگیری' },
]

export default function AdminLeadDetailPage({ leadId, onBack, onOpenCustomer }) {
  const { lead, products, activities, loading, error, refresh } = useLeadDetail(leadId)
  const { leads } = useSalesLeads()
  const { companies } = useCompanyDirectory()
  const { admins } = useAdminProfiles()

  const [activeModal, setActiveModal] = useState(null) // 'edit' | 'status' | 'lost' | 'convert' | activityType

  if (loading) return <LoadingScreen text="در حال بارگذاری سرنخ..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!lead) return null

  const isTerminal = lead.status === 'converted' || lead.status === 'lost'
  const assignedAdmin = admins.find((a) => a.id === lead.assigned_to)

  function closeModal() {
    setActiveModal(null)
  }

  function handleSavedAndClose() {
    closeModal()
    refresh()
  }

  return (
    <div className="lead-detail">
      <div className="page-toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <h2>
          {lead.company_name || lead.contact_name} <LeadStatusBadge status={lead.status} />
          {lead.do_not_contact && <span className="lead-status-badge tone-lost">عدم تماس</span>}
        </h2>
      </div>

      <div className="lead-detail-grid">
        <section className="lead-detail-card">
          <h3>هوش سرنخ</h3>
          <LeadReadinessBadge lead={lead} showReasons />
          <div className="info-row">
            <span className="info-label">اقدام پیشنهادی</span>
            <span className="info-value">
              <LeadNextActionBadge lead={lead} />
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">کانال‌های در دسترس</span>
            <span className="info-value">
              <LeadChannelIcons lead={lead} />
            </span>
          </div>
          {lead.import_batch_id && (
            <div className="info-row">
              <span className="info-label">منبع ورود</span>
              <span className="info-value">
                وارد شده از فایل (ردیف {lead.source_row_number || '—'})
              </span>
            </div>
          )}
        </section>

        <section className="lead-detail-card">
          <h3>اطلاعات سرنخ</h3>
          <div className="info-row">
            <span className="info-label">نام شرکت</span>
            <span className="info-value">{lead.company_name || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">شخص تماس</span>
            <span className="info-value">{lead.contact_name || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">موبایل</span>
            <span className="info-value" dir="ltr">
              {lead.mobile || '—'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">تلفن</span>
            <span className="info-value" dir="ltr">
              {lead.phone || '—'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">ایمیل</span>
            <span className="info-value" dir="ltr">
              {lead.email || '—'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">وب‌سایت</span>
            <span className="info-value" dir="ltr">
              {lead.website ? (
                <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer">
                  {lead.website}
                </a>
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">استان / شهر</span>
            <span className="info-value">
              {[lead.province, lead.city].filter(Boolean).join(' / ') || '—'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">آدرس</span>
            <span className="info-value">{lead.address || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">صنعت</span>
            <span className="info-value">{lead.industry || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">منبع</span>
            <span className="info-value">{leadSourceLabel(lead.source)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">اولویت</span>
            <span className="info-value">{leadPriorityLabel(lead.priority)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">کانال ترجیحی</span>
            <span className="info-value">{leadPreferredChannelLabel(lead.preferred_channel)}</span>
          </div>
          {lead.tags && lead.tags.length > 0 && (
            <div className="info-row">
              <span className="info-label">تگ‌ها</span>
              <span className="info-value">
                <div className="lead-product-chips">
                  {lead.tags.map((tag) => (
                    <span key={tag} className="lead-product-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </span>
            </div>
          )}
          {assignedAdmin && (
            <div className="info-row">
              <span className="info-label">فروشنده مسئول</span>
              <span className="info-value">{assignedAdmin.full_name || '—'}</span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">محصولات موردنیاز</span>
            <span className="info-value">
              {products.length > 0 ? products.map((p) => `${p.code} ${p.name_fa}`).join('، ') : '—'}
            </span>
          </div>
          {lead.need_note && (
            <div className="info-row">
              <span className="info-label">نیاز / توضیح محصول</span>
              <span className="info-value">{lead.need_note}</span>
            </div>
          )}
          {lead.notes && (
            <div className="info-row">
              <span className="info-label">یادداشت</span>
              <span className="info-value">{lead.notes}</span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">آخرین تماس</span>
            <span className="info-value">
              {lead.last_contact_at ? formatJalaliDateTime(lead.last_contact_at) : '—'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">پیگیری بعدی</span>
            <span className="info-value">
              <LeadFollowUpBadge nextFollowUpAt={lead.next_follow_up_at} />
            </span>
          </div>
          {lead.status === 'lost' && lead.loss_reason && (
            <div className="info-row">
              <span className="info-label">دلیل از دست رفتن</span>
              <span className="info-value">{lead.loss_reason}</span>
            </div>
          )}
          {lead.status === 'converted' && (
            <div className="info-row">
              <span className="info-label">تاریخ تبدیل</span>
              <span className="info-value">{formatJalaliDate(lead.converted_at)}</span>
            </div>
          )}
        </section>

        <section className="lead-detail-card">
          <h3>اقدامات</h3>
          <div className="lead-quick-actions-grid">
            <LeadQuickContact phone={lead.mobile || lead.phone} />
            {!isTerminal &&
              QUICK_ACTIVITY_BUTTONS.map((btn) => (
                <button
                  key={btn.type}
                  type="button"
                  className="btn-secondary"
                  onClick={() => setActiveModal(btn.type)}
                >
                  {btn.label}
                </button>
              ))}
            {!isTerminal && (
              <button type="button" className="btn-secondary" onClick={() => setActiveModal('status')}>
                تغییر وضعیت
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setActiveModal('edit')}>
              ویرایش
            </button>
            {!isTerminal && (
              <>
                <button type="button" className="btn-primary" onClick={() => setActiveModal('convert')}>
                  تبدیل به مشتری
                </button>
                <button
                  type="button"
                  className="btn-link btn-link-danger"
                  onClick={() => setActiveModal('lost')}
                >
                  از دست رفته
                </button>
              </>
            )}
            {lead.status === 'converted' && lead.converted_company_id && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => onOpenCustomer(lead.converted_company_id)}
              >
                مشاهده مشتری
              </button>
            )}
          </div>
        </section>
      </div>

      <h3>تاریخچه فعالیت</h3>
      <LeadActivityTimeline activities={activities} />

      {activeModal === 'edit' && (
        <LeadFormModal
          lead={lead}
          leads={leads}
          companies={companies}
          admins={admins}
          onSaved={handleSavedAndClose}
          onCancel={closeModal}
        />
      )}
      {activeModal === 'status' && (
        <LeadStatusChangeModal
          leadId={lead.id}
          currentStatus={lead.status}
          onSaved={handleSavedAndClose}
          onCancel={closeModal}
        />
      )}
      {activeModal === 'lost' && (
        <LeadLostModal
          leadId={lead.id}
          hasFollowUp={Boolean(lead.next_follow_up_at)}
          onSaved={handleSavedAndClose}
          onCancel={closeModal}
        />
      )}
      {activeModal === 'convert' && (
        <LeadConvertModal
          lead={lead}
          companies={companies}
          onConverted={refresh}
          onOpenCustomer={onOpenCustomer}
          onCancel={closeModal}
        />
      )}
      {QUICK_ACTIVITY_BUTTONS.some((b) => b.type === activeModal) && (
        <LeadActivityFormModal
          leadId={lead.id}
          activityType={activeModal}
          onSaved={handleSavedAndClose}
          onCancel={closeModal}
        />
      )}
    </div>
  )
}
