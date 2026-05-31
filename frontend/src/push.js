// Browser push subscription flow. The service worker (public/sw.js) handles
// the incoming push + notification click; this module handles opting in.
import { api } from './api'

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function pushPermission() {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

// VAPID public key (base64url) → Uint8Array for applicationServerKey.
function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

// Request permission, subscribe, and register the subscription with the backend.
// Returns the resulting permission string; throws on unexpected failure.
export async function enablePush() {
  if (!pushSupported()) throw new Error('Push not supported in this browser')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission

  const reg = await navigator.serviceWorker.ready
  const { public_key } = await api.vapidPublicKey()

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(public_key),
    })
  }
  await api.subscribePush(sub.toJSON())
  return 'granted'
}
