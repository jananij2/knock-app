import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Frontend on :5173, backend on :5001. Proxy /api so the browser sees a
// single origin (also sidesteps CORS in dev).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // listen on all interfaces so a phone on the same WiFi can reach it
    port: 5173,
    proxy: {
      // proxy runs on this machine, so it still reaches the backend via localhost
      '/api': 'http://localhost:5001',
    },
  },
})
