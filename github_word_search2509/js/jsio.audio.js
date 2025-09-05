// jsio.audio.js — 音声一括読込（フォルダOK）＋オンデマンド再生
// UI側だけで読み込む。出力HTMLには読み込まない。
(function(){
  const N = (s)=> String(s||'').replace(/\uFEFF/g,'').normalize('NFC');
  const keyOf = (kana, yomi)=> N((yomi && yomi.trim()) ? yomi : (kana||'')).trim();

  const fileIndex = new Map();   // key -> File
  const urlCache = new Map();    // key -> {url, ts}
  const MAX_URLS = 200;

  function evictIfNeeded(){
    if(urlCache.size <= MAX_URLS) return;
    const arr = [...urlCache.entries()].sort((a,b)=> a[1].ts - b[1].ts);
    const drop = Math.max(20, Math.ceil(urlCache.size*0.25));
    for(let i=0;i<drop;i++){
      const [k, v] = arr[i];
      try{ URL.revokeObjectURL(v.url); }catch(_){}
      urlCache.delete(k);
    }
  }

  function hasAudio(kana, yomi){
    const k = keyOf(kana, yomi);
    return fileIndex.has(k);
  }

  function getUrlFor(kana, yomi){
    const k = keyOf(kana, yomi);
    if(!fileIndex.has(k)) return null;
    if(urlCache.has(k)){
      const ent = urlCache.get(k); ent.ts = Date.now(); return ent.url;
    }
    const f = fileIndex.get(k);
    const url = URL.createObjectURL(f);
    urlCache.set(k, {url, ts: Date.now()});
    evictIfNeeded();
    return url;
  }

  async function pickAndIndex(){
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.mp3,audio/wav';
    inp.multiple = true;
    // フォルダ選択（Chrome系）。他ブラウザは無視されてもOK
    inp.setAttribute('webkitdirectory', '');
    const done = new Promise(resolve=>{
      inp.onchange = async ()=> {
        const files = Array.from(inp.files||[]);
        if(!files.length){ resolve({total:0, indexed:0}); return; }
        let total = 0, indexed = 0;
        for(const f of files){
          if(!f.name.toLowerCase().endsWith('.mp3')) continue;
          total++;
          const name = N(f.name.replace(/^.*[\\/]/,'').replace(/\.mp3$/i,'').trim());
          if(!name) continue;
          fileIndex.set(name, f); // 後勝ち
          indexed++;
        }
        resolve({total, indexed});
      };
    });
    inp.click();
    return await done;
  }

  async function play(kana, yomi){
    const url = getUrlFor(kana, yomi);
    if(!url) throw new Error('audio not found');
    const a = new Audio(url);
    a.play().catch(()=>{ /* 無音失敗は黙殺 */ });
  }

  function clear(){
    for(const {url} of urlCache.values()){
      try{ URL.revokeObjectURL(url); }catch(_){}
    }
    urlCache.clear();
    fileIndex.clear();
  }

  // 公開API
  window.AudioIO = {
    async pickAndIndex(){ return await pickAndIndex(); },
    has(kana, yomi){ return hasAudio(kana, yomi); },
    async play(kana, yomi){ return await play(kana, yomi); },
    clear(){ clear(); }
  };
})();
