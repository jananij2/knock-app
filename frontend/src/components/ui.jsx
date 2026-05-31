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

// ---- voice input (Web Speech API) — append dictated text to any field ----
// Reusable across every text field. Renders nothing where unsupported.
export function MicButton({ onText, label = 'Dictate' }) {
  const [rec, setRec] = useState(false)
  const [noSupport, setNoSupport] = useState(false)
  const ref = useRef(null)

  // Always render the button (Safari/iOS lacks SpeechRecognition — previously
  // returning null hid it on mobile). Detect support on tap instead.
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
    const r = new SR()
    r.lang = 'en-US'
    r.interimResults = false
    r.onresult = (e) => {
      const t = Array.from(e.results).map((x) => x[0].transcript).join(' ').trim()
      if (t) onText(t)
    }
    r.onend = () => setRec(false)
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

// Append helper for the common "add dictation to a textarea value" pattern.
export const appendText = (setter) => (t) =>
  setter((v) => (v && v.trim() ? `${v} ${t}` : t))

// ---- follow-up send requires a 1-second hold (prevents accidental sends) ----
// Shared between the in-job thread and the inbox thread view.
export function HoldToSend({ jobId, onSent }) {
  const [text, setText] = useState('')
  const [pct, setPct] = useState(0)
  const timer = useRef(null)
  const start = useRef(0)

  function begin() {
    if (!text.trim()) return
    start.current = performance.now()
    timer.current = setInterval(() => {
      const p = Math.min(100, ((performance.now() - start.current) / 1000) * 100)
      setPct(p)
      if (p >= 100) fire()
    }, 30)
  }
  function cancel() {
    clearInterval(timer.current)
    setPct(0)
  }
  async function fire() {
    clearInterval(timer.current)
    setPct(0)
    const msg = await api.sendMessage(jobId, text.trim())
    onSent(msg)
    setText('')
  }

  return (
    <div style={{ marginTop: 10 }}>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Follow-up message…" />
      <div style={{ marginTop: 8 }}><MicButton onText={appendText(setText)} /></div>
      <button
        className="btn primary hold"
        style={{ marginTop: 8 }}
        disabled={!text.trim()}
        onPointerDown={begin}
        onPointerUp={cancel}
        onPointerLeave={cancel}
      >
        <span className="fill" style={{ width: `${pct}%` }} />
        Hold to send (1s)
      </button>
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
          {editable && !failed && <MicButton onText={appendText(setValue)} />}
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
