import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api'
import { TopBar, PriorityBadge, FlagTags, fmtClock } from '../components/ui'

export default function Done() {
  const { id } = useParams()
  const nav = useNavigate()
  const { state } = useLocation()
  const [job, setJob] = useState(null)
  const [next, setNext] = useState(null)

  useEffect(() => {
    api.getJob(id).then((d) => setJob(d.job))
    api.listJobs().then((jobs) => {
      const up = jobs.find((j) => j.id !== Number(id) && j.status !== 'resolved' && j.status !== 'escalated')
      setNext(up || null)
    })
  }, [id])

  if (!job) return (<><TopBar title="Done" back="/" /><div className="screen muted">Loading…</div></>)

  const yesno = (b) => (b ? '✓' : '—')

  return (
    <>
      <TopBar title="Job closed" back="/" />
      <div className="screen">
        <div className="big-emoji">✅</div>
        <h2 className="center" style={{ margin: 0 }}>{job.title}</h2>
        <p className="muted center">Room {job.room_number} · closed {fmtClock(job.resolved_at)}</p>

        <div className="panel">
          <h3>Summary</h3>
          <div className="kv"><span className="k">Ticket logged</span><span className="v">✓</span></div>
          <div className="kv"><span className="k">Guest notified</span><span className="v">{yesno(state?.notified)}</span></div>
          <div className="kv"><span className="k">Parts logged</span><span className="v">{state?.parts ? state.parts : '—'}</span></div>
          <div className="kv"><span className="k">Follow-up flagged</span><span className="v">{yesno(state?.followUp)}</span></div>
        </div>

        {next ? (
          <div>
            <div className="section-title">Up next</div>
            <button className={`jobcard ${next.priority}`} onClick={() => nav(`/jobs/${next.id}`)}>
              <div className="row1">
                <div>
                  <div className="title">{next.title}</div>
                  <div className="room">Room {next.room_number} · Floor {next.floor}</div>
                </div>
                <PriorityBadge priority={next.priority} />
              </div>
              <div className="tags-row"><FlagTags flags={next.flags} /></div>
              <div className="meta">
                <span className="time">Dispatched {fmtClock(next.dispatched_at)}</span>
              </div>
            </button>
          </div>
        ) : (
          <div className="banner info">All jobs handled — nice work.</div>
        )}
      </div>

      <div className="actionbar">
        {next && <button className="btn primary" onClick={() => nav(`/jobs/${next.id}`)}>Go to next job</button>}
        <button className="btn secondary" onClick={() => nav('/')}>Back to all jobs</button>
      </div>
    </>
  )
}
