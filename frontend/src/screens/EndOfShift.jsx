import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useShift } from '../ShiftContext'
import { TopBar, AiCard, Skeleton, StatusBadge, MicButton, appendText, fmtClock } from '../components/ui'

export default function EndOfShift() {
  const nav = useNavigate()
  const { refresh } = useShift()
  const [summary, setSummary] = useState(null) // { shift, jobs }
  const [ai, setAi] = useState(null)
  const [handoff, setHandoff] = useState('')
  const [aiFailed, setAiFailed] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    api.shiftSummary().then(setSummary)
    api
      .aiHandoff()
      .then((r) => {
        setAi(r)
        setHandoff(r.handoff_note)
      })
      .catch(() => setAiFailed(true))
  }, [])

  async function confirmEnd() {
    setClosing(true)
    await api.closeShift(handoff, ai?.ai_summary || null)
    await refresh().catch(() => {})
    // shift is now "ended" → "/" renders the locked Shift-ended screen
    nav('/')
  }

  const s = ai?.ai_summary

  return (
    <>
      <TopBar title="End of shift" back="/" />
      <div className="screen">
        <div className="panel">
          <h3>Shift summary</h3>
          {s ? (
            <>
              <div className="kv"><span className="k">Completed</span><span className="v">{s.completed}</span></div>
              <div className="kv"><span className="k">Escalated</span><span className="v">{s.escalated}</span></div>
              <div className="kv"><span className="k">Pending</span><span className="v">{s.pending}</span></div>
              {s.open_items?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Open items</div>
                  {s.open_items.map((o, i) => <div key={i} className="muted">• {o}</div>)}
                </div>
              )}
            </>
          ) : aiFailed ? (
            <p className="muted">Summary unavailable — see shift log below.</p>
          ) : (
            <Skeleton lines={3} />
          )}
        </div>

        {/* editable handoff note + voice */}
        <AiCard title="Handoff note for next tech">
          {ai || aiFailed ? (
            <>
              <textarea rows={5} value={handoff} onChange={(e) => setHandoff(e.target.value)} />
              <div style={{ marginTop: 8 }}><MicButton onText={appendText(setHandoff)} /></div>
            </>
          ) : (
            <Skeleton lines={4} />
          )}
        </AiCard>

        {/* read-only shift log */}
        <div className="panel">
          <h3>Shift log</h3>
          {summary?.jobs?.map((j) => (
            <div key={j.id} className="kv">
              <span className="k">{fmtClock(j.dispatched_at)} · {j.title} ({j.room_number})</span>
              <span className="v"><StatusBadge status={j.status} /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="actionbar">
        <button className="btn primary" disabled={closing || !handoff.trim()} onClick={confirmEnd}>
          {closing ? 'Closing…' : 'Confirm end shift'}
        </button>
      </div>
    </>
  )
}
