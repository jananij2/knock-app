import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, MicButton, appendText } from '../components/ui'

const TYPES = ['hvac', 'plumbing', 'electrical', 'general']

// Tech self-logs a job they found themselves, then drops into the standard flow.
export default function AdHocForm() {
  const nav = useNavigate()
  const [room, setRoom] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState('general')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  async function create() {
    if (!room.trim() || !title.trim()) return
    setSaving(true)
    try {
      const job = await api.createJob({ room_number: room.trim(), title: title.trim(), job_type: type })
      nav(`/jobs/${job.id}`, { replace: true })
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <>
      <TopBar title="Log ad-hoc job" back="/" />
      <div className="screen">
        <div className="panel">
          <label className="field">Room number</label>
          <input type="text" inputMode="numeric" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 233" />

          <label className="field" style={{ marginTop: 12 }}>Issue description</label>
          <textarea rows={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's the problem?" />
          <div style={{ marginTop: 8 }}><MicButton onText={appendText(setTitle)} /></div>

          <label className="field" style={{ marginTop: 12 }}>Job type</label>
          <div className="chips">
            {TYPES.map((t) => (
              <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{t}</button>
            ))}
          </div>
        </div>
        {err && <div className="banner danger">{err}</div>}
      </div>

      <div className="actionbar">
        <button className="btn primary" disabled={saving || !room.trim() || !title.trim()} onClick={create}>
          {saving ? 'Creating…' : 'Create & open job'}
        </button>
        <button className="btn ghost" onClick={() => nav('/')}>Cancel</button>
      </div>
    </>
  )
}
