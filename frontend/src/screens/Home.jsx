import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useShift } from '../ShiftContext'
import { enablePush, pushPermission, pushSupported } from '../push'
import JobCard from '../components/JobCard.jsx'
import { fmtClock } from '../components/ui'
import { HOTEL_NAME } from '../constants'

const POLL_MS = 15000

export default function Home() {
  const nav = useNavigate()
  const { shift, floorLabel, refresh } = useShift()
  const [jobs, setJobs] = useState(null)
  const [err, setErr] = useState(null)

  const seenIds = useRef(null)
  const [newIds, setNewIds] = useState(() => new Set())

  const [perm, setPerm] = useState(pushPermission())
  const [pushBusy, setPushBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [unread, setUnread] = useState(0)

  function ingest(data, initial) {
    if (initial) {
      seenIds.current = new Set(data.map((j) => j.id))
    } else if (seenIds.current) {
      const fresh = data.filter((j) => !seenIds.current.has(j.id))
      if (fresh.length) {
        setNewIds((prev) => new Set([...prev, ...fresh.map((j) => j.id)]))
        fresh.forEach((j) => seenIds.current.add(j.id))
      }
    }
    setJobs(data)
  }

  useEffect(() => {
    let active = true
    const load = (initial) =>
      api.listJobs().then((d) => active && ingest(d, initial)).catch((e) => active && setErr(e.message))
    // Unread = threads with activity since the inbox was last opened.
    const loadUnread = () => api.allThreads().then((ts) => {
      if (!active) return
      const seen = Number(localStorage.getItem('knock_inbox_seen') || 0)
      setUnread(ts.filter((t) => Date.parse(t.last_at) > seen).length)
    }).catch(() => {})
    load(true)
    loadUnread()
    refresh().catch(() => {})
    const t = setInterval(() => { load(false); loadUnread() }, POLL_MS)
    return () => { active = false; clearInterval(t) }
  }, [refresh])

  useEffect(() => {
    if (pushPermission() === 'granted') enablePush().catch(() => {})
  }, [])

  const list = jobs || []
  const counts = list.reduce(
    (a, j) => { if (j.status !== 'resolved' && j.status !== 'escalated') a[j.priority]++; return a },
    { urgent: 0, high: 0, normal: 0 },
  )
  const total = list.length
  const completed = list.filter((j) => j.status === 'resolved' || j.status === 'escalated').length
  const pct = total ? Math.round((completed / total) * 100) : 0
  const dispatched = list.filter((j) => j.source !== 'adhoc')
  const adhoc = list.filter((j) => j.source === 'adhoc')
  const noneActive = jobs && (total === 0 || completed === total)

  async function onEnablePush() {
    setPushBusy(true)
    try { setPerm(await enablePush()) } catch (e) { setErr(e.message) } finally { setPushBusy(false) }
  }

  async function doReset() {
    setResetting(true)
    try {
      await api.resetDemo()
      const d = await api.listJobs()
      setNewIds(new Set())
      seenIds.current = new Set(d.map((j) => j.id))
      setJobs(d)
      await refresh().catch(() => {})
    } catch (e) {
      setErr(e.message)
    } finally {
      setResetting(false)
      setConfirmReset(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <button className="dm-btn" onClick={() => nav('/messages')} aria-label="Messages">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {unread > 0 && <span className="dm-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <button className="map-btn" onClick={() => nav('/map')} aria-label="Floor map">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        </button>
        <div className="shift-header">
          <div className="logo">✦ Knock</div>
          <div className="brand">{HOTEL_NAME}</div>
          <div className="name">{shift?.tech_name || 'Loading…'}</div>
          <div className="sub">
            {shift ? `${fmtClock(shift.shift_start)} – ${fmtClock(shift.shift_end)}` : ''}
            {floorLabel ? ` · ${floorLabel}` : ''}
          </div>
          <div className="progress">
            <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
            <div className="label">{completed} of {total} jobs complete</div>
          </div>
        </div>
      </div>

      <div className="screen">
        <div className="top-actions">
          <button className="reset-btn" onClick={() => setConfirmReset(true)}>↺ Reset demo</button>
        </div>

        {noneActive && <div className="banner success center"><strong>No jobs for now!</strong></div>}

        {pushSupported() && perm !== 'granted' && (
          <div className="banner info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>{perm === 'denied' ? 'Notifications are blocked in your browser settings.' : 'Get notified when a new job is dispatched.'}</span>
            {perm !== 'denied' && <button className="link-btn" disabled={pushBusy} onClick={onEnablePush}>{pushBusy ? '…' : 'Enable'}</button>}
          </div>
        )}

        <div className="stats">
          <div className="stat urgent"><div className="n">{counts.urgent}</div><div className="l">High</div></div>
          <div className="stat high"><div className="n">{counts.high}</div><div className="l">Medium</div></div>
          <div className="stat normal"><div className="n">{counts.normal}</div><div className="l">Low</div></div>
        </div>

        {err && <div className="banner danger">{err}</div>}
        {!jobs && !err && <div className="muted center">Loading jobs…</div>}

        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Jobs this shift</span>
          {newIds.size > 0 && <button className="unread" onClick={() => setNewIds(new Set())}>● {newIds.size} new</button>}
        </div>
        {dispatched.map((j) => <JobCard key={j.id} job={j} isNew={newIds.has(j.id)} />)}

        {adhoc.length > 0 && (
          <>
            <div className="section-title adhoc-title">Ad-hoc / Self-logged</div>
            {adhoc.map((j) => <JobCard key={j.id} job={j} isNew={newIds.has(j.id)} />)}
          </>
        )}
      </div>

      <div className="actionbar">
        <button className="btn primary" onClick={() => nav('/jobs/new')}>+ Log ad-hoc job</button>
        <button className="btn secondary" onClick={() => nav('/shift/end')}>End-of-shift summary</button>
      </div>

      {confirmReset && (
        <div className="modal-backdrop" onClick={() => !resetting && setConfirmReset(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Reset demo?</h3>
            <p className="muted">This wipes all progress (jobs, messages, escalations) and restores a fresh start-of-shift.</p>
            <button className="btn danger" disabled={resetting} onClick={doReset}>{resetting ? 'Resetting…' : 'Reset everything'}</button>
            <button className="btn ghost" disabled={resetting} onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
