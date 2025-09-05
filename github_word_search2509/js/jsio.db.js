// jsio.db.js
// IndexedDB helper for Kotogramico Wordsearch (confirmed + export flags)
const KotoDB = (() => {
  const DB_NAME = "kotogramico.wordsearch.v1";
  const STORE = "confirmedPuzzles";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbAddConfirmed(puzzle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(puzzle);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetUnexportedCount() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        resolve(rows.filter(r => !r.exported).length);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetFirstUnexported() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result || []).filter(r => !r.exported);
        // 古い順
        rows.sort((a,b) => {
          const ax = a.createdAt || "";
          const bx = b.createdAt || "";
          return ax < bx ? -1 : ax > bx ? 1 : 0;
        });
        resolve(rows[0] || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbMarkExported(id, exportedFile) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = getReq.result;
        if (!row) { resolve(false); return; }
        row.exported = true;
        row.exportedFile = exportedFile;
        row.exportedAt = new Date().toISOString();
        store.put(row);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    dbAddConfirmed,
    dbGetUnexportedCount,
    dbGetFirstUnexported,
    dbMarkExported
  };
})();