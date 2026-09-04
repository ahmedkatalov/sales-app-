/*
 * Okvion Sales service worker.
 * Цели: сделать приложение устанавливаемым (PWA) и дать базовую офлайн-заглушку,
 * НЕ ломая продакшн, который отдаётся Vite dev-сервером (HMR, /src/, /@vite, /api/).
 *
 * Стратегия:
 *   • переходы по страницам (navigate) — сеть-сначала, при офлайне отдаём кэш "/" или заглушку;
 *   • картинки/манифест/шрифты — stale-while-revalidate (быстро и обновляется в фоне);
 *   • всё остальное — сеть-сначала с откатом в кэш;
 *   • служебные запросы Vite и /api/ не трогаем вовсе.
 *
 * Чтобы принудительно обновить кэш у всех — поднимите VERSION.
 */
const VERSION = 'v1';
const CACHE = `okvion-sales-${VERSION}`;
const SHELL = ['/', '/manifest.webmanifest', '/pwa-192.png', '/pwa-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // add по одному: если какой-то ресурс не отдастся, установка не падает целиком
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Запросы, которые сервис-воркер не должен трогать (иначе сломается dev-сервер/HMR/API).
function isBypassed(url) {
  const p = url.pathname;
  return (
    p.startsWith('/api/') ||
    p.startsWith('/@') ||            // /@vite, /@react-refresh, /@fs, /@id
    p.startsWith('/src/') ||        // исходные модули, отдаёт Vite
    p.startsWith('/node_modules/') ||
    p.includes('/.vite/') ||
    url.search.includes('import') ||
    p === '/sw.js'
  );
}

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<body style="font-family:system-ui,-apple-system,sans-serif;background:#060c1c;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
  '<div><div style="font-size:56px">☕️</div>' +
  '<h1 style="margin:12px 0 6px;font-size:20px">Нет соединения</h1>' +
  '<p style="opacity:.65;margin:0">Проверьте интернет и обновите страницу.</p></div></body>';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // сторонние домены — как обычно
  if (isBypassed(url)) return;

  // Навигации: сеть-сначала, офлайн — кэш оболочки или заглушка.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('/', net.clone()); // держим свежую оболочку
        return net;
      } catch {
        const cached = (await caches.match('/')) || (await caches.match(req));
        return cached || new Response(OFFLINE_HTML, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    })());
    return;
  }

  // Картинки / манифест / шрифты: stale-while-revalidate.
  if (/\.(png|jpe?g|svg|ico|webmanifest|webp|woff2?)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })());
    return;
  }

  // Прочее (тот же домен): сеть-сначала с откатом в кэш.
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      if (net && net.status === 200) {
        const cache = await caches.open(CACHE);
        cache.put(req, net.clone());
      }
      return net;
    } catch {
      const cached = await caches.match(req);
      return cached || Response.error();
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
