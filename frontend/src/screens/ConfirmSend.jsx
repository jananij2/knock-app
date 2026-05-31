import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api'
import { TopBar, MicButton } from '../components/ui'
import { HOTEL_NAME } from '../constants'

// Used for the initial guest message. Message is NEVER sent without this
// explicit confirmation step.
export default function ConfirmSend() {
  const { id } = useParams()
  const nav = useNavigate()
  const { state } = useLocation()
  const [text, setText] = useState(state?.draft || '')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)

  const guest = state?.guest || 'guest'
  const room = state?.room || ''
  const returnTo = state?.returnTo || `/jobs/${id}`

  // If we arrived without a draft (e.g. from the VIP gate), generate one so the
  // textarea is pre-filled rather than empty.
  useEffect(() => {
    if (!state?.draft) {
      api.aiContext(id).then((r) => setText((t) => t || r.message_draft || '')).catch(() => {})
    }
  }, [id, state])

  async function confirmSend() {
    if (!text.trim()) return
    setSending(true)
    try {
      await api.sendMessage(id, text.trim())
      nav(returnTo, { replace: true, state: { sent: true } })
    } catch (e) {
      setErr(e.message)
      setSending(false)
    }
  }

  return (
    <>
      <TopBar title="Confirm message" onBack={() => nav(-1)} />
      <div className="screen">
        <div className="panel">
          <h3>Sending to</h3>
          <div className="kv"><span className="k">Guest</span><span className="v">{guest}</span></div>
          <div className="kv"><span className="k">Room</span><span className="v">{room}</span></div>
          <div className="kv"><span className="k">Channel</span><span className="v">SMS via {HOTEL_NAME} line</span></div>
        </div>

        <div>
          <label className="field">Message</label>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={{ marginTop: 8 }}><MicButton value={text} setValue={setText} /></div>
        </div>

        <div className="banner warn">
          <strong>This sends as {HOTEL_NAME}.</strong>
          The guest will receive this from {HOTEL_NAME}’s line. Review before sending.
        </div>

        {err && <div className="banner danger">{err}</div>}
      </div>

      <div className="actionbar">
        <button className="btn primary" disabled={sending || !text.trim()} onClick={confirmSend}>
          {sending ? 'Sending…' : 'Send message'}
        </button>
        <button className="btn ghost" onClick={() => nav(-1)}>Cancel</button>
      </div>
    </>
  )
}
