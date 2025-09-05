// --- Service Worker 登録（そのまま維持） ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js")
    .then(reg => console.log("SW registered:", reg.scope))
    .catch(err => console.error("SW registration failed:", err));
}

// --- 要素参照 ---
const frame  = document.getElementById("frame");      // <iframe id="frame">
const tocEl  = document.getElementById("toc");        // <ul id="toc">
const titleH = document.getElementById("bookTitle");  // 任意: <h2 id="bookTitle">
const status = document.getElementById("status");     // 任意: ステータス表示があるなら

// --- 目次読み込み（list.jsonのtocだけ使う） ---
(async () => {
  try {
    const book = await fetch("./puzzles/list.json").then(r => r.json());
    if (titleH && book.title) titleH.textContent = book.title;

    book.items.forEach((it, idx) => {
      const label = it.toc || it.id || it.file;
      const li = document.createElement("li");
      li.innerHTML = `<button data-file="${it.file}">${idx + 1}. ${label}</button>`;
      li.querySelector("button").onclick = () => loadPuzzle(it.file, label);
      tocEl.appendChild(li);
    });

    // 初期表示（1問目）
    if (book.items[0]) loadPuzzle(book.items[0].file, book.items[0].toc || book.items[0].id);
  } catch (e) {
    console.error("list.json 読み込み失敗:", e);
  }
})();

// --- パズル読み込み ---
async function loadPuzzle(file, label) {
  if (status) status.textContent = "読み込み中…";
  frame.src = `./puzzles/${file}`;
  await new Promise(res => (frame.onload = res));
  if (status) status.textContent = "OK";

  // タイトル調整（任意）
  try {
    if (label) frame.contentDocument.title = label;
  } catch (e) {
    console.warn("子ドキュメント操作スキップ:", e);
  }
}

// --- 外側オートフィット（高さ基準でスケール） ---
const frameWrap = frame.parentElement; // iframeを包む親<div>を想定
frameWrap.style.transformOrigin = "top left";

function fitOuter() {
  frameWrap.style.transform = "none";

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fw = frame.clientWidth;
  const fh = frame.clientHeight;

  if (fh > 0) {
    const s = vh / fh; // 高さ基準で縮小
    frameWrap.style.transform = `scale(${s})`;
  }
}

window.addEventListener("resize", fitOuter);
window.addEventListener("orientationchange", fitOuter);
frame.addEventListener("load", fitOuter);

// --- iOS 音声アンロック（初回タップ1回だけ） ---
let audioUnlocked = false;
window.addEventListener("pointerdown", async () => {
  if (audioUnlocked) return;
  try {
    const a = new Audio(); // 無音再生で権限解放
    await a.play().catch(()=>{});
    a.pause(); a.currentTime = 0;
  } catch {}
  audioUnlocked = true;
}, { once: true });
