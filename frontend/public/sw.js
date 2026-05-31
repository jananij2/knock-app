// Knock service worker.
// Push *receiving* is wired here; the backend sender + VAPID keys land in
// build step 5. Until then this registers cleanly and handles a push payload
// if one ever arrives (e.g. via DevTools "Push" test).

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = { title: 'New job', body: 'A new job was dispatched.', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || 'knock-job',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.navigate(url).then(() => c.focus())
      }
      return self.clients.openWindow(url)
    }),
  )
})
