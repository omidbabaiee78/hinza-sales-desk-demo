import { computeContactChannelReadiness } from '../../../utils/leadIntelligence'

const CHANNEL_LABELS = [
  ['whatsapp', 'واتساپ'],
  ['sms', 'پیامک'],
  ['phone', 'تماس'],
  ['email', 'ایمیل'],
  ['bale', 'بله'],
]

// Shows which channels HAVE the data needed to be used later - never implies
// a provider is connected or that a message can be sent from here.
export default function LeadChannelIcons({ lead }) {
  const readiness = computeContactChannelReadiness(lead)
  return (
    <div className="lead-channel-icons" title="این فقط نشان می‌دهد اطلاعات تماس لازم موجود است، نه اتصال به سرویس ارسال.">
      {CHANNEL_LABELS.map(([key, label]) => (
        <span key={key} className={`lead-channel-icon${readiness[key] ? ' available' : ''}`}>
          {label} {readiness[key] ? '✓' : '—'}
        </span>
      ))}
    </div>
  )
}
