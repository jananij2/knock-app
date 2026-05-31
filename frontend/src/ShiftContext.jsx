import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api'

// Holds the current shift (tech name, hours, floor) loaded once. No auth —
// single tech, single shift — so this is effectively app-wide config.
const ShiftContext = createContext(null)

export function ShiftProvider({ children }) {
  const [shift, setShift] = useState(null)
  const [jobs, setJobs] = useState([])

  const refresh = useCallback(async () => {
    const data = await api.shiftSummary()
    setShift(data.shift)
    setJobs(data.jobs)
    return data
  }, [])

  const reopen = useCallback(async () => {
    await api.reopenShift()
    await refresh()
  }, [refresh])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  // Floor assignment derived from the jobs' floors (PRD: "Floors 2–5").
  const floors = [...new Set(jobs.map((j) => j.floor))].sort()
  const floorLabel = floors.length ? `Floors ${floors[0]}–${floors[floors.length - 1]}` : ''

  // A shift is "ended" once its handoff note has been saved.
  const ended = !!shift?.handoff_note

  return (
    <ShiftContext.Provider value={{ shift, jobs, refresh, floorLabel, ended, reopen }}>
      {children}
    </ShiftContext.Provider>
  )
}

export const useShift = () => useContext(ShiftContext)
