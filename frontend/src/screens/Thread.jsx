import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, fmtClock, MessageComposer, isImageMsg } from '../components/ui'

// One job's message history, with the job context pinned above the thread.
export default function Thread() {
  const { id } = useParams()
  const nav = useNavigate()
  const [job, setJob] = useState(null)
  const [messages, setMessages] = useState([])

  useEffect(() => {
    api.getJob(id).then((d) => setJob(d.job)).catch(() => {})
    api.listMessages(id).then(setMessages).catch(() => {})
  }, [id])

  return (
    <>
      <TopBar title="Conversation" back="/messages" />
      <div className="screen">
        {/* job context (the listing this conversation belongs to) */}
        <div className="panel thread-context">
          <div className="thread-job">{job?.title || '…'}</div>
          <div className="muted">Room {job?.room_number}{job?.floor ? ` · Floor ${job.floor}` : ''}</div>
          <button className="link-btn" onClick={() => nav(`/jobs/${id}`)}>Open job →</button>
        </div>

        <div className="thread">
          {messages.length === 0 && <div className="muted">No messages yet.</div>}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.direction}`}>
              {isImageMsg(m.content) ? <img className="msg-img" src={m.content} alt="attachment" /> : m.content}
              <div className="t">{fmtClock(m.sent_at)}</div>
            </div>
          ))}
        </div>

        <MessageComposer jobId={id} onSent={(m) => setMessages((p) => [...p, m])} />
      </div>
    </>
  )
}
