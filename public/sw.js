const SCOPE_PATH = new URL(self.registration.scope).pathname
const CACHE_PREFIX = `cloudring-shell:${SCOPE_PATH}:`
const CACHE = `${CACHE_PREFIX}v1`
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(['./', './manifest.webmanifest'])
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Auth, Supabase REST, Storage, and function responses are never cached.
  if (/\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\/|\/functions\/v1\//.test(url.pathname)) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE)
      return (await cache.match('./')) || Response.error()
    }))
    return
  }
  if (url.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(request)
      if (hit) return hit
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    })())
  }
})
self.addEventListener('push', event => {
  let data = {}
  try { const parsed = event.data?.json(); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed } catch { data = { body: event.data?.text() || '' } }
  const title = typeof data.title === 'string' ? data.title.slice(0, 80) : 'CloudRing'
  const body = typeof data.body === 'string' ? data.body.slice(0, 180) : '새 알림이 있습니다.'
  const target = typeof data.url === 'string' ? data.url : './#/app'
  event.waitUntil(self.registration.showNotification(title, {
    body, tag: typeof data.tag === 'string' ? data.tag.slice(0, 120) : 'cloudring-update',
    icon: './icons/cloudring-192.png', badge: './icons/cloudring-192.png', data: { target },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const scope = new URL(self.registration.scope)
  let target = new URL('./#/app', scope)
  try {
    const candidate = new URL(event.notification.data?.target || './#/app', scope)
    if (candidate.origin === scope.origin && candidate.pathname.startsWith(scope.pathname) && !candidate.username && !candidate.password) target = candidate
  } catch { /* Keep the same-origin app target. */ }
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) if (new URL(client.url).origin === scope.origin && new URL(client.url).pathname.startsWith(scope.pathname)) {
      await client.navigate(target.href); return client.focus()
    }
    return self.clients.openWindow(target.href)
  })())
})
