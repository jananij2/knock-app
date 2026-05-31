// Thin fetch wrapper around the Flask API (proxied at /api in dev).

async function req(path, options) {
  const res = await fetch(`/api${path}`, options)
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = (await res.json()).error || msg
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg)
  }
  return res.status === 204 ? null : res.json()
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  // jobs
  listJobs: () => req('/jobs'),
  getJob: (id) => req(`/jobs/${id}`),
  createJob: (payload) => req('/jobs', json('POST', payload)),
  setStatus: (id, status) => req(`/jobs/${id}/status`, json('PATCH', { status })),
  setFindings: (id, findings, tech_notes) =>
    req(`/jobs/${id}/findings`, json('PATCH', { findings, tech_notes })),

  // messages
  allThreads: () => req('/messages'),
  listMessages: (id) => req(`/jobs/${id}/messages`),
  sendMessage: (id, content, direction = 'outbound') =>
    req(`/jobs/${id}/messages`, json('POST', { content, direction })),

  // escalation + soft gate
  escalate: (id, payload) => req(`/jobs/${id}/escalate`, json('POST', payload)),
  protocolSkip: (id, detail) =>
    req(`/jobs/${id}/protocol-skip`, json('POST', { detail })),

  // rooms
  listRooms: () => req('/rooms'),
  correctRoom: (room, payload) => req(`/rooms/${room}`, json('PATCH', payload)),

  // AI (drafts — caller confirms before send/log)
  aiContext: (job_id, tech_name) => req('/ai/context', json('POST', { job_id, tech_name })),
  aiResolution: (job_id, findings, tech_notes) =>
    req('/ai/resolution', json('POST', { job_id, findings, tech_notes })),
  aiEscalation: (job_id, reason_chips) =>
    req('/ai/escalation', json('POST', { job_id, reason_chips })),
  aiPhotoNote: (job_id, image) =>
    req('/ai/photo-note', json('POST', { job_id, image })),
  aiTitleSuggestions: (description, job_type) =>
    req('/ai/title-suggestions', json('POST', { description, job_type })),
  aiEstimates: () => req('/ai/estimates', json('POST', {})),
  aiHandoff: () => req('/ai/handoff', json('POST', {})),

  // shift
  shiftSummary: () => req('/shift/summary'),
  closeShift: (handoff_note, ai_summary) =>
    req('/shift/close', json('POST', { handoff_note, ai_summary })),
  reopenShift: () => req('/shift/reopen', json('POST', {})),

  // push
  vapidPublicKey: () => req('/push/vapid-public-key'),
  subscribePush: (sub) => req('/push/subscribe', json('POST', sub)),

  // dev-only
  dispatchDemoJob: () => req('/dev/dispatch-job', json('POST', {})),
  resetDemo: () => req('/dev/reset', json('POST', {})),
}
