const CACHE = 'daidogei2026-v17';
const PHOTOS = 'daidogei2026-photos';
const FILES = ['./', './index.html', './data.js', './assets/parkmap.jpg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((k) => k !== CACHE && k !== PHOTOS && k.indexOf('daidogei2026') === 0)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // 写真は一度取れたらキャッシュ優先。圏外でも顔が出る。
  if (e.request.destination === 'image' || /cdn\.daidogei\.com/.test(e.request.url)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(PHOTOS).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  // それ以外は通信優先。圏外のときだけキャッシュを使う。
  const bust = e.request.mode === 'navigate' || e.request.destination === 'script';
  e.respondWith(
    fetch(e.request, bust ? { cache: 'no-store' } : {}).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
