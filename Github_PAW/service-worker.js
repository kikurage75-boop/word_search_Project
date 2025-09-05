// service-worker.js  — 最小プリキャッシュ版
// 変更のたびに必ず番号↑
const CACHE = "ws-cache-v7";

// ★“起動直後に必ず必要なもの”だけ
const ASSETS = [
  // ---- App Shell ----
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.json",
  "./icon.png",

  // ---- 目次 ----
  "./puzzles/list.json",

  // ---- 共通アイコン ----
  "./puzzles/icons/icon_answer.png",
  "./puzzles/icons/icon_eraser.png",
  "./puzzles/icons/icon_pencil.png",
  "./puzzles/icons/icon_printer.png",

  // ---- 最初の数問（任意：デモ用/安心材料）----
  "./puzzles/0001.html",
  "./puzzles/0002.html",

  // "./payload.json" // ←本当に使っている時だけ入れる
];

// install: 事前キャッシュ
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

// activate: 古いキャッシュの完全掃除
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// fetch:
// 1) HTMLナビゲーションはネット優先→失敗時 index.html（App Shell）
// 2) それ以外はキャッシュ優先（なければネット）＝オンデマンドで蓄積
self.addEventListener("fetch", (e) => {
  const req = e.request;

  // HTMLナビ
  if (
    req.mode === "navigate" ||
    (req.method === "GET" && req.headers.get("accept")?.includes("text/html"))
  ) {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }

  // 静的資産（JS/CSS/画像/音声など）
  e.respondWith(caches.match(req).then((res) => res || fetch(req)));
});
