import { useNavigate } from 'react-router-dom'
import { PriorityBadge, StatusBadge, FlagTags, fmtClock } from './ui'

export default function JobCard({ job, isNew }) {
  const nav = useNavigate()
  const done = job.status === 'resolved' || job.status === 'escalated'
  const adhoc = job.source === 'adhoc'
  return (
    <button
      className={`jobcard ${job.priority} ${done ? 'done' : ''} ${adhoc ? 'adhoc' : ''}`}
      onClick={() => nav(`/jobs/${job.id}`)}
    >
      <div className="row1">
        <div>
          <div className="title">
            {isNew && <span className="new-tag">NEW</span>}
            {job.title}
          </div>
          <div className="room">Room {job.room_number} · Floor {job.floor}</div>
        </div>
        {done ? <StatusBadge status={job.status} /> : <PriorityBadge priority={job.priority} />}
      </div>
      <div className="tags-row">
        <FlagTags flags={job.flags} />
        {adhoc && <span className="tag tag-adhoc">Self-logged</span>}
      </div>
      <div className="meta">
        <span className="time">Dispatched {fmtClock(job.dispatched_at)}</span>
      </div>
    </button>
  )
}
