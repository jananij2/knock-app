import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, fmtClock, isImageMsg } from '../components/ui'

// Inbox-style list of all message threads, one row per job (Marketplace-style:
// the job the conversation belongs to is shown at the top of each row).
export default function Inbox() {
  const nav = useNavigate()
  const [threads, setThreads] = useState(null)

  useEffect(() => {
    // opening the inbox marks everything seen → clears the header badge
    localStorage.setItem('knock_inbox_seen', String(Date.now()))
    api.allThreads().then(setThreads).catch(() => setThreads([]))
  }, [])

  return (
    <>
      <TopBar title="Messages" back="/" />
      <div className="screen">
        {threads && threads.length === 0 && <div className="muted center">No messages yet.</div>}
        {!threads && <div className="muted center">Loading…</div>}
        {threads?.map((t) => (
          <button key={t.job_id} className="thread-row" onClick={() => nav(`/messages/${t.job_id}`)}>
            <div className="thread-job">{t.title} · Room {t.room_number}</div>
            <div className="thread-last">
              <span className="thread-preview">
                {t.last_direction === 'outbound' ? 'You: ' : ''}{isImageMsg(t.last) ? '📷 Photo' : t.last}
              </span>
              <span className="thread-time">{fmtClock(t.last_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </>
  )
}
