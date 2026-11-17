/* Service worker: aplikasi tetap bisa dipakai tanpa internet.
   Strategi: utamakan jaringan (agar selalu dapat versi terbaru), pakai cache bila offline. */
const CACHE = 'nutri-calc-v13';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'data/foods.json', 'data/akg.json', 'data/version.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function timeout(ms, p) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, err => { clearTimeout(t); rej(err); }); }); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const big = req.url.includes('usda.json');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.url.split('?')[0];
    if (big) { // 4,5 MB: ambil sekali, lalu dari cache
      const hit = await cache.match(key);
      if (hit) return hit;
    }
    // Database (foods.json ±900 KB) butuh waktu lebih lama di jaringan HP: beri waktu 30 detik.
    // Kalau tetap lewat batas waktu, unduhan diteruskan di latar dan tetap disimpan ke cache.
    const data = /\/data\/[^/]+\.json/.test(key);
    const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) cache.put(key, r.clone()); return r; });
    try {
      const fresh = await timeout(big ? 60000 : data ? 30000 : 6000, net);
      return fresh;
    } catch (err) {
      e.waitUntil(net.catch(() => {}));
      const hit = await cache.match(key) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
