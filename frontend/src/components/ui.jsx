import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { PRIORITY_LABEL, FLAG_LEGEND } from '../constants'

// ---- top bar with optional back button ----
export function TopBar({ title, sub, onBack, back }) {
  const nav = useNavigate()
  return (
    <div className="topbar">
      {(onBack || back) && (
        <button className="back" onClick={onBack || (() => nav(back))}>
          ‹ Back
        </button>
      )}
      <h1>{title}</h1>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function PriorityBadge({ priority }) {
  return <span className={`badge ${priority}`}>{PRIORITY_LABEL[priority] || priority}</span>
}

export function StatusBadge({ status }) {
  const label = { in_progress: 'In progress', resolved: 'Resolved', escalated: 'Escalated', pending: 'Pending' }
  return <span className={`badge ${status}`}>{label[status] || status}</span>
}

// ---- flag dots (no text labels on cards) ----
export function FlagDots({ flags }) {
  const active = FLAG_LEGEND.filter((f) => flags?.[f.key])
  if (!active.length) return null
  return (
    <span className="dots">
      {active.map((f) => (
        <span key={f.key} className={`dot ${f.key}`} title={f.label} />
      ))}
    </span>
  )
}

// ---- text tags (no color coding — color is reserved for priority) ----
export function FlagTags({ flags }) {
  if (!flags) return null
  const occ = flags.checkout_imminent ? 'Checkout' : flags.occupied ? 'Occupied' : 'Vacant'
  return (
    <span className="tags">
      <span className="tag">{occ}</span>
      {flags.vip && <span className="tag">★ VIP</span>}
      {flags.repeat_issue && <span className="tag">Repeat issue</span>}
    </span>
  )
}

export function FlagLegend() {
  return (
    <div className="legend card">
      {FLAG_LEGEND.map((f) => (
        <span key={f.key} className="item">
          <span className="dot" style={{ background: f.color }} />
          {f.label}
        </span>
      ))}
    </div>
  )
}

// ---- skeleton loader (shown while Claude call is in flight) ----
export function Skeleton({ lines = 3 }) {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton line"
          style={{ width: i === lines - 1 ? '70%' : '100%' }}
        />
      ))}
    </div>
  )
}

// ---- AI draft card with provenance tag ----
export function AiCard({ title = 'AI summary', children }) {
  return (
    <div className="ai-card">
      <div className="ai-tag">✦ {title}</div>
      {children}
    </div>
  )
}

export function fmtTime(iso) {
  if (!iso) return ''
  const t = iso.includes('T') ? iso.split('T')[1] : iso
  return t.slice(0, 5)
}

export function fmtClock(iso) {
  if (!iso) return ''
  const [h, m] = (iso.includes('T') ? iso.split('T')[1] : iso).slice(0, 5).split(':')
  const hh = parseInt(h, 10)
  const ampm = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 || 12
  return `${h12}:${m} ${ampm}`
}

// ---- voice input (Web Speech API) — streams dictation into a field live ----
// Controlled via `setValue`. Each dictation session starts fresh and OVERWRITES
// the field: as the user speaks, the live transcript replaces whatever was there
// (it does not append). `onComplete(text)` fires once on stop with the dictated
// text — used where dictation also needs to do something else (e.g. post it to
// the thread). Renders everywhere (Safari/iOS lacks SpeechRecognition — detected on tap).
export function MicButton({ value = '', setValue, onComplete, label = 'Dictate' }) {
  const [rec, setRec] = useState(false)
  const [noSupport, setNoSupport] = useState(false)
  const ref = useRef(null)
  const liveRef = useRef('')   // full transcript dictated this session

  function toggle() {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
    if (!SR) {
      setNoSupport(true)
      return
    }
    if (rec) {
      ref.current?.stop()
      return
    }
    liveRef.current = ''
    const r = new SR()
    r.lang = 'en-US'
    r.interimResults = true   // emit partial words as they're recognized
    r.continuous = true       // keep listening until the tech taps stop
    r.onresult = (e) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript
      liveRef.current = transcript
      setValue?.(transcript.trim())   // overwrite the field with the live transcript
    }
    r.onend = () => {
      setRec(false)
      const t = liveRef.current.trim()
      if (t) onComplete?.(t)
    }
    r.onerror = () => setRec(false)
    ref.current = r
    r.start()
    setRec(true)
  }

  return (
    <button type="button" className={`mic ${rec ? 'rec' : ''}`} onClick={toggle} aria-label="Voice input">
      {rec ? '● Listening…' : noSupport ? '🎤 Not supported here' : `🎤 ${label}`}
    </button>
  )
}

// True when a message's content is an inline image (data URL from a photo attach).
export const isImageMsg = (c) => typeof c === 'string' && c.startsWith('data:image')

// ---- follow-up message composer (regular Send — no hold-to-send) ----
// Shared between the in-job thread and the inbox thread view. Bordered like the
// other actionable cards for visual consistency.
export function MessageComposer({ jobId, onSent }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      const msg = await api.sendMessage(jobId, text.trim())
      onSent(msg)
      setText('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="composer">
      <div className="composer-title">Follow-up message</div>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Follow-up message…" />
      <div className="msg-actions">
        <MicButton value={text} setValue={setText} />
        <button className="btn primary" disabled={!text.trim() || sending} onClick={send}>
          Send message
        </button>
      </div>
    </div>
  )
}

// ---- AI-drafted message suggestion (used on Job Detail + Resolution) ----
// Shows a draft → Send; once sent, shows "Message sent!" + "Generate new message".
export function SuggestedMessage({
  title = 'Suggested guest message',
  loading,
  failed,
  sent,
  draft,
  editable = false,
  value,
  setValue,
  onSend,
  onRegenerate,
  sendLabel = 'Send message',
  skipNote,
}) {
  if (sent) {
    return (
      <div className="ai-card">
        <div className="ai-tag">✦ {title}</div>
        <div className="sent-line">✓ Message sent!</div>
        <button type="button" className="btn secondary" onClick={onRegenerate}>
          Generate new message
        </button>
      </div>
    )
  }
  return (
    <AiCard title={title}>
      {loading ? (
        <Skeleton lines={2} />
      ) : failed ? (
        <p className="muted">Draft unavailable.</p>
      ) : editable ? (
        <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <p>{draft}</p>
      )}
      {!loading && (
        <div className="msg-actions">
          {editable && !failed && <MicButton value={value} setValue={setValue} />}
          <button
            type="button"
            className="btn primary"
            disabled={editable ? !value?.trim() : !draft}
            onClick={onSend}
          >
            {sendLabel}
          </button>
        </div>
      )}
      {skipNote && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{skipNote}</p>}
    </AiCard>
  )
}
