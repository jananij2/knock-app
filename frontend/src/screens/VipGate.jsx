import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar } from '../components/ui'

// Soft gate (not a hard block): friction + accountability. Proceeding without
// notifying is logged and the supervisor is alerted.
export default function VipGate() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState(null)

  useEffect(() => {
    api.getJob(id).then(setData).catch(() => {})
  }, [id])

  function sendFirst() {
    const room = data?.room
    nav(`/jobs/${id}/message`, {
      state: { guest: room?.guest_name, room: room?.room_number, mode: 'initial', returnTo: `/jobs/${id}` },
    })
  }

  async function proceedAnyway() {
    await api.protocolSkip(id, 'Started job on occupied VIP room without notifying guest')
    await api.setStatus(id, 'in_progress')
    nav(`/jobs/${id}/progress`, { replace: true })
  }

  return (
    <>
      <TopBar title="Hold on" onBack={() => nav(-1)} />
      <div className="screen">
        <div className="big-emoji">🔔</div>
        <h2 className="center" style={{ margin: '0 8px' }}>You haven’t notified this guest yet.</h2>
        <p className="muted center">
          Room {data?.room?.room_number} has a VIP guest{data?.room?.guest_name ? ` (${data.room.guest_name})` : ''}.
          Sending a quick heads-up before you enter keeps the visit comfortable.
        </p>

        <div className="banner warn">
          <strong>If you proceed without notifying</strong>
          It’s logged to this job and your supervisor is automatically alerted.
        </div>
      </div>

      <div className="actionbar">
        <button className="btn primary" onClick={sendFirst}>Send message first</button>
        <button className="btn ghost" onClick={proceedAnyway}>Proceed without notifying</button>
      </div>
    </>
  )
}
