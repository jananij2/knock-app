import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, PriorityBadge } from '../components/ui'
import { HOTEL_NAME } from '../constants'

// Color-coded floor map of The Grimmauld (floors 2–5). Rooms line both sides of
// a central corridor as a top-down blueprint. Rooms with an active job carry a
// ★ overlay and are tappable (opens a job modal); all other rooms are visual only.
const FLOORS = [2, 3, 4, 5]

// Only occupancy statuses we color; anything else falls back to a neutral cell.
const STATUS_LABEL = { occupied: 'Occupied', vacant: 'Vacant', checkout: 'Checkout' }

export default function FloorMap() {
  const [rooms, setRooms] = useState(null)
  const [jobs, setJobs] = useState([])
  const [err, setErr] = useState(null)
  const [idx, setIdx] = useState(0) // index into FLOORS
  const [selected, setSelected] = useState(null) // job shown in the modal

  useEffect(() => {
    api.listRooms().then(setRooms).catch((e) => setErr(e.message))
    api.listJobs().then(setJobs).catch(() => {})
  }, [])

  // room_number -> the room's active (still-open) job, if any.
  const jobByRoom = useMemo(() => {
    const m = {}
    for (const j of jobs) {
      if (j.status === 'resolved' || j.status === 'escalated') continue
      if (!m[j.room_number]) m[j.room_number] = j
    }
    return m
  }, [jobs])

  const byFloor = useMemo(() => {
    const map = {}
    for (const f of FLOORS) map[f] = []
    for (const r of rooms || []) {
      if (map[r.floor]) map[r.floor].push(r)
    }
    for (const f of FLOORS) map[f].sort((a, b) => a.room_number.localeCompare(b.room_number))
    return map
  }, [rooms])

  const floor = FLOORS[idx]
  const floorRooms = byFloor[floor] || []
  const counts = floorRooms.reduce((a, r) => {
    a[r.occupancy_status] = (a[r.occupancy_status] || 0) + 1
    return a
  }, {})

  // Rooms line both sides of a central corridor — interleave so they sit across
  // the hallway from each other (201 left, 202 right, 203 left, …).
  const left = floorRooms.filter((_, i) => i % 2 === 0)
  const right = floorRooms.filter((_, i) => i % 2 === 1)

  return (
    <>
      <TopBar title="Floor map" back="/" />
      <div className="screen">
        {err && <div className="banner danger">{err}</div>}
        {!rooms && !err && <div className="muted center">Loading floor map…</div>}

        {rooms && (
          <>
            {/* legend */}
            <div className="map-legend">
              <span className="item"><span className="swatch occupied" />Occupied</span>
              <span className="item"><span className="swatch vacant" />Vacant</span>
              <span className="item"><span className="swatch checkout" />Checkout</span>
              <span className="item"><span className="swatch star">★</span>Active job</span>
            </div>

            {/* floor selector */}
            <div className="floor-nav">
              <button className="arrow" aria-label="Lower floor" disabled={idx === 0}
                      onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</button>
              <div className="floor-title">
                <div className="n">Floor {floor}</div>
                <div className="h">{HOTEL_NAME}</div>
              </div>
              <button className="arrow" aria-label="Higher floor" disabled={idx === FLOORS.length - 1}
                      onClick={() => setIdx((i) => Math.min(FLOORS.length - 1, i + 1))}>›</button>
            </div>

            {/* top-down floor plan */}
            <div className="fp">
              <div className="fp-marker">▲ Stairs · Elevator</div>
              <div className="fp-body">
                <Wing rooms={left} side="left" jobByRoom={jobByRoom} onSelect={setSelected} />
                <div className="fp-corridor"><span>Corridor</span></div>
                <Wing rooms={right} side="right" jobByRoom={jobByRoom} onSelect={setSelected} />
              </div>
            </div>

            {/* per-floor tally */}
            <div className="muted center" style={{ fontSize: 13 }}>
              {floorRooms.length} rooms
              {Object.keys(STATUS_LABEL).map((s) =>
                counts[s] ? ` · ${counts[s]} ${STATUS_LABEL[s].toLowerCase()}` : '').join('')}
            </div>
          </>
        )}
      </div>

      {selected && <JobModal job={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function Wing({ rooms, side, jobByRoom, onSelect }) {
  return (
    <div className={`fp-wing ${side}`}>
      {rooms.map((r) => {
        const job = jobByRoom[r.room_number]
        const status = STATUS_LABEL[r.occupancy_status] ? r.occupancy_status : 'other'
        return (
          <div key={r.room_number}
               className={`fp-room ${status} ${job ? 'has-job' : ''}`}
               title={job ? `Active job: ${job.title}` : (STATUS_LABEL[r.occupancy_status] || r.occupancy_status)}
               role={job ? 'button' : undefined}
               onClick={job ? () => onSelect(job) : undefined}>
            {r.room_number}
            {job && <span className="fp-star" aria-label="Active job">★</span>}
          </div>
        )
      })}
    </div>
  )
}

function JobModal({ job, onClose }) {
  const nav = useNavigate()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3>{job.title}</h3>
          <PriorityBadge priority={job.priority} />
        </div>
        <p className="muted">Room {job.room_number} · Floor {job.floor}</p>
        <button className="btn primary" onClick={() => nav(`/jobs/${job.id}`)}>Go to job</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
