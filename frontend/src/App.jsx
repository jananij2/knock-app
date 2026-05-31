import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useShift } from './ShiftContext'
import Splash from './components/Splash.jsx'
import Home from './screens/Home.jsx'
import ShiftEnded from './screens/ShiftEnded.jsx'
import JobDetail from './screens/JobDetail.jsx'
import ConfirmSend from './screens/ConfirmSend.jsx'
import VipGate from './screens/VipGate.jsx'
import JobInProgress from './screens/JobInProgress.jsx'
import ResolutionConfirm from './screens/ResolutionConfirm.jsx'
import Done from './screens/Done.jsx'
import Escalate from './screens/Escalate.jsx'
import EndOfShift from './screens/EndOfShift.jsx'
import Inbox from './screens/Inbox.jsx'
import Thread from './screens/Thread.jsx'
import AdHocForm from './screens/AdHocForm.jsx'

export default function App() {
  const [ready, setReady] = useState(false)
  const { ended } = useShift()
  return (
    <div className="phone">
      {!ready && <Splash onDone={() => setReady(true)} />}
      <Routes>
        <Route path="/" element={ended ? <ShiftEnded /> : <Home />} />
        <Route path="/messages" element={<Inbox />} />
        <Route path="/messages/:id" element={<Thread />} />
        <Route path="/jobs/new" element={<AdHocForm />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/jobs/:id/message" element={<ConfirmSend />} />
        <Route path="/jobs/:id/vip-gate" element={<VipGate />} />
        <Route path="/jobs/:id/progress" element={<JobInProgress />} />
        <Route path="/jobs/:id/resolve" element={<ResolutionConfirm />} />
        <Route path="/jobs/:id/done" element={<Done />} />
        <Route path="/jobs/:id/escalate" element={<Escalate />} />
        <Route path="/shift/end" element={<EndOfShift />} />
      </Routes>
    </div>
  )
}
