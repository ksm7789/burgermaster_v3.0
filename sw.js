// sw.js — Burger master (auto-discover CORE_ASSETS from index.html)
const VERSION = 'bm-v1.1.0';               // 파일 바꿀 때마다 버전 올려주세요
const BASE    = '/burgermaster_v3.0/';
const CACHE   = `BM-${VERSION}`;

// 항상 포함할 기본 자원(루트 기준 경로)
const STATIC_ALWAYS = [
  `${BASE}`,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}web_icon_192.png`,
  `${BASE}web_icon_512.png`,
  `${BASE}web_icon_512_maskable.png`,
];

// index.html을 파싱하여 링크된 자원을 자동 추출
async function discoverAssets() {
  try {
    const res = await fetch(`${BASE}index.html`, { cache: 'no-store' });
    const html = await res.text();

    // 간단한 정규식으로 href/src 추출 (JS/CSS/이미지/폰트 등)
    const re = /(href|src)\s*=\s*["']([^"']+)["']/gi;
    const found = new Set();

    let m;
    while ((m = re.exec(html)) !== null) {
      let url = m[2].trim();
      if (!url) continue;

      // 해시/메일/전화 링크 제외
      if (url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:')) continue;

      // 절대/상대 경로를 BASE 기준으로 정규화
      try {
        const abs = new URL(url, self.location.origin + BASE);
        // 동일 오리진 + 스코프 내 파일만
        if (abs.origin === self.location.origin && abs.pathname.startsWith(BASE)) {
          found.add(abs.pathname + (abs.search || ''));
        }
      } catch (e) {
        // URL 파싱 실패는 무시
      }
    }

    // HTML 안에 동적으로 import되는 모듈/워커/폰트 확장자도 포함되도록 필터 확장 가능
    // 여기서는 발견된 모든 정적 경로를 캐싱
    return Array.from(found);
  } catch (e) {
    // index.html 접근 실패 시 기본만 반환
    return [];
  }
}

// 설치: 기본 자원 + 자동 발견 자원 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const autoAssets = await discoverAssets();
    const assets = Array.from(new Set([...STATIC_ALWAYS, ...autoAssets]));
    const cache = await caches.open(CACHE);
    await cache.addAll(assets);
  })());
  self.skipWaiting();
});

// 활성화: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k.startsWith('BM-') && k !== CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Range(미디어), POST, 교차 오리진은 건드리지 않음
  const isRange = req.headers.has('range');
  const sameOrigin = new URL(req.url).origin === location.origin;
  if (!sameOrigin || req.method !== 'GET' || isRange) return;

  // 우리 앱 스코프만 처리
  const path = new URL(req.url).pathname;
  if (!path.startsWith(BASE)) return;

  // 대용량 미디어/폰트는 캐시 제외(필요 시 확장자 조정)
  if (/\.(mp3|wav|ogg|mp4|webm|woff2?)$/i.test(path)) return;

  // 탐색 요청은 오프라인 우선
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(`${BASE}index.html`).then((cached) =>
        cached || fetch(req).then(r => r)
      )
    );
    return;
  }

  // 나머지는 SWR(stale-while-revalidate)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || net;
  })());
});
