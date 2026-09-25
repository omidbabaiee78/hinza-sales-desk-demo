import { useMemo, useState } from 'react'
import { useReplyInbox } from '../../../hooks/useReplyInbox'
import { useSalesLeads } from '../../../hooks/useSalesLeads'
import { leadDisplayName } from '../../../utils/leadStatus'
import { getIntentDefinition } from '../../../replyIntelligence/intentDefinitions'
import ErrorBanner from '../../common/ErrorBanner'
import ReplyCard from './ReplyCard'
import ReplyReviewModal from './ReplyReviewModal'
import '../../common/DataTable.css'
import '../today/Today.css'
import '../automation/Automation.css'
import './Replies.css'

const TABS = [
  { key: 'new', label: 'جدید' },
  { key: 'needs_review', label: 'نیازمند بررسی' },
  { key: 'action_needed', label: 'اقدام لازم' },
  { key: 'processed', label: 'پردازش‌شده' },
  { key: 'all', label: 'همه' },
]

function isToday(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function currentIntentOf(reply) {
  return reply.final_intent || reply.predicted_intent
}

export default function AdminReplyInboxPage({ onOpenLead }) {
  const { replies, loading, error, refresh } = useReplyInbox()
  const { leads } = useSalesLeads()

  const [activeTab, setActiveTab] = useState('new')
  const [reviewingReply, setReviewingReply] = useState(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newReplyLeadId, setNewReplyLeadId] = useState('')
  const [leadSearch, setLeadSearch] = useState('')

  const buckets = useMemo(() => {
    const newOnes = replies.filter((r) => !r.admin_confirmed)
    const needsReview = replies.filter((r) => r.confidence === 'manual_review' || r.confidence === 'low')
    const actionNeeded = replies.filter((r) => r.admin_confirmed && getIntentDefinition(currentIntentOf(r)).requiresFollowThroughAction)
    const processed = replies.filter((r) => r.admin_confirmed)
    return { new: newOnes, needs_review: needsReview, action_needed: actionNeeded, processed, all: replies }
  }, [replies])

  const counts = useMemo(
    () => ({
      needsReview: buckets.needs_review.length,
      interested: replies.filter((r) => currentIntentOf(r) === 'interested').length,
      priceRequest: replies.filter((r) => currentIntentOf(r) === 'price_request').length,
      followUpLater: replies.filter((r) => currentIntentOf(r) === 'follow_up_later' || currentIntentOf(r) === 'not_now').length,
      notInterested: replies.filter((r) => currentIntentOf(r) === 'not_interested' || currentIntentOf(r) === 'do_not_contact').length,
      today: replies.filter((r) => isToday(r.created_at)).length,
    }),
    [replies, buckets],
  )

  const visibleReplies = buckets[activeTab] || []

  const filteredLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase()
    if (!q) return leads.slice(0, 20)
    return leads.filter((l) => leadDisplayName(l).toLowerCase().includes(q)).slice(0, 20)
  }, [leads, leadSearch])

  function closeAllModals() {
    setReviewingReply(null)
    setCreatingNew(false)
    setNewReplyLeadId('')
    setLeadSearch('')
  }

  function handleSaved() {
    closeAllModals()
    refresh()
  }

  return (
    <div className="replies-page">
      <div className="page-toolbar">
        <div>
          <h2>نتیجهٔ ارتباط</h2>
          <p className="today-subtitle">پاسخ مشتری (تلفن، ایمیل یا پیام) و پیگیری بعدی را اینجا دستی ثبت کنید. سیستم خودش پاسخ نمی‌دهد و مذاکره نمی‌کند.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={refresh}>
            به‌روزرسانی
          </button>
          <button type="button" className="btn-primary" onClick={() => setCreatingNew(true)}>
            ثبت پاسخ جدید
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      <div className="today-summary-grid">
        <button type="button" className="today-summary-card tone-lost" onClick={() => setActiveTab('needs_review')}>
          <span className="today-summary-value">{loading ? '—' : counts.needsReview}</span>
          <span className="today-summary-label">نیازمند بررسی</span>
        </button>
        <button type="button" className="today-summary-card tone-won" onClick={() => setActiveTab('all')}>
          <span className="today-summary-value">{loading ? '—' : counts.interested}</span>
          <span className="today-summary-label">علاقه‌مند</span>
        </button>
        <button type="button" className="today-summary-card tone-offer" onClick={() => setActiveTab('all')}>
          <span className="today-summary-value">{loading ? '—' : counts.priceRequest}</span>
          <span className="today-summary-label">درخواست قیمت</span>
        </button>
        <button type="button" className="today-summary-card tone-contacted" onClick={() => setActiveTab('all')}>
          <span className="today-summary-value">{loading ? '—' : counts.followUpLater}</span>
          <span className="today-summary-label">پیگیری بعدی</span>
        </button>
        <button type="button" className="today-summary-card tone-lost" onClick={() => setActiveTab('all')}>
          <span className="today-summary-value">{loading ? '—' : counts.notInterested}</span>
          <span className="today-summary-label">عدم تمایل</span>
        </button>
        <button type="button" className="today-summary-card tone-contacted" onClick={() => setActiveTab('all')}>
          <span className="today-summary-value">{loading ? '—' : counts.today}</span>
          <span className="today-summary-label">امروز دریافت‌شده</span>
        </button>
      </div>

      <div className="today-filters">
        <div className="today-filter-group">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`today-chip${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="profile-empty">در حال بارگذاری...</p>}

      {!loading && visibleReplies.length === 0 && (
        <div className="today-empty-state">
          <p className="today-empty-title">پاسخی در این بخش وجود ندارد.</p>
        </div>
      )}

      {!loading && visibleReplies.length > 0 && (
        <div className="today-item-list">
          {visibleReplies.map((reply) => (
            <ReplyCard key={reply.id} reply={reply} onOpenLead={onOpenLead} onReview={setReviewingReply} />
          ))}
        </div>
      )}

      {reviewingReply && (
        <ReplyReviewModal
          mode="edit"
          existingReply={reviewingReply}
          leadId={reviewingReply.lead_id}
          companyId={reviewingReply.company_id}
          contactLabel={reviewingReply.sales_leads?.company_name || reviewingReply.sales_leads?.contact_name}
          onSaved={handleSaved}
          onCancel={closeAllModals}
        />
      )}

      {creatingNew && !newReplyLeadId && (
        <div className="modal-overlay" onClick={closeAllModals}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2>انتخاب سرنخ</h2>
            <label>
              جستجوی سرنخ
              <input
                type="text"
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                placeholder="نام شرکت یا شخص..."
                autoFocus
              />
            </label>
            <div className="today-item-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {filteredLeads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  className="btn-link"
                  style={{ display: 'block', width: '100%', textAlign: 'right', padding: '6px 0' }}
                  onClick={() => setNewReplyLeadId(lead.id)}
                >
                  {leadDisplayName(lead)}
                </button>
              ))}
              {filteredLeads.length === 0 && <p className="profile-empty">سرنخی پیدا نشد.</p>}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={closeAllModals}>
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {creatingNew && newReplyLeadId && (
        <ReplyReviewModal
          mode="capture"
          leadId={newReplyLeadId}
          defaultChannel="manual"
          contactLabel={leadDisplayName(leads.find((l) => l.id === newReplyLeadId) || {})}
          onSaved={handleSaved}
          onCancel={closeAllModals}
        />
      )}
    </div>
  )
}
