import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { TopBar } from '../components/ui'
import { HOTEL_NAME } from '../constants'

// Color-coded, read-only floor map of The Grimmauld (floors 2–5). Rooms are
// grouped by floor and laid out as two wings either side of a corridor so each
// floor reads like a real hotel floor. Purely visual — no tap interaction.
const FLOORS = [2, 3, 4, 5]

// Only occupancy statuses we color; anything else falls back to a neutral cell.
const STATUS_LABEL = { occupied: 'Occupied', vacant: 'Vacant', checkout: 'Checkout' }

export default function FloorMap() {
  const [rooms, setRooms] = useState(null)
  const [err, setErr] = useState(null)
  const [idx, setIdx] = useState(0) // index into FLOORS

  useEffect(() => {
    api.listRooms().then(setRooms).catch((e) => setErr(e.message))
  }, [])

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
                <Wing rooms={left} side="left" />
                <div className="fp-corridor"><span>Corridor</span></div>
                <Wing rooms={right} side="right" />
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
    </>
  )
}

function Wing({ rooms, side }) {
  return (
    <div className={`fp-wing ${side}`}>
      {rooms.map((r) => (
        <div key={r.room_number}
             className={`fp-room ${STATUS_LABEL[r.occupancy_status] ? r.occupancy_status : 'other'}`}
             title={STATUS_LABEL[r.occupancy_status] || r.occupancy_status}>
          {r.room_number}
        </div>
      ))}
    </div>
  )
}
