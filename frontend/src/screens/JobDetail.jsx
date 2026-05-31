import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useShift } from '../ShiftContext'
import { TopBar, PriorityBadge, StatusBadge, FlagTags, Skeleton, AiCard, SuggestedMessage, fmtClock } from '../components/ui'

const TIER_LABEL = { standard: 'Standard', gold: 'Gold', diamond: 'Diamond' }
const OCC_LABEL = { occupied: 'Occupied', vacant: 'Vacant', checkout: 'Checking out', checkin: 'Checking in' }

export default function JobDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { shift } = useShift()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  // AI context summary + message draft (batched call), with skeleton + fallback.
  const [ai, setAi] = useState(null)
  const [aiFailed, setAiFailed] = useState(false)
  const [hasOutbound, setHasOutbound] = useState(false)
  const [regen, setRegen] = useState(false) // user asked for a fresh draft after sending

  useEffect(() => {
    api.getJob(id).then(setData).catch((e) => setErr(e.message))
    api.listMessages(id).then((m) => setHasOutbound(m.some((x) => x.direction === 'outbound'))).catch(() => {})
  }, [id])

  function loadDraft() {
    if (!shift) return
    setAi(null)
    setAiFailed(false)
    api.aiContext(id, shift.tech_name).then(setAi).catch(() => setAiFailed(true))
  }
  useEffect(loadDraft, [id, shift])

  if (err) return (<><TopBar title="Job" back="/" /><div className="screen"><div className="banner danger">{err}</div></div></>)
  if (!data) return (<><TopBar title="Job" back="/" /><div className="screen"><Skeleton lines={4} /></div></>)

  const { job, room, tickets } = data
  const closed = job.status === 'resolved' || job.status === 'escalated'
  const vipOccupied = Boolean(room.vip) && room.occupancy_status === 'occupied'

  async function startJob() {
    // Re-check message state live so it can never be stale (fixes the gate
    // occasionally not firing when component state lagged behind the DB).
    let outbound = hasOutbound
    try {
      const m = await api.listMessages(id)
      outbound = m.some((x) => x.direction === 'outbound')
    } catch { /* fall back to cached flag */ }

    if (vipOccupied && !outbound) {
      nav(`/jobs/${id}/vip-gate`)
      return
    }
    await api.setStatus(id, 'in_progress')
    nav(`/jobs/${id}/progress`)
  }

  async function reopenJob() {
    await api.setStatus(id, 'in_progress')
    nav(`/jobs/${id}/progress`)
  }

  function sendMessage() {
    nav(`/jobs/${id}/message`, {
      state: { draft: ai?.message_draft || '', guest: room.guest_name, room: room.room_number, mode: 'initial', returnTo: `/jobs/${id}` },
    })
  }

  function regenerate() {
    setRegen(true)
    loadDraft()
  }

  const showSent = hasOutbound && !regen

  return (
    <>
      <TopBar title={job.title} sub={`Room ${job.room_number} · Floor ${job.floor}`} back="/" />
      <div className="screen">
        <div className="row1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <FlagTags flags={job.flags} />
          {closed ? <StatusBadge status={job.status} /> : <PriorityBadge priority={job.priority} />}
        </div>

        {/* AI context summary */}
        <AiCard title="Context briefing">
          {ai ? (
            <p>{ai.context_summary}</p>
          ) : aiFailed ? (
            <p className="muted">Context unavailable — check room details below.</p>
          ) : (
            <Skeleton lines={3} />
          )}
        </AiCard>

        {/* Room context (from DB) */}
        <div className="panel">
          <h3>Room context</h3>
          <div className="kv"><span className="k">Occupancy</span><span className="v">{OCC_LABEL[room.occupancy_status]}</span></div>
          {room.guest_name && <div className="kv"><span className="k">Guest</span><span className="v">{room.guest_name}{room.vip ? ' ★' : ''}</span></div>}
          {room.guest_loyalty_tier && <div className="kv"><span className="k">Loyalty</span><span className="v">{TIER_LABEL[room.guest_loyalty_tier]}</span></div>}
          {room.checkout_time && <div className="kv"><span className="k">Checkout</span><span className="v">{room.checkout_time.split('T')[0]} {fmtClock(room.checkout_time)}</span></div>}
          <div className="kv"><span className="k">Housekeeping</span><span className="v">{room.housekeeping_status}</span></div>
          {room.noise_sensitivity_flag ? <div className="kv"><span className="k">Note</span><span className="v">Noise-sensitive</span></div> : null}
        </div>

        {/* Ticket history */}
        <div className="panel">
          <h3>Ticket history</h3>
          {tickets.length === 0 && <div className="muted">No prior tickets for this room.</div>}
          {tickets.map((t) => (
            <div key={t.id} className={`ticket ${tickets.length > 1 ? 'repeat' : ''}`}>
              <div className="d">{t.date}</div>
              <div className="desc">{t.description}</div>
              <div className="res">{t.resolution || 'Unresolved'}</div>
            </div>
          ))}
        </div>

        {/* AI guest message draft / sent confirmation */}
        {room.occupancy_status !== 'vacant' && (
          <SuggestedMessage
            title="Suggested guest message"
            loading={!ai && !aiFailed}
            failed={aiFailed}
            sent={showSent}
            draft={ai?.message_draft}
            onSend={sendMessage}
            onRegenerate={regenerate}
          />
        )}
      </div>

      <div className="actionbar">
        <div className="row">
          <button className="btn ghost" onClick={() => nav(`/jobs/${id}/escalate`)}>Escalate</button>
          {closed ? (
            <button className="btn primary" onClick={reopenJob}>Re-open job</button>
          ) : (
            <button className="btn primary" onClick={startJob}>Start job</button>
          )}
        </div>
      </div>
    </>
  )
}
