import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TopBar, AiCard, Skeleton, SuggestedMessage, MicButton } from '../components/ui'

export default function ResolutionConfirm() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [ai, setAi] = useState(null)
  const [aiFailed, setAiFailed] = useState(false)

  // editable AI outputs
  const [summary, setSummary] = useState('')
  const [closeout, setCloseout] = useState('')

  // confirm fields
  const [resolved, setResolved] = useState(true)
  const [notified, setNotified] = useState(false)
  const [parts, setParts] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeoutSent, setCloseoutSent] = useState(false)

  useEffect(() => {
    api.getJob(id).then(setData)
  }, [id])

  useEffect(() => {
    if (!data) return
    const { job } = data
    api
      .aiResolution(id, job.findings || [], job.tech_notes || '')
      .then((r) => {
        setAi(r)
        setSummary(r.resolution_summary)
        setCloseout(r.closeout_message)
      })
      .catch(() => setAiFailed(true))
  }, [id, data])

  async function sendCloseout() {
    if (!closeout.trim()) return
    await api.sendMessage(id, closeout.trim())
    setCloseoutSent(true)
    setNotified(true)
  }

  async function regenCloseout() {
    setCloseoutSent(false)
    try {
      const r = await api.aiResolution(id, data.job.findings || [], data.job.tech_notes || '')
      setCloseout(r.closeout_message)
    } catch { /* keep existing text */ }
  }

  async function confirmClose() {
    setClosing(true)
    // persist the (edited) resolution summary as findings/notes context already saved;
    // store the summary via findings note append is overkill — just resolve.
    await api.setFindings(id, data.job.findings || [], summary)
    await api.setStatus(id, 'resolved')
    nav(`/jobs/${id}/done`, {
      replace: true,
      state: { resolved, notified, parts, followUp },
    })
  }

  if (!data) return (<><TopBar title="Resolution" onBack={() => nav(-1)} /><div className="screen muted">Loading…</div></>)

  const recommendEscalation = ai?.recommend_escalation

  return (
    <>
      <TopBar title="Confirm resolution" sub={`Room ${data.job.room_number}`} onBack={() => nav(-1)} />
      <div className="screen">
        {recommendEscalation && (
          <div className="banner danger">
            <strong>AI recommends escalation</strong>
            {ai.recommend_escalation_reason} You can still close, but consider escalating.
            <div style={{ marginTop: 8 }}>
              <button className="btn danger" onClick={() => nav(`/jobs/${id}/escalate`)}>Escalate instead</button>
            </div>
          </div>
        )}

        <AiCard title="Resolution summary">
          {!ai && !aiFailed ? (
            <Skeleton lines={3} />
          ) : (
            <>
              <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summarize what was found and fixed…" />
              <div style={{ marginTop: 8 }}><MicButton value={summary} setValue={setSummary} /></div>
            </>
          )}
        </AiCard>

        <div className="panel">
          <h3>Confirm</h3>
          <div className="toggle-row">
            <span>Issue resolved?</span>
            <YesNo value={resolved} onChange={setResolved} />
          </div>
          <div className="toggle-row">
            <span>Guest notified?</span>
            <YesNo value={notified} onChange={setNotified} />
          </div>
          <div className="toggle-row">
            <span>Follow-up needed?</span>
            <YesNo value={followUp} onChange={setFollowUp} />
          </div>
          <label className="field" style={{ marginTop: 10 }}>Parts used</label>
          <input type="text" value={parts} onChange={(e) => setParts(e.target.value)} placeholder="e.g. thermostat sensor" />
          <div style={{ marginTop: 8 }}><MicButton value={parts} setValue={setParts} /></div>
        </div>

        {/* close-out guest message — same suggestion pattern as Job Detail */}
        <SuggestedMessage
          title="Close-out message to guest"
          loading={!ai && !aiFailed}
          failed={aiFailed}
          sent={closeoutSent}
          editable
          value={closeout}
          setValue={setCloseout}
          onSend={sendCloseout}
          onRegenerate={regenCloseout}
          skipNote="Skip if the guest was already updated in person."
        />
      </div>

      <div className="actionbar">
        <button className="btn success" disabled={closing} onClick={confirmClose}>Confirm & close</button>
        <button className="btn ghost" onClick={() => nav(-1)}>Go back — edit</button>
      </div>
    </>
  )
}

function YesNo({ value, onChange }) {
  return (
    <div className="seg">
      <button className={value ? 'on' : ''} onClick={() => onChange(true)}>Yes</button>
      <button className={!value ? 'on' : ''} onClick={() => onChange(false)}>No</button>
    </div>
  )
}
