// js/exporter.js — Review & Export-All (DB→プレビュー→そのまま保存)
// 依存: jsio.db.js（KotoDB互換）, ブラウザの File System Access API
// (function () { ... })(); は削除し、ファイル全体をモジュールとして動作させる

// ====== 小物 ======
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) =>
    String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const ensureKana = (ch) => {
    const kana = ch.replace(/゛/g, 'が').replace(/゜/g, 'ぱ');
    return kana;
}

// ====== Global namespace (non-module usage)
window.Exporter = {
    renderPuzzleHTML: renderPuzzleHTML,
    openPreview: openPreview,
    renderPreviewInIframe: renderPreviewInIframe,
    openReview: openReview,
    attach: attach,
    pickRoot: pickRoot,
    ensureDir: ensureDir,
    writeText: writeText,
    readJSON: readJSON
};

// ====== DB（KotoDB優先・なければ同等動作） ======
const DB = {
    name: 'kotogramico.wordsearch.v1',
    store: 'confirmedPuzzles',
    async open() {
        return await new Promise((res, rej) => {
            const r = indexedDB.open(this.name, 1);
            r.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.store))
                    db.createObjectStore(this.store, { keyPath: 'id' });
            };
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
    },
    async getUnexportedAll() {
        if (window.KotoDB?.dbGetUnexportedAll) return await KotoDB.dbGetUnexportedAll();
        const db = await this.open();
        return await new Promise((res, rej) => {
            const tx = db.transaction(this.store, 'readonly');
            const st = tx.objectStore(this.store);
            const req = st.getAll();
            req.onsuccess = () => {
                const rows = (req.result || []).filter((r) => !r.exported);
                rows.sort((a, b) => (a.createdAt || '') > (b.createdAt || '') ? -1 : 1);
                res(rows);
            };
            req.onerror = () => rej(req.error);
        });
    },
    async put(rec) {
        if (window.KotoDB?.dbAddConfirmed) return await KotoDB.dbAddConfirmed(rec);
        const db = await this.open();
        return await new Promise((res, rej) => {
            const tx = db.transaction(this.store, 'readwrite');
            tx.objectStore(this.store).put(rec);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    },
    async markExported(id, file) {
        if (window.KotoDB?.dbMarkExported) return await KotoDB.dbMarkExported(id, file);
        const db = await this.open();
        return await new Promise((res, rej) => {
            const tx = db.transaction(this.store, 'readwrite');
            const st = tx.objectStore(this.store);
            const g = st.get(id);
            g.onsuccess = () => {
                const row = g.result; if (!row) { res(false); return; }
                row.exported = true;
                row.exportedFile = file;
                row.exportedAt = new Date().toISOString();
                st.put(row);
            };
            g.onerror = () => rej(g.error);
            tx.oncomplete = () => res(true);
            tx.onerror = () => rej(tx.error);
        });
    },
    async unexportedCount() {
        if (window.KotoDB?.dbGetUnexportedCount) return await KotoDB.dbGetUnexportedCount();
        const all = await this.getUnexportedAll();
        return all.length;
    },
};

// ====== 出力テンプレ（プレビュー＝保存物） ======
function renderPuzzleHTML(payload, noStr, options = {}) {
    const { grid = [], words = [], size = {}, subtitle, difficulty, copyright } = payload;
    const rows = (grid || []).map(r => `<tr>${r.map(ch => `<td>${esc(ensureKana(ch))}</td>`).join('')}</tr>`).join('');
    const lis = (words || []).map(w => {
        const k = esc(w.kana || ''), r = esc(w.romaji || ''), e = esc(w.en || '');
        return `<li><button class="play" data-kana="${k}">▶</button><b>${k}</b><i>${r}</i><span>${e}</span></li>`;
    }).join('');
    const title = esc(subtitle || 'Japanese Wordsearch');
    const meta = `${esc(subtitle || '無題')} / ${size.w || '?'}×${size.h || '?'} / ${esc(difficulty || 'normal')}`;
    const answer = payload.answerSVG ? payload.answerSVG : `<svg id="answer" class="answer" width="1" height="1"></svg>`;
    const opt = {
        screenFit: options.screenFit ?? 'auto',
        pageSize: options.pageSize ?? 'A4',
        marginsMm: options.marginsMm ?? 10,
        screenPreset: options.screenPreset ?? 'tablet-portrait'
    };
    function pageSizeCss(ps){ if(typeof ps==='string') return ps; if(ps&&typeof ps==='object'&&Number(ps.wMm)&&Number(ps.hMm)) return `${ps.wMm}mm ${ps.hMm}mm`; return 'A4'; }
    const pageSizeDecl = pageSizeCss(opt.pageSize);
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – #${noStr}</title>
<style>
:root{--ink:rgba(255,0,0,.55)}
body{font-family:system-ui,"Noto Sans JP",sans-serif;margin:0;color:#111}
header{display:flex;gap:12px;align-items:baseline;margin-bottom:16px}h1{font-size:20px;margin:0}.meta{color:#666;font-size:12px}
#fitpage-wrapper{transform-origin: top left; display:inline-block}
#fitpage{background:#fff}

.wrap{display:grid;grid-template-columns:1fr 260px;row-gap:40px;column-gap:20px;align-items:start}
table{border-collapse:collapse;border:1.5px solid #999;background:#fff}
td{width:24px;height:24px;text-align:center;border:.5px solid #ddd;font-size:16px;user-select:none}
ul{list-style:none;padding:0;margin:0;display:grid;gap:6px}
li{display:grid;grid-template-columns:auto auto 1fr;gap:10px;align-items:center}
.tools{display:flex;gap:8px;margin-top:10px}
.tools button{padding:4px 8px;border:1px solid #aaa;border-radius:8px;background:#f9f9fb;cursor:pointer}
.board{position:relative;display:inline-block;touch-action:none}canvas{border:1px solid #ccc;border-radius:10px;position:absolute;left:0;top:0}
.answer{display:none}
@media print{ @page { size: ${pageSizeDecl}; margin: ${opt.marginsMm}mm; } .tools,.words,.note{display:none}.answer{display:block} #fitpage-wrapper{transform:none} }
</style></head><body>

<div id="fitpage-wrapper"><div id="fitpage">

<header><h1>${title}</h1><span class="meta">#${noStr} / ${meta}</span></header>
<div class="wrap">
    <div>
        <div class="board">
            <table id="grid"><tbody>${rows}</tbody></table>
            <canvas id="ink"></canvas>
            ${answer}
</div></div>
        <div class="tools">
            <button id="pen">えんぴつ</button>
            <button id="eraser">けしごむ</button>
            <button id="undo">元に戻す</button>
            <button id="clear">全消し</button>
            <button id="toggleAnswer">こたえ</button>
            <button onclick="window.print()">プリンター</button>
        </div>
    </div>
    <div>
        <h2 style="font-size:14px;margin:0 0 8px;">Words</h2>
        <div class="words"><ul>${lis}</ul></div>
        <p class="note" style="color:#666;font-size:12px;">音声は <code>audio/&lt;かな&gt;.mp3</code> を参照します。</p>
    </div>
</div>
<footer style="margin-top:16px;color:#666;font-size:12px">© ${esc(copyright || '2025 Kotogramico')}</footer>

</div>

<script>
    // …ここに描線や答えトグルのJSが続く…
</script>
<script>
    (function(){
        var opt = ${JSON.stringify(opt)};
        var wrapper = document.getElementById('fitpage-wrapper');
        var page = document.getElementById('fitpage');

        function getPageMm(ps){
            if(typeof ps === 'string'){
                if(ps === 'A4') return { w:210, h:297 };
                if(ps === 'Letter') return { w:216, h:279 };
                return { w:210, h:297 };
            }
            if(ps && typeof ps === 'object' && Number(ps.wMm) && Number(ps.hMm)){
                return { w:Number(ps.wMm), h:Number(ps.hMm) };
            }
            return { w:210, h:297 };
        }

        function mmToPx(mm){ return mm * 96 / 25.4; }

        function applyPageBox(){
            var pad = Math.max(0, Number(opt.marginsMm)||0);
            page.style.boxSizing = 'border-box';
            page.style.padding = pad + 'mm';
            if(opt.screenPreset === 'tablet-portrait'){
                // Base CSS pixel page for portrait tablets (approx iPad-like)
                var baseW = 820, baseH = 1180;
                page.style.width = baseW + 'px';
                page.style.height = baseH + 'px';
            } else {
                var mm = getPageMm(opt.pageSize);
                var wpx = Math.round(mmToPx(mm.w));
                var hpx = Math.round(mmToPx(mm.h));
                page.style.width = wpx + 'px';
                page.style.height = hpx + 'px';
            }
        }

        function fit(){
            if(!wrapper || !page) return;
            applyPageBox();
            if(opt.screenFit === 'none'){ wrapper.style.transform = 'none'; return; }
            wrapper.style.transform = 'none';
            var vw = window.innerWidth || document.documentElement.clientWidth;
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var pw = page.scrollWidth; var ph = page.scrollHeight;
            if(!vw || !vh || !pw || !ph){ wrapper.style.transform = 'none'; return; }
            var s;
            if(opt.screenPreset === 'tablet-portrait'){
                // lock to portrait behavior
                var targetW = Math.min(vw, vh * (820/1180));
                s = Math.min(vw / pw, vh / ph);
            } else {
                s = (opt.screenFit === 'auto') ? Math.min(vw/pw, vh/ph) : Number(opt.screenFit) || 1;
            }
            wrapper.style.transform = 'scale(' + s + ')';
        }

        window.addEventListener('resize', fit);
        setTimeout(fit, 0);
    })();
</script>

</body></html>`;
}

// ====== File System Access ======
async function pickRoot() { return await window.showDirectoryPicker({ id: 'kotogramico-export-root' }); }
async function ensureDir(root, name) { return await root.getDirectoryHandle(name, { create: true }); }

async function writeText(dir, name, txt) {
    const type = name.toLowerCase().endsWith('.json')
        ? 'application/json;charset=utf-8'
        : 'text/html;charset=utf-8';
    try {
        const fileHandle = await dir.getFileHandle(name, { create: true });
        const stream = await fileHandle.createWritable();
        await stream.write(new Blob([txt], { type }));
        await stream.close();
    } catch (e) {
        // Fallback: trigger browser download to avoid ERR_FILE_NOT_FOUND when FS API not available
        const blob = new Blob([txt], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a);
        a.click(); a.remove();
        setTimeout(()=> URL.revokeObjectURL(url), 2000);
    }
}

async function readJSON(root, name) {
    try {
        const fh = await root.getFileHandle(name, { create: false });
        const f = await fh.getFile(); return JSON.parse(await f.text());
    } catch {
        return null;
    }
}

// ====== プレビュー補助（干渉を防ぐ） ======
function openPreview(payload, noStr, options = {}) {
    const html = renderPuzzleHTML(payload, noStr, options);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener');
    // メモリ解放
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return win;
}

function renderPreviewInIframe(container, payload, noStr, options = {}) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    container.innerHTML = '';
    container.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(renderPuzzleHTML(payload, noStr, options));
    doc.close();
    return iframe;
}

// ====== レビュー UI ======
function openReview(records) {
    const wrap = document.createElement('div');
    wrap.id = 'kotoReview';
    wrap.innerHTML = `
<style>
#kotoReview{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center}
#kotoCard{width:min(1100px,95vw);height:min(80vh,800px);background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.2);display:grid;grid-template-rows:auto 1fr auto}
#kotoHead{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee}
#kotoBody{display:grid;grid-template-columns:1fr 320px;row-gap:40px;column-gap:16px;padding:14px;overflow:auto}
#kotoFoot{display:flex;gap:10px;justify-content:space-between;padding:12px 16px;border-top:1px solid #eee}
.kbtn{padding:8px 12px;border:1px solid #aaa;border-radius:10px;background:#f7f7fb;cursor:pointer}
#kotoGrid{border:1px solid #ddd;border-radius:10px;overflow:auto;background:#fff}
#kotoWords{border:1px solid #ddd;border-radius:10px;overflow:auto;background:#fff;padding:10px}
#kotoMeta label{display:block;font-size:12px;color:#555;margin-top:8px}
#kotoMeta input{width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:8px}
</style>
<div id="kotoCard">
    <div id="kotoHead">
        <div><b>デジタル出力 – レビュー</b> <span id="kotoPos"></span></div>
        <div><button id="kotoClose" class="kbtn">閉じる</button></div>
    </div>
    <div id="kotoBody">
        <div id="kotoGrid"></div>
        <div>
            <div id="kotoWords"></div>
            <div id="kotoMeta" style="margin-top:8px">
                <label>タイトル</label><input id="kotoTitle" />
                <label>難易度</label><input id="kotoDiff" />
                <label>著作権表記</label><input id="kotoCopy" />
            </div>
        </div>
    </div>
    <div id="kotoFoot">
        <div>
            <button id="kotoPrev" class="kbtn">← 前</button>
            <button id="kotoNext" class="kbtn">次 →</button>
        </div>
        <div>
            <button id="kotoExport" class="kbtn" style="border-color:#2a7; background:#eafff2">Export All</button>
        </div>
    </div>
</div>`;
    document.body.appendChild(wrap);

    let i = 0;
    const pos = $('#kotoPos', wrap), grid = $('#kotoGrid', wrap),
        words = $('#kotoWords', wrap), title = $('#kotoTitle', wrap),
        diff = $('#kotoDiff', wrap), copy = $('#kotoCopy', wrap);

    function draw() {
        const r = records[i];
        pos.textContent = `(${i + 1} / ${records.length})`;
        const p = r.payload || r;
        const table = `<table style="border-collapse:collapse;border:1.5px solid #999;background:#fff">${(p.grid || []).map(row => `<tr>${
            row.map(ch => `<td style="width:28px;height:28px;border:.5px solid #ddd;text-align:center;font-size:18px">${esc(ensureKana(ch))}</td>`).join('')
        }</tr>`).join('')}</table>`;
        grid.innerHTML = table;
        words.innerHTML = `<ul style="list-style:none;padding:0;margin:0;display:grid;gap:6px">${
            (p.words || []).map(w => `<li style="display:grid;grid-template-columns:auto auto 1fr;gap:8px;align-items:center"><button class="kbtn">▶</button><b>${esc(w.kana || '')}</b><i>${esc(w.romaji || '')}</i><span>${esc(w.en || '')}</span></li>`).join('')
        }</ul>`;
        title.value = p.subtitle || r.title || '';
        diff.value = p.difficulty || r.difficulty || 'normal';
        copy.value = p.copyright || '2025 Kotogramico';
    }
    draw();

    ['input'].forEach(ev => {
        title.addEventListener(ev, () => { const r = records[i]; (r.payload || r).subtitle = title.value; });
        diff.addEventListener(ev, () => { const r = records[i]; (r.payload || r).difficulty = diff.value; });
        copy.addEventListener(ev, () => { const r = records[i]; (r.payload || r).copyright = copy.value; });
    });

    $('#kotoPrev', wrap).onclick = () => { if (i > 0) { i--; draw(); } };
    $('#kotoNext', wrap).onclick = () => { if (i < records.length - 1) { i++; draw(); } };
    $('#kotoClose', wrap).onclick = () => { wrap.remove(); };

    // 一括出力
    $('#kotoExport', wrap).onclick = async () => {
        try {
            const root = await pickRoot();
            const puzzlesDir = await ensureDir(root, 'puzzles');
            const bookDir = await ensureDir(root, 'book');

            let manifest = await readJSON(root, 'manifest.json');
            if (!manifest) manifest = { brand: 'Kotogramico', type: 'wordsearch', title: 'Hiragana Wordsearch', items: [] };

            let noBase = (manifest.items?.length || 0);

            for (const r of records) {
                const p = r.payload || r;
                const no = String(++noBase).padStart(4, '0');

                const html = renderPuzzleHTML(p, no, { screenPreset: 'tablet-portrait', screenFit: 'auto' });
                const relHtml = `puzzles/${no}.html`;
                const relJson = `puzzles/${no}.json`;

                await writeText(puzzlesDir, `${no}.html`, html);
                await writeText(puzzlesDir, `${no}.json`, JSON.stringify({ meta: { no }, payload: p }, null, 2));

                manifest.items.push({
                    id: no,
                    file: relHtml,
                    json: relJson,
                    title: p.subtitle || r.title || '無題',
                    difficulty: p.difficulty || r.difficulty || 'normal',
                    createdAt: r.createdAt || new Date().toISOString()
                });

                await DB.markExported(r.id, relHtml);
            }

            const list = {
                title: manifest.title || 'WordSearch Book',
                items: manifest.items.map(it => ({
                    id: it.id,
                    file: it.file.replace(/^puzzles\//, ''),
                    toc: it.title || it.id
                }))
            };
            await writeText(puzzlesDir, 'list.json', JSON.stringify(list, null, 2));

            await writeText(root, 'manifest.json', JSON.stringify(manifest, null, 2));

            const toc = `<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(manifest.title || 'Kotogramico Wordsearch Book')}</title>
<style>body{font-family:system-ui,"Noto Sans JP",sans-serif;margin:20px}h1{font-size:22px}ol{padding-left:20px}</style>
<h1>${esc(manifest.title || 'Hiragana Wordsearch')}</h1><ol>${
                (manifest.items || []).map((it, i) => `<li><a href="../${esc(it.file)}" target="_blank">#${String(i + 1).padStart(3, '0')} ${esc(it.title || '無題')}</a></li>`).join('')
            }</ol></html>`;
            await writeText(bookDir, 'book.html', toc);

            const n = await DB.unexportedCount();
            const badge = document.getElementById('unexportedBadge');
            if (badge) badge.textContent = `未出力 ${n} 件`;

            alert('Export All 完了');
            wrap.remove();
        } catch (err) {
            console.error(err);
            alert('出力に失敗：' + (err?.message || err));
        }
    };

}

function attach() {
    const btn = document.getElementById('btnDigital');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
        if (e?.stopImmediatePropagation) { e.stopImmediatePropagation(); e.preventDefault(); }
        try {
            const rows = await DB.getUnexportedAll();
            if (!rows.length) { alert('未出力データがありません（確定後に実行）'); return; }
            openReview(rows);
        } catch (err) {
            console.error(err);
            alert('レビューの準備に失敗：' + (err?.message || err));
        }
    });
}