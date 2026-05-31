import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { ShiftProvider } from './ShiftContext.jsx'
import './styles.css'

// Register the service worker (push handling lands in build step 5).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ShiftProvider>
        <App />
      </ShiftProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
