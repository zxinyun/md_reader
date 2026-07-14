// ===== Clear current document =====
function clearDocument() {
  if (!state.fileName) { showToast('没有打开的文档'); return; }
  if (!confirm('确定清空当前文档？')) return;
  // Remove URL close button
  var _ucb = document.getElementById('urlCloseBtn');
  if (_ucb) _ucb.remove();
  // Keep file in DB for session restore on next page load — only clear UI
  if (_pdfBlobUrl) { URL.revokeObjectURL(_pdfBlobUrl); _pdfBlobUrl = null; }
  if (state.fileType === 'html' || state.fileType === 'pdf') {
    if (htmlFrame.src && htmlFrame.src.startsWith('blob:')) URL.revokeObjectURL(htmlFrame.src);
    var pdfWrapper = document.getElementById('pdfViewerWrapper');
    if (pdfWrapper) pdfWrapper.remove();
  }
  if (state._currentImgDataUrl) { URL.revokeObjectURL(state._currentImgDataUrl); state._currentImgDataUrl = ''; }
  state.fileContent = null;
  state.fileName = '';
  state.fileType = '';
  state.fileExt = '';
  state.fileMeta = {};
  state.importedFiles = [];
  state.imageFiles = [];
  state.imageIndex = -1;
  titleDisplay.textContent = '通用阅读器';
  mdContent.style.display = 'none';
  mdContent.innerHTML = '';
  htmlFrame.style.display = 'none';
  htmlFrame.src = '';
  htmlFrame.srcdoc = '';
  emptyState.style.display = 'flex';
  scrollContentToPos(0, 'instant');
  updateProgress();
  showActionStrip(false);
  $('searchBar').style.display = 'none';
  clearHighlights();
  contentArea.style.overflow = '';
  // Clear drawings
  if (drawOverlay.classList.contains('active')) toggleDrawMode();
  drawings = [];
  drawCtx.clearRect(0, 0, drawOverlay.offsetWidth || 300, drawOverlay.offsetHeight || 300);
  if (editor.style.display !== 'none') { editor.style.display = 'none'; mdContent.style.display = 'none'; }
  updateEditBtn();
  showToast('文档已清空');
}

// ===== Auto-save scroll progress =====
let saveProgressTimer;
function scheduleSaveProgress() {
  clearTimeout(saveProgressTimer);
  saveProgressTimer = setTimeout(() => {
    if (!state.fileName) return;
    const m = getScrollMetrics();
    dbPut('progress', { name: state.fileName, scrollTop: m.scrollTop, scrollHeight: m.scrollHeight, updatedAt: Date.now() }).catch(() => {});
  }, 800);
}

// ===== Session restore =====
async function restoreLastSession() {
  try {
    // Check localStorage for most recent file metadata (covers ALL types)
    let lastMeta = null;
    try { const raw = localStorage.getItem('reader-last-session'); if (raw) lastMeta = JSON.parse(raw); } catch(e) {}
    if (!lastMeta) {
      // Fallback: check IndexedDB for text files
      const allFiles = await dbGetAll('files');
      if (!allFiles.length) return;
      const last = allFiles.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      lastMeta = { name: last.name, type: last.type, ext: last.name.includes('.') ? last.name.split('.').pop() : '' };
      // Auto-restore without confirmation
      const prog = await dbGet('progress', last.name).catch(() => null);
      state.fileContent = last.content;
      state.fileName = last.name;
      state.fileType = last.type;
      state.fileExt = lastMeta.ext;
      titleDisplay.textContent = last.name;
      renderContent();
      if (prog) setTimeout(() => scrollContentToPos(prog.scrollTop, 'instant'), 400);
      showToast('已恢复: ' + last.name);
      return;
    }

    // We have lastMeta from localStorage — check if content exists in DB
    const dbFile = await dbGet('files', lastMeta.name).catch(() => null);
    const prog = await dbGet('progress', lastMeta.name).catch(() => null);
    const hasContent = !!dbFile;

    if (hasContent) {
      // Auto-restore without confirmation
      state.fileContent = dbFile.content;
      state.fileName = lastMeta.name;
      state.fileType = dbFile.type || lastMeta.type;
      state.fileExt = lastMeta.ext;
      titleDisplay.textContent = lastMeta.name;
      renderContent();
      showActionStrip(true);
      if (prog) setTimeout(() => scrollContentToPos(prog.scrollTop, 'instant'), 400);
      showToast('已恢复: ' + lastMeta.name);
    } else if (lastMeta.type === 'html' && !lastMeta.ext) {
      // URL browsing session — re-load the URL
      browseUrl(lastMeta.name);
    } else {
      // Binary file without cached content — show restore button in empty state
      showRestoreButtonIfAvailable();
    }
  } catch(e) { /* silent */ }
}

// ===== Show restore button in empty state if session exists =====
async function showRestoreButtonIfAvailable() {
  try {
    const raw = localStorage.getItem('reader-last-session');
    if (!raw || emptyState.style.display === 'none') return;
    const meta = JSON.parse(raw);
    const area = document.getElementById('restoreBtnArea');
    const btn = document.getElementById('restoreBtn');
    if (!area || !btn) return;
    const dbFile = await dbGet('files', meta.name).catch(() => null);
    const isUrl = meta.type === 'html' && !meta.ext;
    btn.textContent = dbFile ? `📖 恢复: ${meta.name}` : isUrl ? `📖 恢复: ${meta.name}` : `📖 ${meta.name} (重新选择)`;
    area.style.display = 'block';
    btn.onclick = async () => {
      area.style.display = 'none';
      if (dbFile) {
        state.fileContent = dbFile.content;
        state.fileName = meta.name;
        state.fileType = dbFile.type || meta.type;
        state.fileExt = meta.ext || '';
        titleDisplay.textContent = meta.name;
        renderContent();
        const prog = await dbGet('progress', meta.name).catch(() => null);
        if (prog) setTimeout(() => scrollContentToPos(prog.scrollTop, 'instant'), 400);
        showToast('已恢复: ' + meta.name);
      } else if (meta.type === 'html' && !meta.ext) {
        browseUrl(meta.name);
      } else {
        FileAPI.pickFile(ACCEPT_EXTS).then(fd => { if (fd) loadFile(fd); });
      }
    };
  } catch(e) { /* silent */ }
}
