import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShift } from '../ShiftContext'
import { HOTEL_NAME } from '../constants'

// Shown in place of Home once the shift is closed. The only way back to the
// regular home/shift view is "Reopen shift".
export default function ShiftEnded() {
  const nav = useNavigate()
  const { shift, reopen } = useShift()
  const [busy, setBusy] = useState(false)

  let summary = null
  try { summary = shift?.ai_summary ? JSON.parse(shift.ai_summary) : null } catch { /* not JSON */ }

  return (
    <>
      <div className="topbar">
        <div className="shift-header">
          <div className="logo">✦ Knock</div>
          <div className="brand">{HOTEL_NAME}</div>
        </div>
      </div>

      <div className="screen">
        <div className="big-emoji">🌙</div>
        <h2 className="center" style={{ margin: 0 }}>Shift ended</h2>
        <p className="muted center">
          {shift?.tech_name ? `${shift.tech_name}, ` : ''}your handoff note is saved to the shift log.
        </p>
        {summary && (
          <div className="panel">
            <h3>Summary</h3>
            <div className="kv"><span className="k">Completed</span><span className="v">{summary.completed}</span></div>
            <div className="kv"><span className="k">Escalated</span><span className="v">{summary.escalated}</span></div>
            <div className="kv"><span className="k">Pending</span><span className="v">{summary.pending}</span></div>
          </div>
        )}
      </div>

      <div className="actionbar">
        <button className="btn secondary" onClick={() => nav('/shift/end')}>Edit shift</button>
        <button className="btn primary" disabled={busy} onClick={() => { setBusy(true); reopen() }}>
          {busy ? 'Reopening…' : 'Reopen shift'}
        </button>
      </div>
    </>
  )
}
