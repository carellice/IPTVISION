// IPTVISION service worker: keeps the app shell offline. Lists and streams always come from the server.
const BUILD = '__BUILD__'
const FILES = __FILES__
const CACHE = `iptvision-${BUILD}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('iptvision-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    // The page itself always comes from the server when online, so updates show up at once.
    event.respondWith(fetch(request).catch(() => caches.match('/')))
    return
  }
  if (url.pathname.startsWith('/assets/') || FILES.includes(url.pathname)) {
    // Hashed assets never change: cache first.
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })),
    )
  }
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})
