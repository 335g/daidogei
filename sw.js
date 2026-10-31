const CACHE = 'daidogei2026-v14';
const FILES = ['./', './index.html', './data.js', './assets/parkmap.jpg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 通信できるときは常に新しいものを取りに行く。圏外のときだけキャッシュを使う。
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const bust = e.request.mode === 'navigate' || e.request.destination === 'script';
  e.respondWith(
    fetch(e.request, bust ? { cache: 'no-store' } : {}).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
