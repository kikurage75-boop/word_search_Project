// [ROLE: GENERATOR] Restart: 複数ページ + サイズ可変 + 空き補充 + 解答表示 + 難易度5段階（expert重なりOK） + 音声 + 別解チェック + 全セル編集 + 出力ブリッジ + 保存一覧（復元） + 単体HTML書き出し
document.addEventListener('DOMContentLoaded', () => {
  // ===== DOM
  const $ = s => document.querySelector(s);
  const btnLoadWords = $('#btnLoadWords');
  const btnLoadDict  = $('#btnLoadDict');
  const btnLoadAudio = $('#btnLoadAudio');
  const btnGenerate  = $('#btnGenerate');
  const btnFill      = $('#btnFill');
  const selFillMode  = $('#fillMode');
  const chkAnswers   = $('#chkAnswers');
  const btnPrev      = $('#btnPrev');
  const btnNext      = $('#btnNext');
  const pageLabel    = $('#pageLabel');
  const subtitleMeta = $('#subtitleMeta');
  const gridContainer= $('#gridContainer');
  const wordList     = $('#wordList');
  const selDiff      = $('#selDiff');
  const inpW         = $('#inpW');
  const inpH         = $('#inpH');
  const btnCheckAlt  = $('#btnCheckAlt');
  const inpCopyright = $('#inpCopyright');

  // 出力ボタン（デジタル／PDFは残すが使わなくてもOK）
  const btnDigital   = $('#btnDigital');
  const btnPDF       = $('#btnPDF');

  // ===== state
  let pages = [{ subtitle:'無題', words:[] }];
  let pageIndex = 0;
  let dict = new Map(); // kana -> {en, romaji, yomi?}
  let difficulty = selDiff ? selDiff.value : 'normal';
  let W = clamp(+inpW?.value || 10, 4, 20);
  let H = clamp(+inpH?.value || 10, 4, 20);
  let grid = createGrid(W,H);
  let placements = [];
  let altOverlays = [];
  let copyrightText = inpCopyright?.value || '2025 nekonobinobi';

  // ===== helpers
  function clamp(v,min,max){ return Math.min(max, Math.max(min, v)); }
  const normalizeNFC = s => String(s||'').replace(/\uFEFF/g,'').normalize('NFC');

  // ===== UI events
  btnLoadWords?.addEventListener('click', async () => {
    const text = await pickFile('.txt,.text');
    if (text == null) return;
    pages = parseWordlist(text);
    pageIndex = 0;
    renderWordsPanel();
    updateFooter();
    toast('語群を読み込みました');
  });

  btnLoadDict?.addEventListener('click', async () => {
    const text = await pickFile('.csv,text/csv');
    if (text == null) return;
    const rows = parseDictionary(text);
    dict = new Map(rows.map(r => [r.kana, r]));
    renderWordsPanel();
    toast(`辞書CSVを読み込みました（${rows.length}行）`);
  });

  btnLoadAudio?.addEventListener('click', async ()=>{
    if(!window.AudioIO){ toast('AudioIOが読み込まれていません'); return; }
    const res = await AudioIO.pickAndIndex();
    toast(`音声を読み込みました：${res.indexed}/${res.total}`);
    renderWordsPanel();
  });

  selDiff?.addEventListener('change', ()=>{
    difficulty = selDiff.value;
    toast(`難易度: ${difficulty}`);
  });

  inpW?.addEventListener('input', ()=>{
    W = clamp(+inpW.value||10, 4, 20); inpW.value = String(W);
    resetBoard();
  });
  inpH?.addEventListener('input', ()=>{
    H = clamp(+inpH.value||10, 4, 20); inpH.value = String(H);
    resetBoard();
  });

  btnGenerate?.addEventListener('click', onGenerate);
  btnFill?.addEventListener('click', () => {
    fillEmpties(grid, selFillMode.value);
    renderGrid(grid, placements);
    toast('空きマスを補充しました');
  });

  chkAnswers?.addEventListener('change', () => {
    document.body.dataset.answers = chkAnswers.checked ? 'on' : 'off';
  });

  btnPrev?.addEventListener('click', () => { if(pageIndex>0){ pageIndex--; afterPageChange(); }});
  btnNext?.addEventListener('click', () => { if(pageIndex<pages.length-1){ pageIndex++; afterPageChange(); }});

  btnCheckAlt?.addEventListener('click', onCheckAlternatives);

  inpCopyright?.addEventListener('input', ()=>{ copyrightText = inpCopyright.value; });

  // === 出力（オプション）
  btnDigital?.addEventListener('click', ()=>{
    const payload = buildPayloadForOutput();
    if(!payload) return;
    window.payload = payload;
    openDigital(payload);
  });
  btnPDF?.addEventListener('click', ()=>{
    const payload = buildPayloadForOutput();
    if(!payload) return;
    openPDF(payload);
  });

  // =========================
  // 単体HTML書き出しボタン（右下）
  // =========================
  let btnStandalone = document.getElementById('btnStandalone');
  if (!btnStandalone) {
    btnStandalone = document.createElement('button');
    btnStandalone.id = 'btnStandalone';
    btnStandalone.textContent = '単体HTML';
    Object.assign(btnStandalone.style, {
      position:'fixed', right:'16px', bottom:'56px', zIndex: 10000
    });
    document.body.appendChild(btnStandalone);
  }
  btnStandalone.addEventListener('click', () => {
  const payload = buildPayloadForOutput();
  if (!payload) return;

  // ★ 連番を localStorage で持つ（ブラウザ内で自動カウント）
  const key = 'ws_standalone_seq';
  const next = (n => String(n).padStart(4, '0'))((parseInt(localStorage.getItem(key) || '0', 10) + 1));
  localStorage.setItem(key, String(parseInt(next, 10))); // 保存

  // HTML組み立て（元の関数でOK）
  const html = buildStandaloneHTML(payload);

  // ダウンロード（ファイル名を強制）
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${next}.html`;   // ← ここで固定（0001.html など）
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari 対策で少し遅らせて解放
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast(`単体HTMLを書き出しました（${next}.html）`);
});
;

  // ===== 生成（配置）
  function onGenerate(){
    const p = pages[pageIndex] || {subtitle:'無題', words:[]};
    if(!p.words.length){ toast('語がありません'); return; }
    grid = createGrid(W,H);
    const res = placeWords(grid, p.words, {w:W,h:H}, difficulty);
    grid = res.grid; placements = res.placements;
    renderGrid(grid, placements);
    if(res.failures.length) toast(`配置失敗：${res.failures.length}件（${res.failures.join('、')}）`);
    else toast('自動生成しました');
  }

  // ===== 出力用ペイロード（完成前提）
  function buildPayloadForOutput(){
    const p = pages[pageIndex] || {subtitle:'無題', words:[]};
    if(!p.words.length){ toast('語がありません'); return null; }
    if(!placements.length){ toast('まず「自動生成」してください'); return null; }

    const ov = p.overrides || {};
    const wordRows = p.words.map(kana=>{
      const m  = dict.get(kana);
      const o  = ov[kana] || {};
      return {
        kana,
        romaji: (o.romaji ?? m?.romaji ?? kanaToRomajiWithMacron(kana)),
        en    : (o.en     ?? m?.en     ?? ''),
        yomi  : (m?.yomi  ?? '')
      };
    });

    return {
      title: 'Japanese Word search',
      subtitle: p.subtitle || '無題',
      difficulty,
      grid,
      placements,
      words: wordRows,
      size: { w: W, h: H },
      copyright: copyrightText,
      answersOn: !!(chkAnswers && chkAnswers.checked)
    };
  }
  window.buildPayloadForOutput = buildPayloadForOutput;

  // ====== 「いつでも保存」用スナップショット
  function buildStateForSave(){
    const dictRows = Array.from(dict.values());
    return {
      meta: { savedAt: new Date().toISOString() },
      ui  : { pageIndex, W, H, difficulty, answersOn: !!(chkAnswers && chkAnswers.checked), copyrightText },
      pages,
      dict: dictRows,
      grid,
      placements,
      altOverlays
    };
  }
  window.buildStateForSave = buildStateForSave;

  // ===== グリッド描画
  function resetBoard(){
    placements = [];
    altOverlays = [];
    grid = createGrid(W,H);
    renderGrid(grid, placements);
  }
  function afterPageChange(){
    renderWordsPanel();
    updateFooter();
    resetBoard();
  }

  function createGrid(w,h){ return Array.from({length:h}, ()=> Array.from({length:w}, ()=>'')); }
  function rng(seed){ return function(){ let t = seed += 0x6D2B79F5; t = Math.imul(t ^ (t>>>15), t|1); t ^= t + Math.imul(t ^ (t>>>7), t|61); return ((t ^ (t>>>14))>>>0)/4294967296; } }

  const HIRA = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんゃゅょっがぎぐげござじずぜぞだぢづでどぱぴぷぺぽー'];
  const KATA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンャュョッガギグゲゴザジズゼゾダヂヅデドパピプペポー'];
  const ALPH = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
  const KANJ = [...'一二三四五六上下左右大小山川日月火水木金土人目耳手足力学校生時間愛猫犬鳥車雨雪風空'];

  function fillEmpties(g, mode){
    const set = mode==='hira'?HIRA:mode==='kata'?KATA:mode==='alpha'?ALPH:KANJ;
    const rnd = rng((Math.random()*1e9)>>>0);
    for(let y=0;y<g.length;y++) for(let x=0;x<g[0].length;x++) if(!g[y][x]) g[y][x]=set[(rnd()*set.length)|0];
  }

  // ===== placement
  const DIRS = {N:{dx:0,dy:-1}, S:{dx:0,dy:1}, E:{dx:1,dy:0}, W:{dx:-1,dy:0}, NE:{dx:1,dy:-1}, NW:{dx:-1,dy:-1}, SE:{dx:1,dy:1}, SW:{dx:-1,dy:1}};

  const ALLOWED = {
    'very-easy': ['S','E'],
    'easy'     : ['N','S','E','W'],
    'normal'   : ['N','S','E','W','SE','SW'],
    'hard'     : ['N','S','E','W','NE','NW','SE','SW'],
    'expert'   : ['N','S','E','W','NE','NW','SE','SW']
  };

  const CROSS_LIMIT = {
    'very-easy': 1,
    'easy'     : 1,
    'normal'   : 1,
    'hard'     : 2,
    'expert'   : Infinity
  };

  function charAt(word,i){ return [...normalizeNFC(word)][i]; }
  function shuffle(arr, rnd){ for(let i=arr.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
  function allCells(size, rnd){ const pts=[]; for(let y=0;y<size.h;y++) for(let x=0;x<size.w;x++) pts.push({x,y}); return shuffle(pts, rnd); }
  function fitsGrid(word,size){ return [...normalizeNFC(word)].length <= Math.max(size.w,size.h); }

  function countUsage(pls){
    const m=new Map();
    for(const p of pls){
      for(const c of p.cells){
        const k=`${c.x},${c.y}`;
        m.set(k,(m.get(k)||0)+1);
      }
    }
    return m;
  }

  function isOverlapAllowed(candidate, placed, d){
    const usage = countUsage(placed);
    const limit = CROSS_LIMIT[d] ?? 1;

    for(const pl of placed){
      let shared=0;
      const setB = new Set(pl.cells.map(c=>`${c.x},${c.y}`));
      for(const a of candidate.cells){
        const k=`${a.x},${a.y}`;
        if(setB.has(k)){
          shared++;
          const used = usage.get(k) || 0;
          if(used + 1 > limit) return false;
        }
      }
      if(shared > 1) return false;
      if(shared > 0 && limit === 1) return false;
    }
    return true;
  }

  function cellsFor(word,start,dir,size){
    const {dx,dy}=DIRS[dir]; const cells=[]; const L=[...normalizeNFC(word)].length;
    let x=start.x,y=start.y;
    for(let i=0;i<L;i++){
      if(x<0||y<0||x>=size.w||y>=size.h) return null;
      cells.push({x,y}); x+=dx; y+=dy;
    }
    return cells;
  }

  function placeWords(g, words, size, d){
    const failures=[]; const placements=[]; const allowed=ALLOWED[d]; const grid=g.map(r=>r.slice());
    const rnd = rng( (((Math.random()*1e9)|0) ^ (Date.now()&0xffffffff))>>>0 );

    const sorted = words.slice().map(w=>({w,k:rnd()}))
      .sort((A,B)=> ([...normalizeNFC(B.w)].length - [...normalizeNFC(A.w)].length) || (A.k - B.k))
      .map(o=>o.w);

    const starts = allCells(size, rnd);

    for(const word of sorted){
      if(!fitsGrid(word,size)){ failures.push(word); continue; }
      let placed=false;
      const dirs = shuffle(allowed.slice(), rnd);
      for(const s of starts){
        for(const dir of dirs){
          const cells = cellsFor(word, s, dir, size); if(!cells) continue;

          let ok=true;
          for(let i=0;i<cells.length;i++){
            const c=cells[i]; const prev=grid[c.y][c.x];
            if(prev && prev!==charAt(word,i)){ ok=false; break; }
          }
          if(!ok) continue;

          const cand={word, cells};
          if(!isOverlapAllowed(cand, placements, d)) continue;

          for(let i=0;i<cells.length;i++){
            const c=cells[i]; grid[c.y][c.x]=charAt(word,i);
          }
          placements.push(cand); placed=true; break;
        }
        if(placed) break;
      }
      if(!placed) failures.push(word);
    }
    return { grid, placements, failures };
  }

  // ===== render
  function renderGrid(g, placements){
    gridContainer.innerHTML = '<div class="meta" id="pageMeta"></div>';
    const wrap = document.createElement('div');
    wrap.className='grid-wrap';

    const gridEl = document.createElement('div');
    gridEl.className='grid';
    gridEl.style.gridTemplateColumns = `repeat(${g[0].length}, var(--cell))`;

    for(let y=0;y<g.length;y++){
      for(let x=0;x<g[0].length;x++){
        const d=document.createElement('div');
        d.className='cell';
        d.contentEditable = 'true';
        d.textContent = g[y][x] || '';
        d.addEventListener('input', ()=>{
          let t = normalizeNFC(d.textContent||'');
          const chars = [...t];
          t = chars.length? chars[0] : '';
          if(d.textContent !== t) d.textContent = t;
          g[y][x] = t;
        });
        d.addEventListener('blur', ()=>{
          let t = normalizeNFC(d.textContent||'');
          const chars = [...t];
          t = chars.length? chars[0] : '';
          d.textContent = t;
          g[y][x] = t;
        });
        gridEl.appendChild(d);
      }
    }
    wrap.appendChild(gridEl);

    const cell = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell'))||36;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('id','answerOverlay');
    svg.setAttribute('width', String(g[0].length*cell));
    svg.setAttribute('height', String(g.length*cell));

    {
      const round1 = v => Math.round(v * 10) / 10;
      const thickness = cell * 0.72;
      for (const pl of placements) {
        const len = pl.cells.length;
        const f = pl.cells[0], l = pl.cells[len - 1];
        const cx = ((f.x + l.x) / 2) * cell + cell / 2;
        const cy = ((f.y + l.y) / 2) * cell + cell / 2;
        const dx = l.x - f.x, dy = l.y - f.y;
        const diagonal = (dx !== 0 && dy !== 0);
        const step = diagonal ? cell * Math.SQRT2 : cell;
        const lengthPx = step * (len - 1) + thickness;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', round1(cx - lengthPx / 2));
        rect.setAttribute('y', round1(cy - thickness / 2));
        rect.setAttribute('width',  round1(lengthPx));
        rect.setAttribute('height', round1(thickness));
        rect.setAttribute('rx', String(thickness / 2));
        rect.setAttribute('ry', String(thickness / 2));
        rect.setAttribute('class', 'answer');
        rect.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
        svg.appendChild(rect);
      }
    }

    for(const hit of altOverlays){
      const f=hit.cells[0], l=hit.cells[hit.cells.length-1];
      const x1=f.x*cell+cell/2, y1=f.y*cell+cell/2;
      const x2=l.x*cell+cell/2, y2=l.y*cell+cell/2;
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',x1); line.setAttribute('y1',y1);
      line.setAttribute('x2',x2); line.setAttribute('y2',y2);
      line.setAttribute('class','alt');
      svg.appendChild(line);
    }

    wrap.appendChild(svg);
    gridContainer.appendChild(wrap);

    const p = pages[pageIndex] || {subtitle:'無題', words:[]};
    $('#pageMeta').textContent = `@${p.subtitle} / 語数 ${p.words.length} / ${W}×${H} / © ${copyrightText}`;
    document.body.dataset.answers = chkAnswers?.checked ? 'on' : 'off';
  }

  function renderWordsPanel(){
    const p = pages[pageIndex] || {subtitle:'無題', words:[]};
    const ov = p.overrides || (p.overrides = {});
    wordList.innerHTML='';

    const head=document.createElement('div');
    head.className='word-item';
    head.innerHTML=`<strong>@${p.subtitle}</strong>`;
    wordList.appendChild(head);

    for(const kana of p.words){
      const m   = dict.get(kana);
      const o   = ov[kana] || {};
      const roma= (o.romaji ?? m?.romaji ?? kanaToRomajiWithMacron(kana));
      const en  = (o.en     ?? m?.en     ?? '');
      const yomi= m?.yomi || '';

      const playable = window.AudioIO?.has(kana, yomi);
      const btn = playable ? `<button class="audio-btn" data-k="${kana}" data-y="${yomi}">▶</button>`
                           : `<button class="audio-btn" disabled>▶</button>`;

      const row=document.createElement('div');
      row.className='word-item';
      row.innerHTML = `
        <div>${btn}</div>
        <div class="kana" title="かな（配置と音声に直結するので編集不可）">${kana}</div>
        <div class="meta">
          <i class="roma editable" contenteditable="true" data-k="${kana}" data-field="romaji">${roma}</i>
          <span class="en editable" contenteditable="true" data-k="${kana}" data-field="en">${en}</span>
          <button class="ov-reset" data-k="${kana}" title="辞書に戻す（上書き解除）">↺</button>
        </div>`;
      wordList.appendChild(row);
    }

    if(!wordList.dataset.bound){
      wordList.addEventListener('click', async (e)=>{
        const b = e.target.closest('.audio-btn');
        if(b && !b.disabled){
          try{ await AudioIO.play(b.dataset.k, b.dataset.y); }catch(_){}
        }
        const r = e.target.closest('.ov-reset');
        if(r){
          const k=r.dataset.k;
          delete (p.overrides||{})[k];
          renderWordsPanel();
        }
      });

      wordList.addEventListener('input', (e)=>{
        const el = e.target;
        if(!el.matches('.editable[contenteditable][data-k]')) return;
        const k = el.dataset.k;
        const f = el.dataset.field;
        const t = (el.textContent || '').replace(/\s+/g,' ').trim();
        (p.overrides[k] ||= {})[f] = t;
      });

      wordList.addEventListener('blur', (e)=>{
        const el = e.target;
        if(!el.matches('.editable[contenteditable][data-k]')) return;
        const t = (el.textContent || '').replace(/\s+/g,' ').trim();
        el.textContent = t;
      }, true);

      wordList.dataset.bound = '1';
    }
  }

  function updateFooter(){
    pageLabel.textContent = `${pageIndex+1}/${pages.length}`;
    subtitleMeta.textContent = `@${(pages[pageIndex]?.subtitle)||'無題'}`;
    btnPrev.disabled = (pageIndex===0);
    btnNext.disabled = (pageIndex===pages.length-1);
  }

  // ===== 別解チェック
  const DIRS8 = {
    N:{dx:0,dy:-1}, NE:{dx:1,dy:-1}, E:{dx:1,dy:0}, SE:{dx:1,dy:1},
    S:{dx:0,dy:1},  SW:{dx:-1,dy:1}, W:{dx:-1,dy:0}, NW:{dx:-1,dy:-1}
  };

  function onCheckAlternatives(){
    const p = pages[pageIndex] || {subtitle:'無題', words:[]};
    const words = [...new Set(p.words)];
    const hits = findAllWords(grid, words, placements);
    altOverlays = hits.map(h=>({ cells: cellsFor(h.word, {x:h.x,y:h.y}, h.dir, {w:W,h:H}) || [] }));
    renderGrid(grid, placements);

    if(!hits.length){ toast('別解は見つかりませんでした'); return; }
    const msg = '別解候補: ' + hits.slice(0,10).map(h=>`${h.word} @(${h.x},${h.y}) ${h.dir}`).join(' / ')
      + (hits.length>10? ` ... 他${hits.length-10}`:'');
    toast(msg);
  }

  function findAllWords(grid, words, placements){
    const rows = grid.length, cols = grid[0]?.length||0;
    const res=[];
    const placedSet = new Set(placements.map(pl=> pl.cells.map(c=>`${c.x},${c.y}`).join('|')));

    for(const w of words){
      const chars = [...normalizeNFC(w)];
      for(let y=0;y<rows;y++){
        for(let x=0;x<cols;x++){
          for(const [name,vec] of Object.entries(DIRS8)){
            let ok=true;
            for(let i=0;i<chars.length;i++){
              const xx=x+vec.dx*i, yy=y+vec.dy*i;
              if(xx<0||yy<0||xx>=cols||yy>=rows){ ok=false; break; }
              if(grid[yy][xx] !== chars[i]){ ok=false; break; }
            }
            if(ok){
              const key = [...Array(chars.length)].map((_,i)=>`${x+vec.dx*i},${y+vec.dy*i}`).join('|');
              if(!placedSet.has(key)) res.push({word:w, x, y, dir:name});
            }
          }
        }
      }
    }
    return res;
  }

  // ===== I/O（ファイル読み込み）
  function pickFile(accept){
    return new Promise((resolve) => {
      const inp=document.createElement('input'); inp.type='file'; inp.accept=accept||'';
      inp.onchange=async()=>{ const f=inp.files?.[0]; if(!f){resolve(null);return;}
        try{
          const text = (typeof f.text==='function') ? await f.text() : await readLegacy(f);
          resolve(text);
        }catch{ resolve(null); }
      };
      inp.click();
    });
  }
  function readLegacy(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onerror=()=>rej(fr.error); fr.onload=()=>res(String(fr.result||'')); fr.readAsText(file,'utf-8'); }); }

  function splitLines(s){ return s.split(/\r\n|\r|\n|\u2028|\u2029/g); }

  function parseWordlist(text){
    const lines = splitLines(normalizeNFC(text));
    const out=[]; let cur={subtitle:'無題', words:[]}; let saw=false; let set=new Set();
    for(const raw of lines){
      const s0=raw.trim(); if(!s0 || s0==='…') continue;
      if(/^[@＠]/.test(s0)){
        if(saw && cur.words.length) out.push(cur);
        cur={subtitle:s0.replace(/^[@＠]/,'').trim()||'無題', words:[]};
        set=new Set(); saw=true; continue;
      }
      const w=s0.replace(/[ \u3000,，]/g,''); if(!w) continue;
      if(!set.has(w)){ cur.words.push(w); set.add(w); }
    }
    if(!saw){
      const t={subtitle:'無題', words:[]}; const seen=new Set();
      for(const raw2 of lines){
        const s1=raw2.trim(); if(!s1 || s1==='…' || /^[@＠]/.test(s1)) continue;
        const w=s1.replace(/[ \u3000,，]/g,''); if(w && !seen.has(w)){ t.words.push(w); seen.add(w); }
      }
      if(t.words.length) out.push(t);
    }else{
      if(cur.words.length) out.push(cur);
    }
    return out.length? out : [{subtitle:'無題', words:[]}];
  }

  function parseDictionary(csvText){
    const rows=[]; const lines=splitLines(normalizeNFC(csvText));
    for(const line of lines){
      if(!line.trim()) continue;
      const cols = csvSplit(line);
      const kana=(cols[0]||'').trim(); if(!kana) continue;
      const en  =(cols[1]||'').trim();
      const roma=(cols[2]||'').trim();
      const yomi=(cols[3]||'').trim();
      rows.push({ kana, en, romaji: roma, yomi: yomi || undefined });
    }
    return rows;
  }
  function csvSplit(line){
    const out=[]; let cur=''; let q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='\"'){ q=!q; continue; }
      if(ch===',' && !q){ out.push(cur); cur=''; continue; }
      cur+=ch;
    }
    out.push(cur); return out;
  }

  // ===== kana→romaji（辞書無フォールバック）
  function kanaToRomajiWithMacron(kana){
    const base = kanaToRomaji(kana);
    return base.replace(/aa/g,'ā').replace(/ii/g,'ī').replace(/uu/g,'ū').replace(/ee/g,'ē').replace(/ou|oo/g,'ō');
  }
  function kanaToRomaji(s){
    const hira='ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんー';
    const kata='ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンー';
    const map = {'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o','カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko','サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so','タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to','ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no','ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho','マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo','ヤ':'ya','ユ':'yu','ヨ':'yo','ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro','ワ':'wa','ヲ':'o','ン':'n','ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go','ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo','ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do','バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo','パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po','ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o','ャ':'ya','ュ':'yu','ョ':'yo','ヮ':'wa','ッ':'','ー':'','ヰ':'i','ヱ':'e'};
    let t=''; for(const ch of s){ const i=hira.indexOf(ch); t += (i>=0? kata[i]: ch); }
    t=t.replace(/ッ([カ-ヂツ-ポサ-ゾタ-ドバ-ボパ-ポマ-モヤユヨラ-ロワ])/g,(m,p)=>{ const r=(map[p]||''); return (r&&r[0])+p; });
    t=t.replace(/(キ|ギ|シ|ジ|チ|ニ|ヒ|ビ|ピ|ミ|リ)(ャ|ュ|ョ)/g,(_,a,b)=>{ const base={キ:'k',ギ:'g',シ:'sh',ジ:'j',チ:'ch',ニ:'n',ヒ:'h',ビ:'b',ピ:'p',ミ:'m',リ:'r'}[a]||''; const tail={ャ:'ya',ュ:'yu','ョ':'yo'}[b]||''; return base+tail; });
    let out=''; for(const ch of t){ out += (map[ch] ?? ch); }
    return out;
  }

  // ===== 出力ブリッジ（未使用でも可）
  function openDigital(payload){
    const id = 'dg-' + Math.random().toString(36).slice(2);
    try{
      localStorage.setItem('ws-digital:' + id, JSON.stringify(payload));
    }catch(_){ toast('出力用の一時保存に失敗しました'); return; }
    const win = window.open('./digital/index.html#' + id, '_blank');
    if(!win) toast('ポップアップがブロックされました');
  }

  function openPDF(payload){
    const id = 'pf-' + Math.random().toString(36).slice(2);
    try{
      localStorage.setItem('ws-pdf:' + id, JSON.stringify(payload));
    }catch(_){ toast('出力用の一時保存に失敗しました'); return; }
    const win = window.open('./pdf/index.html#' + id, '_blank');
    if(!win) toast('ポップアップがブロックされました');
  }

  // ===== toast
  let toastTimer=null;
  function toast(msg){
    let el = document.getElementById('toast');
    if(!el){ el=document.createElement('div'); el.id='toast'; el.className='toast'; document.body.appendChild(el); }
    el.textContent=msg; el.style.position='fixed'; el.style.left='50%'; el.style.transform='translateX(-50%)';
    el.style.bottom='16px'; el.style.background='#111'; el.style.color='#fff'; el.style.padding='10px 14px';
    el.style.borderRadius='10px'; el.style.zIndex='9999';
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ el.remove(); }, 1800);
  }

  // ===== 初期描画
  renderWordsPanel();
  updateFooter();
  renderGrid(grid, placements);

  // ==== ▼ 単体プレイヤー（digital の見た目をそのまま埋め込む・外部ファイル参照OK）====
  function buildStandaloneHTML(payload) {
    const CSS = `
:root{
  --bg:#f7f8fb; --fg:#111; --muted:#666; --border:#e6e6e6;
  --stage-max:834px; --cell:36px; --ink-alpha:0.35; --ink-width:6px; --eraser-width:16px;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);
  font-family:system-ui,-apple-system,"Noto Sans JP",Roboto,sans-serif;line-height:1.5}
img{display:block}
.topbar{max-width:var(--stage-max);margin:0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;padding:12px;background:#fff;border-bottom:1px solid var(--border)}
.tb-left{text-align:left;font-weight:600}
.tb-center{text-align:center;font-weight:700}
.tb-right{text-align:right;color:var(--muted)}
/* === 等間隔ツールバー（4アイコン＋右端ズーム） === */
.toolbar{
  max-width:var(--stage-max);
  margin:0 auto;
  display:grid;
  grid-template-columns: repeat(4, 1fr) auto; /* 4アイコンを等間隔、最後にズーム */
  align-items:center;
  gap:min(4vw, 36px);
  padding:8px 12px;
  background:#fff;
  border-bottom:1px solid var(--border);
}
.tool{border:0;background:transparent;padding:6px;border-radius:10px;cursor:pointer;justify-self:center}
.tool:hover{background:#f0f3f7}
.tool img{width:28px;height:28px}
.tool .lbl{display:none}          /* 画像があるときはラベル隠す */
.zoomctl{justify-self:end;display:flex;align-items:center;gap:8px;color:#444}
.zoomctl input{accent-color:#333}
.sheet{max-width:var(--stage-max);margin:16px auto;padding:0 12px 24px}
#subtitle{font-size:1.1em}
@media (min-width:768px){#subtitle{font-size:1.4em}}
.gridwrap{position:relative;display:flex;justify-content:center;margin:12px auto;width:max-content}
.grid{display:grid;grid-template-columns:repeat(var(--cols,0), var(--cell));gap:0;padding:6px;border:1.5pt solid #000;border-radius:12px;background:transparent;user-select:none}
.cell{width:var(--cell);height:var(--cell);display:grid;place-items:center;background:transparent;font-weight:600;font-size:calc(var(--cell)*0.6);line-height:1}
.overlay{position:absolute;left:0;top:0;pointer-events:none;z-index:2}
.hide-answers .overlay{display:none}
.ink{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;z-index:3}
.wordlist{margin-top:20px}
.wl-grid{display:grid;gap:12px;max-width:min(980px,96vw);margin:16px auto}
.wl-cols-2{grid-template-columns:repeat(2, minmax(260px,1fr))}
.wl-cols-3{grid-template-columns:repeat(3, minmax(220px,1fr))}
.wl-cols-4{grid-template-columns:repeat(4, minmax(200px,1fr))}
.wl-item{background:#fff;border:1px solid #eee;border-radius:12px;box-shadow:0 6px 22px rgba(0,0,0,.05);overflow:hidden}
.wl-head{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px}
.wl-head .jp{font-size:18px;font-weight:700}
.wl-head .en{color:#666;font-size:13px}
.wl-roma{padding:6px 12px 12px;font-style:italic;color:#444}
.play{width:28px;height:28px;border-radius:50%;border:1px solid #ddd;background:#fff;cursor:pointer}
.play:hover{box-shadow:0 2px 10px rgba(0,0,0,.08);transform:translateY(-1px)}
.bottombar{max-width:var(--stage-max);margin:0 auto 24px;padding:12px;color:#666;text-align:center}
.answer{fill:none;stroke:#888;stroke-width:1.2px;stroke-linecap:round}
@media (min-width:768px){
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start; /* ← 上寄せに */
    padding: 16px 0;             /* ← 下余白も控えめに */
  }
  .gridwrap {
    margin-bottom: 24px;         /* ← 固定の余白に */
  }
}

@media (max-width:480px){
  .toolbar{gap:16px}
  .tool img{width:24px;height:24px}
}
@media print{
  body{background:#fff}
  .toolbar{display:none !important}
  .play{display:none !important}
  .overlay{display:none !important}
  .sheet{margin:8mm auto 6mm;padding:0}
  header.topbar{margin-bottom:4em !important}
  .gridwrap{margin-bottom:3em !important}
  :root{--cell:48px !important}
  header.topbar #subtitle{font-size:25px !important;font-weight:700 !important}
  .wl-grid{gap:6px}
  .wl-item{box-shadow:none;border:1px solid #ddd;border-radius:8px}
  .wl-head{padding:4px 6px;gap:6px}
  .wl-head .jp{font-size:14px;font-weight:700}
  .wl-head .en{font-size:11px;color:#555}
  .wl-roma{padding:2px 6px 6px;font-size:11px}
  .answer{stroke-width:2px}
}
`;

    const JS = `
(function(){
  const payload = window.__PAYLOAD__ || {};
  const $ = s => document.querySelector(s);
  const state = { cellPx: 36, mode:'none' };

  // 画像アイコンが壊れたらラベル表示へ切替
  for (const id of ['btn-answer','btn-pen','btn-eraser','btn-print']){
    const b = document.getElementById(id);
    const img = b?.querySelector('img');
    const lbl = b?.querySelector('.lbl');
    if (img && lbl) img.onerror = ()=>{ img.style.display='none'; lbl.style.display='inline'; };
  }

  // 初期
  const z = $('#zoom');
  if (z){ const pct=Number(z.value||100); state.cellPx=Math.max(16, Math.round(36*pct/100));
    document.documentElement.style.setProperty('--cell', state.cellPx+'px'); }

  bindUI(); renderAll();

  function bindUI(){
    $('#btn-answer')?.addEventListener('click', ()=> document.body.classList.toggle('hide-answers'));
    $('#btn-pen')?.addEventListener('click', ()=> setMode('pen'));
    $('#btn-eraser')?.addEventListener('click', ()=> setMode('eraser'));
    $('#btn-print')?.addEventListener('click', ()=> window.print());
    $('#zoom')?.addEventListener('input', e=>{
      const pct = Number(e.target.value||100);
      state.cellPx = Math.max(16, Math.round(36*pct/100));
      document.documentElement.style.setProperty('--cell', state.cellPx+'px');
      layoutGrid(); syncOverlay(); drawAnswers(); resizeInk();
    });
    setupInk();
    window.addEventListener('resize', ()=>{ layoutGrid(); syncOverlay(); drawAnswers(); resizeInk(); });
    window.addEventListener('beforeprint', ()=> setTimeout(()=>{ layoutGrid(); syncOverlay(); drawAnswers(); }, 0));
    window.addEventListener('afterprint',  ()=> setTimeout(()=>{ layoutGrid(); syncOverlay(); drawAnswers(); }, 0));

    // ワードリスト：音声再生
    const tbl = document.getElementById('wordTable');
    if (tbl){
      let current = null;
      tbl.addEventListener('click', (e)=>{
        const b = e.target.closest('button.play'); if(!b) return;
        // かな → ローマ字の順で候補を試す
        const kana = b.dataset.read || b.previousElementSibling?.textContent || '';
        const roma = b.dataset.roma || fallbackRoma(kana);
        const candidates = [
          'audio/' + encodeURIComponent(kana) + '.mp3',
          'audio/' + encodeURIComponent(roma) + '.mp3'
        ];
        if (current) { try{ current.pause(); }catch(_){}
          current = null;
        }
        const tryPlay = (i=0)=>{
          if (i>=candidates.length) return;
          const a = new Audio(candidates[i]);
          a.addEventListener('ended', ()=>{ current=null; });
          a.play().then(()=>{ current=a; }).catch(()=> tryPlay(i+1));
        };
        tryPlay();
      });
    }
  }

  function renderAll(){
    setText('#subtitle', payload.subtitle || '—');
    setText('#difficulty', payload.difficulty || '—');
    setText('#copyright', '© ' + (payload.copyright || '—'));

    buildGrid(); layoutGrid(); syncOverlay(); drawAnswers();
    buildWordList(); resizeInk();
  }

  // Grid
  function buildGrid(){
    const G = Array.isArray(payload.grid) && Array.isArray(payload.grid[0]) ? payload.grid : [[]];
    const rows = G.length, cols = G[0]?.length || 0;
    const grid = $('#grid'); if(!grid) return;
    grid.innerHTML=''; grid.style.setProperty('--cols', cols);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
      const d=document.createElement('div'); d.className='cell';
      d.textContent=(G[y] && typeof G[y][x]==='string')? G[y][x] : '';
      grid.appendChild(d);
    }
  }
  function layoutGrid(){
    const grid = $('#grid'); const wrap = grid?.parentElement;
    if(!grid||!wrap) return; const r=grid.getBoundingClientRect();
    wrap.style.width = Math.round(r.width+12)+'px';
    wrap.style.margin='0 auto';
  }

  // Answers
  function drawAnswers(){
    const G = Array.isArray(payload.grid) && Array.isArray(payload.grid[0]) ? payload.grid : [[]];
    const cell = state.cellPx || 36;
    const grid = $('#grid'), svg = $('#overlay'); if(!grid||!svg) return;
    const gs = getComputedStyle(grid);
    const padL = parseFloat(gs.paddingLeft)||0, padT = parseFloat(gs.paddingTop)||0;
    const gapX = parseFloat(gs.columnGap)||parseFloat(gs.gap)||0;
    const gapY = parseFloat(gs.rowGap)||parseFloat(gs.gap)||0;
    svg.innerHTML='';
    const stepX = cell + gapX, stepY = cell + gapY;

    const pls = Array.isArray(payload.placements)? payload.placements : [];
    for(const pl of pls){
      const cells = Array.isArray(pl?.cells)? pl.cells : []; const n=cells.length; if(n<1) continue;
      const a=cells[0], b=cells[n-1];
      const dx=Math.sign(b.x-a.x), dy=Math.sign(b.y-a.y);
      const cx0 = padL + a.x*stepX + cell/2, cy0 = padT + a.y*stepY + cell/2;
      const cx1 = padL + b.x*stepX + cell/2, cy1 = padT + b.y*stepY + cell/2;
      const thick = cell*0.72;
      const step  = Math.hypot(dx?stepX:0, dy?stepY:0) || stepX;
      const len   = step*(n-1) + thick;
      const cx=(cx0+cx1)/2, cy=(cy0+cy1)/2, deg=Math.atan2(dy,dx)*180/Math.PI;
      const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', String(Math.round(cx-len/2)));
      rect.setAttribute('y', String(Math.round(cy-thick/2)));
      rect.setAttribute('width',  String(Math.round(len)));
      rect.setAttribute('height', String(Math.round(thick)));
      rect.setAttribute('rx', String(Math.round(thick/2)));
      rect.setAttribute('ry', String(Math.round(thick/2)));
      rect.setAttribute('class','answer');
      rect.setAttribute('transform', \`rotate(\${deg} \${cx} \${cy})\`);
      svg.appendChild(rect);
    }
  }
  function syncOverlay(){
    const grid = document.getElementById('grid');
    const svg  = document.getElementById('overlay');
    if(!grid||!svg) return;
    svg.setAttribute('width',  Math.round(grid.clientWidth));
    svg.setAttribute('height', Math.round(grid.clientHeight));
    const left = grid.offsetLeft + grid.clientLeft;
    const top  = grid.offsetTop  + grid.clientTop;
    svg.style.left = left + 'px'; svg.style.top = top + 'px';
  }

  // Words
  function buildWordList(){
    const words = Array.isArray(payload.words)? payload.words : [];
    const tbl = $('#wordTable'); if(!tbl) return;
    tbl.innerHTML='';
    const cols = (words.length<=8)?2 : (words.length<=16?3:4);
    tbl.className = 'wl-grid wl-cols-' + cols;

    for(const w of words){
      const kana=(typeof w==='string')? w : (w.kana||w.display||w.word||'');
      const en  =(typeof w==='string')? '' : (w.en||'');
      const roma=(typeof w==='string')? fallbackRoma(kana) : (w.romaji||w.yomi||fallbackRoma(kana));
      if(!kana) continue;
      const item=document.createElement('div'); item.className='wl-item';
      const head=document.createElement('div'); head.className='wl-head';
      const play=document.createElement('button'); play.className='play'; play.textContent='▶'; play.title='再生'; play.dataset.read=kana; play.dataset.roma=roma;
      const jp=document.createElement('div'); jp.className='jp'; jp.textContent=kana;
      const enDiv=document.createElement('div'); enDiv.className='en'; enDiv.textContent=en;
      head.appendChild(play); head.appendChild(jp); head.appendChild(enDiv);
      const romaDiv=document.createElement('div'); romaDiv.className='wl-roma'; romaDiv.textContent=roma;
      item.appendChild(head); item.appendChild(romaDiv); tbl.appendChild(item);
    }
  }

  // Ink
  function setupInk(){
    const cvs=$('#ink'), grid=$('#grid'); if(!cvs||!grid) return;
    let drawing=false,last=null;
    function drawTo(x,y,erase=false){
      const ctx=cvs.getContext('2d'); ctx.lineCap='round'; ctx.lineJoin='round';
      if(erase){ ctx.globalCompositeOperation='destination-out'; ctx.lineWidth=parseFloat(getVar('--eraser-width'))||14; ctx.strokeStyle='rgba(0,0,0,1)'; }
      else{ ctx.globalCompositeOperation='source-over'; const a=parseFloat(getVar('--ink-alpha'))||0.35; ctx.strokeStyle=\`rgba(255,0,0,\${a})\`; ctx.lineWidth=parseFloat(getVar('--ink-width'))||6; }
      if(!last){ last={x,y}; return; } ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(x,y); ctx.stroke(); last={x,y};
    }
    function getVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
    function pos(ev){ const r=cvs.getBoundingClientRect(); const t=ev.touches?ev.touches[0]:ev; return {x:t.clientX-r.left,y:t.clientY-r.top}; }
    function down(ev){ if(state.mode==='none') return; drawing=true; last=null; move(ev); ev.preventDefault(); }
    function up(){ drawing=false; last=null; }
    function move(ev){ if(!drawing) return; const {x,y}=pos(ev); drawTo(x,y, state.mode==='eraser'); ev.preventDefault(); }
    cvs.addEventListener('mousedown', down); cvs.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    cvs.addEventListener('touchstart', down, {passive:false}); cvs.addEventListener('touchmove', move, {passive:false}); window.addEventListener('touchend', up);
    resizeInk();
  }
  function setMode(m){
    state.mode = (m===state.mode)?'none':m;
    for(const id of ['btn-pen','btn-eraser']){
      const el=document.getElementById(id); if(!el) continue;
      el.classList.toggle('active', ('btn-'+state.mode)===id);
      el.setAttribute('aria-pressed', String(('btn-'+state.mode)===id));
    }
  }
  function resizeInk(){
    const cvs=$('#ink'), grid=$('#grid'); if(!cvs||!grid) return;
    const r=grid.getBoundingClientRect(); cvs.width=Math.round(r.width); cvs.height=Math.round(r.height);
  }

  function setText(sel, text){ const el=document.querySelector(sel); if(el) el.textContent=String(text ?? ''); }
  function fallbackRoma(kana){
    if (typeof kana !== 'string') return '';
    const hira='ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんー';
    const kata='ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンー';
    const map={'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o','カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko','サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so','タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to','ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no','ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho','マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo','ヤ':'ya','ユ':'yu','ヨ':'yo','ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro','ワ':'wa','ヲ':'o','ン':'n','ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go','ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo','ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do','バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo','パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po','ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o','ャ':'ya','ュ':'yu','ョ':'yo','ヮ':'wa','ッ':'','ー':''};
    let t=''; for(const ch of kana){ const i=hira.indexOf(ch); t += (i>=0? kata[i]: ch); }
    t=t.replace(/ッ([カ-ヂツ-ポサ-ゾタ-ドバ-ボパ-ポマ-モヤユヨラ-ロワ])/g,(m,p)=>{ const r=(map[p]||''); return (r&&r[0])+p; });
    let out=''; for(const ch of t){ out += (map[ch] ?? ch); }
    out = out.replace(/aa/g,'ā').replace(/ii/g,'ī').replace(/uu/g,'ū').replace(/ee/g,'ē').replace(/ou|oo/g,'ō');
    return out;
  }
})();`;

    const title = escapeHtml(payload.subtitle || 'Word Search');
    return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
<body class="hide-answers">
  <header class="topbar">
    <div class="tb-left">Japanese Word search</div>
    <div class="tb-center" id="subtitle">—</div>
    <div class="tb-right"><span id="difficulty">—</span></div>
  </header>

  <nav class="toolbar">
    <button id="btn-answer" class="tool" title="こたえ">
      <img src="icons/icon_answer.png" alt="こたえ"><span class="lbl">こたえ</span>
    </button>
    <button id="btn-pen" class="tool" title="えんぴつ">
      <img src="icons/icon_pencil.png" alt="えんぴつ"><span class="lbl">えんぴつ</span>
    </button>
    <button id="btn-eraser" class="tool" title="けしごむ">
      <img src="icons/icon_eraser.png" alt="けしごむ"><span class="lbl">けしごむ</span>
    </button>
    <button id="btn-print" class="tool" title="プリント">
      <img src="icons/icon_printer.png" alt="プリント"><span class="lbl">プリント</span>
    </button>
    <label class="zoomctl">ズーム
      <input id="zoom" type="range" min="60" max="160" value="100" />
    </label>
  </nav>

  <main class="stage">
    <section class="sheet">
      <div class="gridwrap">
        <div id="grid" class="grid"></div>
        <svg id="overlay" class="overlay" xmlns="http://www.w3.org/2000/svg"></svg>
        <canvas id="ink" class="ink"></canvas>
      </div>
      <section class="wordlist"><div id="wordTable" class="wl-grid"></div></section>
    </section>
  </main>

  <footer class="bottombar"><div id="copyright">© —</div></footer>

  <script>window.__PAYLOAD__=${JSON.stringify(payload)};</script>
  <script>${JS}</script>
</body>
</html>`;
  }
  // 文字エスケープ
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // ==== ▼ 保存一覧（LocalStorage）からの復元機能 ===================
  let btnLoadSave = document.getElementById('btnLoadSave');
  if (!btnLoadSave) {
    btnLoadSave = document.createElement('button');
    btnLoadSave.id = 'btnLoadSave';
    btnLoadSave.textContent = '保存一覧';
    Object.assign(btnLoadSave.style, { position:'fixed', right:'16px', bottom:'16px', zIndex: 10000 });
    document.body.appendChild(btnLoadSave);
  }

  function restoreFromState(state){
    try{
      pages        = Array.isArray(state.pages) ? state.pages : pages;
      dict         = new Map((state.dict||[]).map(r => [r.kana, r]));
      grid         = Array.isArray(state.grid) ? state.grid : grid;
      placements   = Array.isArray(state.placements) ? state.placements : [];
      altOverlays  = Array.isArray(state.altOverlays) ? state.altOverlays : [];

      const ui = state.ui || {};
      pageIndex     = Number.isInteger(ui.pageIndex) ? ui.pageIndex : 0;
      W             = clamp(+ui.W || W, 4, 20);
      H             = clamp(+ui.H || H, 4, 20);
      difficulty    = ui.difficulty || difficulty;
      copyrightText = ui.copyrightText || copyrightText;

      if (inpW) inpW.value = String(W);
      if (inpH) inpH.value = String(H);
      if (selDiff) selDiff.value = difficulty;
      if (inpCopyright) inpCopyright.value = copyrightText;
      if (chkAnswers) chkAnswers.checked = !!ui.answersOn;

      renderWordsPanel();
      updateFooter();
      renderGrid(grid, placements);

      toast('保存データを復元しました');
    }catch(e){
      console.error(e);
      alert('復元に失敗しました（データ形式が壊れている可能性があります）');
    }
  }

  function showSavesOverlay(){
    const key = 'ws-saves';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    if (!arr.length) { alert('保存データはありません'); return; }

    document.getElementById('saveOverlay')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'saveOverlay';
    Object.assign(wrap.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,0.4)', zIndex:10001,
      display:'flex', alignItems:'center', justifyContent:'center'
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background:'#fff', color:'#111', borderRadius:'12px', padding:'16px',
      width:'min(520px, 90vw)', maxHeight:'80vh', overflow:'auto', boxShadow:'0 10px 30px rgba(0,0,0,0.2)'
    });
    panel.innerHTML = `<h3 style="margin:0 0 12px 0;">保存一覧</h3>`;

    const list = arr.slice().sort((a,b)=> (b.id||0)-(a.id||0));

    for (const rec of list){
      const li = document.createElement('div');
      li.style.display='flex'; li.style.gap='8px'; li.style.alignItems='center';
      li.style.borderTop='1px solid #eee'; li.style.padding='8px 0';

      const title = (rec.title || '無題');
      const dt = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : '';
      const diff = rec.difficulty || '';

      const btn = document.createElement('button');
      btn.textContent = '復元';
      btn.style.marginLeft = 'auto';
      btn.addEventListener('click', ()=>{
        if (!rec.state) { alert('このレコードにstateがありません'); return; }
        restoreFromState(rec.state);
        wrap.remove();
      });

      const del = document.createElement('button');
      del.textContent = '削除';
      del.addEventListener('click', ()=>{
        const ok = confirm('この保存データを削除しますか？');
        if (!ok) return;
        const idx = arr.findIndex(r => r.id === rec.id);
        if (idx >= 0) {
          arr.splice(idx,1);
          localStorage.setItem(key, JSON.stringify(arr));
          li.remove();
        }
      });

      const meta = document.createElement('div');
      meta.innerHTML = `<div><strong>${title}</strong></div>
                        <div style="font-size:12px;color:#666;">${dt} / ${diff}</div>`;

      li.appendChild(meta);
      li.appendChild(del);
      li.appendChild(btn);
      panel.appendChild(li);
    }

    const close = document.createElement('button');
    close.textContent = '閉じる';
    close.style.marginTop='12px';
    close.addEventListener('click', ()=> wrap.remove());
    panel.appendChild(close);

    wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }

  btnLoadSave.addEventListener('click', showSavesOverlay);
  // ==== ▲ 復元機能 ここまで ======================================

  // =========================
  // 「確定＝保存」：完成判定なし／LocalStorage保存
  // =========================
  const btnConfirm = document.getElementById('btnConfirm');
  if (btnConfirm) {
    const clone = btnConfirm.cloneNode(true);
    clone.type = 'button';
    btnConfirm.replaceWith(clone);

    clone.addEventListener('click', (ev)=>{
      ev.preventDefault();

      const state = buildStateForSave(); // ★完成チェック無し
      const rec = {
        id: 'p' + Date.now(),
        createdAt: new Date().toISOString(),
        title: (pages[pageIndex]?.subtitle) || '無題',
        difficulty,
        exported: false,
        state
      };

      try{
        const key='ws-saves';
        const arr = JSON.parse(localStorage.getItem(key)||'[]');
        arr.push(rec);
        localStorage.setItem(key, JSON.stringify(arr));
        const badge = document.getElementById('unexportedBadge');
        if (badge) badge.textContent = `未出力 ${arr.filter(r=>!r.exported).length} 件`;
        toast('確定（保存）しました');
      }catch(e){
        console.error(e);
        alert('保存に失敗しました（ストレージ容量をご確認ください）');
      }
    });
  }
}); // DOMContentLoaded end
