import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, fmtClock, fmtDuration, MicButton, MessageComposer, isImageMsg } from '../components/ui'
import { FINDING_CHIPS } from '../constants'

export default function JobInProgress() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [chips, setChips] = useState([])
  const [note, setNote] = useState('')
  const [messages, setMessages] = useState([])
  const [saving, setSaving] = useState(false)
  const [photoNoteLoading, setPhotoNoteLoading] = useState(false)

  // Append text to the notes field without clobbering what's already there.
  function appendNote(text) {
    setNote((prev) => (prev && prev.trim() ? `${prev.trim()}\n${text}` : text))
  }

  // A completed voice note is sent to the guest as an outbound message (same
  // send path as any guest message), alongside being saved into the notes field
  // (streamed there live as spoken). Vacant rooms have no guest to message, so
  // the note only lives in Notes there.
  async function addVoiceNote(text) {
    if (data?.room?.occupancy_status === 'vacant') return
    try {
      const m = await api.sendMessage(id, text)
      setMessages((prev) => [...prev, m])
    } catch { /* ignore — note still lives in the notes field */ }
  }

  // A photo is logged as an image bubble in the thread AND sent to Claude to
  // draft a maintenance note, which drops into the notes field (editable there).
  async function addPhoto(dataUrl) {
    try {
      const m = await api.sendMessage(id, dataUrl)
      setMessages((prev) => [...prev, m])
    } catch { /* ignore — photo just won't persist */ }
    setPhotoNoteLoading(true)
    try {
      const r = await api.aiPhotoNote(id, dataUrl)
      if (r?.maintenance_note) appendNote(r.maintenance_note)
    } catch { /* ignore — tech can still write the note manually */ } finally {
      setPhotoNoteLoading(false)
    }
  }

  useEffect(() => {
    api.getJob(id).then((d) => {
      setData(d)
      setChips(d.job.findings || [])
      setNote(d.job.tech_notes || '')
    })
    api.listMessages(id).then(setMessages).catch(() => {})
  }, [id])

  const jobType = data?.job?.job_type || 'general'
  const chipOptions = FINDING_CHIPS[jobType] || FINDING_CHIPS.general

  function toggleChip(c) {
    setChips((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  // persist findings + notes before leaving for resolution/escalation
  async function persist() {
    await api.setFindings(id, chips, note)
  }

  async function goResolve() {
    setSaving(true)
    await persist()
    nav(`/jobs/${id}/resolve`)
  }
  async function goEscalate() {
    setSaving(true)
    await persist()
    nav(`/jobs/${id}/escalate`)
  }

  if (!data) return (<><TopBar title="Job in progress" back="/" /><div className="screen muted">Loading…</div></>)
  const { job, room } = data

  return (
    <>
      <TopBar title={job.title} sub={`Room ${job.room_number} · in progress`} back={`/jobs/${id}`} />
      <div className="screen">
        {/* Live job timer (runs from when the job was started) */}
        <JobTimer />

        {/* Findings chips */}
        <div className="panel">
          <h3>Findings ({jobType})</h3>
          <div className="chips">
            {chipOptions.map((c) => (
              <button
                key={c}
                className={`chip ${chips.includes(c) ? 'on' : ''} ${c === 'Part needed' ? 'danger' : ''}`}
                onClick={() => toggleChip(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Notes + voice + photo */}
        <div className="panel">
          <h3>Notes</h3>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you find?" />
          {photoNoteLoading && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>✦ Drafting a note from your photo…</p>}
          <div className="attach-row" style={{ marginTop: 10 }}>
            <MicButton value={note} setValue={setNote} onComplete={addVoiceNote} label="Voice note" />
            <PhotoButton onAdd={addPhoto} />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Voice notes are sent to the guest and appear in the message thread below; photos are attached there too.</p>
        </div>

        {/* Mid-job context correction */}
        <RoomCorrection room={room} jobId={id} onUpdated={(r) => setData((d) => ({ ...d, room: r }))} />

        {/* Message thread */}
        <div className="panel">
          <h3>Guest messages</h3>
          {messages.length === 0 && <div className="muted">No messages yet.</div>}
          <div className="thread">
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.direction}`}>
                {isImageMsg(m.content) ? <img className="msg-img" src={m.content} alt="attachment" /> : m.content}
                <div className="t">{fmtClock(m.sent_at)}</div>
              </div>
            ))}
          </div>
          {room.occupancy_status !== 'vacant' && (
            <MessageComposer
              jobId={id}
              onSent={(m) => setMessages((prev) => [...prev, m])}
            />
          )}
        </div>
      </div>

      <div className="actionbar">
        <div className="row">
          <button className="btn ghost" disabled={saving} onClick={goEscalate}>Escalate</button>
          <button className="btn success" disabled={saving} onClick={goResolve}>Mark resolved</button>
        </div>
      </div>
    </>
  )
}

// ---- live elapsed-time counter, ticking from when the job was started ----
function JobTimer() {
  const startRef = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const elapsed = fmtDuration((now - startRef.current) / 1000)
  return (
    <div className="job-timer">
      <span className="dot-live" />
      <span className="t">{elapsed}</span>
      <span className="lbl">elapsed</span>
    </div>
  )
}

// ---- photo attach — downscale to a small JPEG data URL, hand back to onAdd ----
function PhotoButton({ onAdd }) {
  const ref = useRef(null)
  function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => {
      const max = 900
      let { width, height } = img
      const scale = Math.min(1, max / Math.max(width, height))
      width = Math.round(width * scale)
      height = Math.round(height * scale)
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      c.getContext('2d').drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      onAdd(c.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }
  return (
    <>
      <button className="btn secondary" onClick={() => ref.current?.click()}>📷 Add photo</button>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
    </>
  )
}

// ---- mid-job room status correction (tech correction is ground truth) ----
function RoomCorrection({ room, jobId, onUpdated }) {
  const [open, setOpen] = useState(false)
  const [occ, setOcc] = useState(room.occupancy_status)
  const [saving, setSaving] = useState(false)
  const opts = ['occupied', 'vacant', 'checkout', 'checkin']

  async function save() {
    setSaving(true)
    const updated = await api.correctRoom(room.room_number, { occupancy_status: occ, job_id: Number(jobId) })
    onUpdated(updated)
    setSaving(false)
    setOpen(false)
  }

  return (
    <div className="panel">
      <h3>Room status</h3>
      <div className="kv"><span className="k">Current</span><span className="v">{room.occupancy_status}</span></div>
      {!open ? (
        <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
          Update room status if incorrect →
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div className="seg">
            {opts.map((o) => (
              <button key={o} className={occ === o ? 'on' : ''} onClick={() => setOcc(o)}>{o}</button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Your correction takes precedence and is logged to this job.</p>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save correction'}</button>
        </div>
      )}
    </div>
  )
}
