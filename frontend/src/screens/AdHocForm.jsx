import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, MicButton } from '../components/ui'

const TYPES = ['hvac', 'plumbing', 'electrical', 'general']

// Tech self-logs a job they found themselves, then drops into the standard flow.
// The free-text description drives AI title suggestions (debounced); the tech taps
// a suggestion or types their own title.
export default function AdHocForm() {
  const nav = useNavigate()
  const [room, setRoom] = useState('')
  const [desc, setDesc] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState('general')
  const [suggestions, setSuggestions] = useState([])
  const [suggLoading, setSuggLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // Debounced (~500ms) title suggestions from the description + job type.
  useEffect(() => {
    const d = desc.trim()
    if (d.length < 3) {
      setSuggestions([])
      setSuggLoading(false)
      return
    }
    setSuggLoading(true)
    const t = setTimeout(() => {
      api.aiTitleSuggestions(d, type)
        .then((r) => setSuggestions(r.titles || []))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggLoading(false))
    }, 500)
    return () => clearTimeout(t)
  }, [desc, type])

  async function create() {
    if (!room.trim() || !title.trim()) return
    setSaving(true)
    try {
      const job = await api.createJob({
        room_number: room.trim(), title: title.trim(), job_type: type, tech_notes: desc.trim(),
      })
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
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's the problem?" />
          <div style={{ marginTop: 8 }}><MicButton value={desc} setValue={setDesc} /></div>

          {(suggLoading || suggestions.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 700, color: 'var(--brand)' }}>✦ Suggested titles</div>
              {suggLoading && suggestions.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>Thinking…</div>
              ) : (
                <div className="chips">
                  {suggestions.map((s, i) => (
                    <button key={i} type="button" className={`chip ${title === s ? 'on' : ''}`} onClick={() => setTitle(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="field" style={{ marginTop: 12 }}>Job title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tap a suggestion or type your own" />

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
