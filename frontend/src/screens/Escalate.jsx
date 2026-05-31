import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, AiCard, Skeleton, MicButton } from '../components/ui'
import { ESCALATION_REASONS } from '../constants'

export default function Escalate() {
  const { id } = useParams()
  const nav = useNavigate()
  const [reasons, setReasons] = useState([])
  const [note, setNote] = useState('')
  const [routing, setRouting] = useState(null)
  const [routingLoading, setRoutingLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [err, setErr] = useState(null)

  // AI routing summary refreshes whenever the selected reasons change.
  useEffect(() => {
    setRoutingLoading(true)
    api
      .aiEscalation(id, reasons)
      .then(setRouting)
      .catch(() => setRouting(null))
      .finally(() => setRoutingLoading(false))
  }, [id, reasons])

  function toggle(r) {
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
  }

  async function confirm() {
    setConfirming(true)
    try {
      await api.escalate(id, {
        reason_chips: reasons,
        note,
        ai_routing_summary: routing?.routing_summary,
      })
      nav('/', { replace: true })
    } catch (e) {
      setErr(e.message)
      setConfirming(false)
    }
  }

  return (
    <>
      <TopBar title="Escalate job" onBack={() => nav(-1)} />
      <div className="screen">
        <div className="banner warn">
          <strong>Escalation notifies others and reassigns ownership.</strong>
        </div>

        <div className="panel">
          <h3>Reason</h3>
          <div className="chips">
            {ESCALATION_REASONS.map((r) => (
              <button key={r} className={`chip ${reasons.includes(r) ? 'on' : ''}`} onClick={() => toggle(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="field">Note for supervisor</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything they should know…" />
          <div style={{ marginTop: 8 }}><MicButton value={note} setValue={setNote} /></div>
        </div>

        <AiCard title="Who gets notified & why">
          {routingLoading && !routing ? (
            <Skeleton lines={2} />
          ) : routing ? (
            <>
              <p>{routing.routing_summary}</p>
              <div className="dots" style={{ marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
                <RouteTag on={routing.routing.supervisor} label="Supervisor" />
                <RouteTag on={routing.routing.front_desk} label="Front desk" />
                <RouteTag on={routing.routing.engineering_log} label="Engineering log" />
              </div>
            </>
          ) : (
            <p className="muted">Routing preview unavailable — supervisor will still be notified.</p>
          )}
        </AiCard>

        {err && <div className="banner danger">{err}</div>}
      </div>

      <div className="actionbar">
        <button className="btn danger" disabled={confirming || reasons.length === 0} onClick={confirm}>
          {confirming ? 'Escalating…' : 'Confirm escalation'}
        </button>
        <button className="btn ghost" onClick={() => nav(-1)}>Cancel</button>
      </div>
    </>
  )
}

function RouteTag({ on, label }) {
  return (
    <span className="item" style={{ fontSize: 13, opacity: on ? 1 : 0.4 }}>
      <span className="dot" style={{ background: on ? 'var(--normal)' : 'var(--text-3)' }} />
      {label} {on ? '✓' : '—'}
    </span>
  )
}
