// ===== IndexedDB persistence =====
const DB_NAME = 'ReaderDB';
const DB_VER = 1;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('bookmarks')) db.createObjectStore('bookmarks', { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbPut(store, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  }));
}

function dbGet(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  }));
}

function dbDelete(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  }));
}

function dbGetAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  }));
}

function dbClear(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  }));
}

// ===== Bookmark helpers =====
async function saveBookmark() {
  if (!state.fileName) { showToast('没有打开的文件'); return; }
  const scrollTop = getScrollMetrics().scrollTop;
  const label = await showPromptDialog({ title: '书签名称', placeholder: '输入书签名称...', defaultValue: '位置 ' + (document.querySelectorAll('.bm-item').length + 1) });
  if (!label || !label.trim()) return;
  const id = state.fileName + '::' + label.trim();
  dbPut('bookmarks', { id, name: state.fileName, label: label.trim(), scrollTop, createdAt: Date.now() }).then(() => {
    showToast('✅ 书签已添加: ' + label.trim());
  });
}

function showBookmarkSheet() {
  if (!state.fileName) { showToast('没有打开的文件'); return; }
  dbGetAll('bookmarks').then(all => {
    const items = all.filter(b => b.name === state.fileName);
    if (!items.length) { showToast('暂无书签'); return; }
    let html = '';
    items.sort((a, b) => a.createdAt - b.createdAt).forEach(b => {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:var(--radius-sm);-webkit-tap-highlight-color:transparent" class="bm-item" data-scroll="${b.scrollTop}">
        <span>🔖</span>
        <span style="flex:1">${escapeHtml(b.label)}</span>
        <span style="font-size:11px;color:var(--text-secondary)" class="bm-del" data-id="${b.id}">✕</span>
      </div>`;
    });
    const sheetHtml = `
      <div class="sheet-handle"></div>
      <div class="sheet-title">🔖 书签列表</div>
      <div class="sheet-group">${html}</div>`;
    openSheet(sheetHtml);
    setTimeout(() => {
      document.querySelectorAll('.bm-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('bm-del')) return;
          closeSheet();
          const scrollY = parseFloat(el.dataset.scroll);
          scrollContentToPos(scrollY);
        });
      });
      document.querySelectorAll('.bm-del').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          dbDelete('bookmarks', el.dataset.id).then(() => {
            el.closest('.bm-item').remove();
            showToast('书签已删除');
          });
        });
      });
    }, 50);
  });
}
