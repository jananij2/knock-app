import { useEffect, useState } from 'react'
import { useShift } from '../ShiftContext'

// Intro: a closed door knocks, greets the tech, then swings open to reveal home.
export default function Splash({ onDone }) {
  const { shift } = useShift()
  const [phase, setPhase] = useState('closed') // closed → welcome → open

  useEffect(() => {
    const t = [
      setTimeout(() => setPhase('welcome'), 1800),
      setTimeout(() => setPhase('open'), 2900),
      setTimeout(() => onDone(), 3750),
    ]
    return () => t.forEach(clearTimeout)
  }, [onDone])

  const tech = shift?.tech_name || 'Dobby'

  return (
    <div className={`door-splash ${phase}`}>
      <div className="door-panel left" />
      <div className="door-panel right" />
      <div className="door-center">
        {phase === 'closed' ? (
          <div className="door-knock">
            <div className="splash-logo">✦ Knock</div>
            <div className="knock-hint">knock, knock…</div>
          </div>
        ) : (
          <div className="splash-welcome">Welcome, {tech}</div>
        )}
      </div>
    </div>
  )
}
