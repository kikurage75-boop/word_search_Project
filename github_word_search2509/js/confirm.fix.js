// confirm.fix.js — drop-in patch for "確定（商品用に保存）"
// 依存: window.KotoDB (jsio.db.js), 既存の payload 取得関数 (buildPayloadForOutput / getCurrentPuzzle)
// 使い方: index.html の末尾で main.js / exporter.js の **後**に読み込むだけ。

(function(){
  // すでに適用済みなら二重登録しない
  if (window.__kotoConfirmPatched) return;
  window.__kotoConfirmPatched = true;

  function findBtn(){
    return document.getElementById('btnConfirm') || document.querySelector('#btnConfirm');
  }

  // 画面 → payload 取得の総当たりヘルパ
  function getPayload(){
    try {
      if (typeof window.buildPayloadForOutput === 'function') return window.buildPayloadForOutput();
      if (typeof window.getCurrentPuzzle === 'function')      return window.getCurrentPuzzle();
      if (window.currentPayload)                               return window.currentPayload;
    } catch (e) { console.warn('[confirm.fix] payload取得エラー:', e); }
    return null;
  }

  async function save(rec){
    if (!window.KotoDB || typeof KotoDB.dbAddConfirmed !== 'function') {
      alert('保存先DB(KotoDB)が見つかりません（jsio.db.jsの読み込み順を確認）');
      return;
    }
    await KotoDB.dbAddConfirmed(rec);
    if (typeof KotoDB.dbGetUnexportedCount === 'function') {
      const n = await KotoDB.dbGetUnexportedCount();
      const badge = document.getElementById('unexportedBadge');
      if (badge) badge.textContent = `未出力 ${n} 件`;
    }
  }

  function install(){
    const old = findBtn();
    if (!old) return; // ボタンがない画面

    // 既存の誤ハンドラを根こそぎ除去（クローン置換）
    const btn = old.cloneNode(true);
    btn.setAttribute('type','button');
    old.replaceWith(btn);

    // 本番確定ハンドラ
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopImmediatePropagation();

      const p = getPayload();
      if (!p || !Array.isArray(p.grid) || !Array.isArray(p.words)) {
        alert('まだ完成していません（語群→辞書→音声→自動生成→空き補充→別解→確定の順）');
        return;
      }

      const rec = {
        id: 'p' + Date.now(),
        createdAt: new Date().toISOString(),
        title: p.subtitle || '無題',
        difficulty: p.difficulty || 'normal',
        exported: false,
        payload: p
      };

      try {
        await save(rec);
        alert('確定しました（保存完了）');
      } catch (err) {
        console.error('[confirm.fix] 保存失敗:', err);
        alert('保存に失敗しました: ' + (err?.message || err));
      }
    }, true); // captureで他の残存リスナーより先に処理
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
