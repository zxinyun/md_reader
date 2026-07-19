// ===== Tauri HTTP wrapper (bypasses CORS via Rust backend) =====
async function tauriFetch(input, init) {
  if (typeof window.__TAURI_INTERNALS__ === 'undefined') {
    return fetch(input, init);
  }
  var url = typeof input === 'string' ? input : input.url;
  var method = (init && init.method) || (typeof input === 'string' ? 'GET' : input.method || 'GET');
  var reqHeaders = []; var h = init && init.headers;
  if (h) {
    if (typeof h.entries === 'function') { for (var pair of h.entries()) reqHeaders.push(pair); }
    else if (Array.isArray(h)) { reqHeaders = h; }
    else { for (var k in h) { if (h.hasOwnProperty(k)) reqHeaders.push([k, h[k]]); } }
  }
  var body = init && init.body ? (typeof init.body === 'string' ? init.body : null) : null;
  var res = await window.__TAURI_INTERNALS__.invoke('http_request', { url: url, method: method, headers: reqHeaders, body: body });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, statusText: res.status_text, url: url, headers: res.headers, json: async function() { return JSON.parse(res.body); }, text: async function() { return res.body; } };
}

// ===== Open file(s) via picker =====
$('openBtn').addEventListener('click', async () => {
  try {
  $('openBtn').classList.add('loading');
  const fds = await FileAPI.pickFiles(ACCEPT_EXTS);
  $('openBtn').classList.remove('loading');
  if (!fds || !fds.length) { $('openBtn').classList.remove('loading'); return; }
  let _count = 0;
  for (const _fd of fds) {
    try {
      const _type = detectFileType(_fd.name);
      const _fullPath = _fd._path || _fd.path || _fd.name;
      const _existing = state.importedFiles.findIndex(f => f.fullPath === _fullPath);
      if (_existing >= 0) {
        state.importedFiles[_existing].type = _type;
        state.importedFiles[_existing]._fileRef = _fd;
        state.importedFiles[_existing].content = null;
      } else {
        state.importedFiles.push({ name: _fd.name, fullPath: _fullPath, type: _type, _fileRef: _fd, content: null });
      }
      _count++;
    } catch(e) { console.warn('注册失败:', _fd.name, e); }
  }
  if (_count) {
    // Find the last UNLOADED file to open (don't re-open already loaded files)
    var _targetIdx = state.importedFiles.length - 1;
    while (_targetIdx >= 0 && state.importedFiles[_targetIdx].content !== null) _targetIdx--;
    if (_targetIdx < 0) _targetIdx = state.importedFiles.length - 1;
    // Rebuild image list if currently viewing images
    if (state.fileType === 'img') {
      buildImageList(null).then(function() {
        openImportedFile(_targetIdx);
      });
    } else {
      await openImportedFile(_targetIdx);
    }
    showToast(`已打开 ${_count} 个文件`);
  }
  } catch(err) { console.error('[openBtn] ERROR:', err); showToast('打开失败: ' + (err.message || err)); }
});
// Legacy fallback for web platform (used by clipboard paste etc.)
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) {
    loadFile(e.target.files[0]);
  }
  fileInput.value = '';
});

// ===== Drag & Drop / Paste =====
const SUPPORTED_FILE_RE = /\.(md|html?|txt|log|pdf|docx?|wps|wpt|xlsx?|et|ett|pptx|dps|dpt|csv|json|xml|ya?ml|js|ts|jsx|tsx|mjs|cjs|vue|svelte|astro|py|rb|php|sh|bash|zsh|css|scss|less|sass|styl|java|cpp?|hpp?|go|rs|swift|kt|dart|lua|r|pl|sql|tex|rst|bat|cmd|ps1|psm1|psd1|ini|cfg|conf|toml|env|gradle|spec|gitignore|dockerfile|makefile|cmake|editorconfig|htaccess|s|scala|hs|clj|erl|ex|exs|fs|cs|reg|vbs|wsf|ahk|asm|wasm|zig|nim|cr|png|jpg|jpeg|gif|webp|bmp|svg|ico|heic|heif|avif|tiff?)$/i;
const BINARY_EXTS = new Set(['pdf','docx','doc','wps','wpt','xlsx','xls','et','ett','pptx','dps','dpt','img',...IMAGE_EXTS.keys()]);

function detectFileType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'md';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'txt';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.wps') || lower.endsWith('.wpt')) return 'docx';
  if (lower.endsWith('.doc')) return 'doc';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.et') || lower.endsWith('.ett')) return 'xlsx';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt') || lower.endsWith('.dps') || lower.endsWith('.dpt')) return 'pptx';
  if (lower.endsWith('.csv')) return 'csv';
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  if (IMAGE_EXTS.has(ext)) return 'img';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'txt';
}
function getFileExt(name) { return name.includes('.') ? name.split('.').pop().toLowerCase() : ''; }
function isBinaryType(type) { return BINARY_EXTS.has(type); }

// Read a File/FileAPI descriptor and return content (ArrayBuffer for binary, decoded text for others)
async function readFileBlob(fileOrDesc, binary) {
  if (binary) {
    if (fileOrDesc instanceof Blob) return await fileOrDesc.arrayBuffer();
    return await FileAPI.readAsArrayBuffer(fileOrDesc);
  }
  // For text files, always read raw bytes and use our own decoder
  // (browser Blob.text() defaults to UTF-8 and garbles GBK/Big5 content)
  var arr;
  if (fileOrDesc instanceof Blob) {
    arr = await fileOrDesc.arrayBuffer();
  } else {
    arr = await FileAPI.readAsArrayBuffer(fileOrDesc);
  }
  const decoded = await decodeText(arr);
  state.fileEncoding = decoded.encoding;
  return decoded.text;
}

let _dropHideTimer = null;

function showDropOverlay() {
  if (_dropHideTimer) { clearTimeout(_dropHideTimer); _dropHideTimer = null; }
  document.getElementById('dropOverlay').classList.add('active');
}
function hideDropOverlay() {
  if (_dropHideTimer) clearTimeout(_dropHideTimer);
  _dropHideTimer = setTimeout(() => document.getElementById('dropOverlay').classList.remove('active'), 100);
}

// Recursively collect file entries from a directory Entry
async function readDirRecursive(dirEntry) {
  const out = [];
  const reader = dirEntry.createReader();
  const allEntries = await new Promise(resolve => {
    const batch = [];
    function next() { reader.readEntries(entries => { if (entries.length) { batch.push(...entries); next(); } else resolve(batch); }); }
    next();
  });
  for (const e of allEntries) {
    if (e.isDirectory) out.push(...await readDirRecursive(e));
    else if (e.isFile && SUPPORTED_FILE_RE.test(e.name)) out.push(e);
  }
  return out;
}

// Read a FileSystemFileEntry → File
function entryToFile(entry) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('超时')), 8000);
    entry.file(f => { clearTimeout(timer); resolve(f); }, err => { clearTimeout(timer); reject(err); });
  });
}

async function handleDropItems(dt) {
  // Phase 1 (synchronous): collect all immediate Files + FileSystemEntry objects
  const immediateFiles = []; // File objects (must be read BEFORE any await)
  const entryRefs = [];      // FileSystemEntry objects (can be read async)
  
  // Use dt.files as the reliable source (always valid in all browsers)
  if (dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (f && SUPPORTED_FILE_RE.test(f.name)) {
        immediateFiles.push({ file: f, name: f.name, path: f.name });
      }
    }
  }
  // Also try items for directory support (webkitGetAsEntry)
  if (dt.items && dt.items.length) {
    for (let i = 0; i < dt.items.length; i++) {
      try {
        const entry = dt.items[i].webkitGetAsEntry ? dt.items[i].webkitGetAsEntry() : null;
        if (entry) {
          if (entry.isDirectory) entryRefs.push(entry);
          else if (entry.isFile && SUPPORTED_FILE_RE.test(entry.name)) entryRefs.push(entry);
        }
      } catch(e) {}
    }
  }
  
  // Phase 2 (async): resolve directory entries, get Files from entries
  const allFiles = [...immediateFiles];
  for (const ref of entryRefs) {
    try {
      if (ref.isDirectory) {
        const subEntries = await readDirRecursive(ref);
        for (const sub of subEntries) {
          try {
            const f = await entryToFile(sub);
            allFiles.push({ file: f, name: f.name, path: (sub.fullPath || f.name).replace(/^\//, '') });
          } catch(e) { console.warn('跳过文件:', sub.name); }
        }
      } else {
        const f = await entryToFile(ref);
        // Deduplicate: skip if same name already from dt.files
        if (!allFiles.some(x => x.path === (ref.fullPath || f.name).replace(/^\//, ''))) {
          allFiles.push({ file: f, name: f.name, path: (ref.fullPath || f.name).replace(/^\//, '') });
        }
      }
    } catch(e) { console.warn('跳过目录/文件:', ref.name); }
  }
  
  if (!allFiles.length) { showToast('未找到支持的文件'); return; }
  
  // Phase 3: register files as refs (lazy load content on open)
  let count = 0;
  for (const item of allFiles) {
    try {
      const type = detectFileType(item.name);
      const existing = state.importedFiles.findIndex(f => f.fullPath === item.path);
      if (existing >= 0) {
        state.importedFiles[existing].type = type;
        state.importedFiles[existing]._fileRef = item.file;
        state.importedFiles[existing].content = null;
      } else {
        state.importedFiles.push({ name: item.name, fullPath: item.path, type, _fileRef: item.file, content: null });
      }
      count++;
    } catch(e) { console.warn('注册失败:', item.name, e); }
  }
  
  if (count) {
    await openImportedFile(state.importedFiles.length - 1);
    showToast(`已导入 ${count} 个文件`);
  } else {
    showToast('未能读取任何文件');
  }
}

async function openImportedFile(idx) {
  try {
  const f = state.importedFiles[idx];
  if (!f) return;
  activeOp.aborted = true;
  await new Promise(r => setTimeout(r, 0));
  activeOp.seq = ++_opSeq;
  activeOp.aborted = false;
  // Lazy load: read content on demand
  if ((f.content === null || f.content === undefined) && f._fileRef) {
    showLoading('正在加载 ' + f.name + '...');
    await new Promise(r => setTimeout(r, 0));
    try {
      const binary = isBinaryType(f.type);
      f.content = await readFileBlob(f._fileRef, binary);
    } catch(e) {
      hideLoading();
      showToast('读取文件失败: ' + (e.message || e));
      return;
    }
    hideLoading();
  }
  if (f.content === null || f.content === undefined) { showToast('文件内容为空'); return; }
  let content = f.content;
  if (content instanceof Uint8Array) content = content.buffer;
  state.fileContent = content;
  state.fileName = f.name;
  state.fileType = f.type || detectFileType(f.name);
  state._currentImportPath = f.fullPath;
  state.fileExt = getFileExt(f.name);
  titleDisplay.textContent = f.name;
  showActionStrip(true);
  const binary = isBinaryType(state.fileType);
  if (binary && state.fileContent instanceof ArrayBuffer) {
    if (state.fileType === 'pdf') renderPdf(state.fileContent);
    else if (state.fileType === 'img') { buildImageList(null).then(renderContent); }
    else renderContent();
  } else {
    if (state.fileType === 'img') { buildImageList(null).then(renderContent); }
    else renderContent();
  }
  try { localStorage.setItem('reader-last-session', JSON.stringify({ name: f.name, type: state.fileType, ext: state.fileExt, timestamp: Date.now() })); } catch(e) {}
  // For PDF in multi-file mode, keep action strip visible for navigation
  if (state.fileType === 'pdf' && state.importedFiles.length > 1) { showActionStrip(true); }
  // Save content to IndexedDB for session restore on next app launch
  if (state.fileContent) {
    var dbContent = state.fileContent instanceof ArrayBuffer ? state.fileContent.slice(0) : state.fileContent;
    dbPut('files', { name: f.name, content: dbContent, type: state.fileType, updatedAt: Date.now() }).catch(() => {});
  }
  updateDocNav();
  } catch(e) { _d('openImportedFile error: ' + (e && e.message || e)); showToast('打开文件失败: ' + (e && e.message || e)); }
}

function getFileIcon(type) {
  const map = { md:'📝', html:'🌐', txt:'📄', pdf:'📕', docx:'📘', doc:'📘', xlsx:'📊', pptx:'📙', csv:'📋', code:'💻' };
  return map[type] || '📄';
}

// Drag events on document (HTML5 native, works in both browser and Tauri with dragDropEnabled:false)
let dragCounter = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; if (dragCounter === 1) showDropOverlay(); });
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; hideDropOverlay(); } });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  hideDropOverlay();
  if (e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items.length) {
    await handleDropItems(e.dataTransfer).catch(err => showToast('导入失败: ' + (err.message || err)));
  } else if (e.dataTransfer && e.dataTransfer.files.length) {
    await handleDropItems(e.dataTransfer).catch(err => showToast('导入失败: ' + (err.message || err)));
  }
});

// Paste handler
document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && SUPPORTED_FILE_RE.test(file.name)) {
        loadFile(file);
        return;
      }
    }
  }
});

// ===== Scroll Progress =====
function getScrollMetrics() {
  if (htmlFrame.style.display !== 'none' && (htmlFrame.src || htmlFrame.srcdoc) && htmlFrame.contentWindow) {
    try {
      const w = htmlFrame.contentWindow;
      const sh = (w.document.documentElement && w.document.documentElement.scrollHeight) || (w.document.body && w.document.body.scrollHeight) || 0;
      const ih = w.innerHeight || 0;
      if (sh > ih) return { scrollTop: Math.max(w.scrollY || w.pageYOffset || 0, 0), scrollHeight: sh - ih };
      // Content fits in viewport — still return iframe metrics (scrollHeight = 0)
      return { scrollTop: 0, scrollHeight: 0 };
    } catch(e) {}
  }
  if (contentArea.scrollHeight > contentArea.clientHeight + 2) {
    return { scrollTop: contentArea.scrollTop, scrollHeight: contentArea.scrollHeight - contentArea.clientHeight };
  }
  const st = window.scrollY || document.documentElement.scrollTop;
  const sh = (document.documentElement.scrollHeight || 0) - window.innerHeight;
  return { scrollTop: st, scrollHeight: sh };
}

function updateProgress() {
  const m = getScrollMetrics();
  const pct = m.scrollHeight > 0 ? Math.min((m.scrollTop / m.scrollHeight) * 100, 100) : 0;
  progressFill.style.width = pct + '%';
  scheduleSaveProgress();
}
window.addEventListener('scroll', updateProgress);
window.addEventListener('resize', updateProgress);
contentArea.addEventListener('scroll', updateProgress);

// ===== Zoom =====
function applyZoom(delta) {
  // If PDF is open, zoom PDF instead of general content
  var pdfWrapper = document.getElementById('pdfViewerWrapper');
  if (pdfWrapper && pdfWrapper._pdfZoom) {
    pdfWrapper._pdfZoom(delta);
    return;
  }
  const old = state.zoomLevel;
  let z = state.zoomLevel + delta;
  z = Math.round(Math.min(4, Math.max(0.25, z)) * 100) / 100;
  if (z === old) return;
  state.zoomLevel = z;
  try { localStorage.setItem('reader-zoom', String(z)); } catch(e) {}
  zoomDisplay.textContent = Math.round(z * 100) + '%';
  // Zoom changes misalign drawings on the fixed canvas — clear them
  if (drawings.length > 0 || drawOverlay.classList.contains('active')) {
    if (drawOverlay.classList.contains('active')) toggleDrawMode();
    drawings = [];
    drawCtx.clearRect(0, 0, drawOverlay.offsetWidth || 300, drawOverlay.offsetHeight || 300);
    showToast('缩放已变更，标注已清除');
  }
  reapplyZoom();
}
function reapplyZoom() {
  const z = state.zoomLevel;
  mdContent.style.transform = '';
  mdContent.style.transformOrigin = '';
  htmlFrame.style.transformOrigin = '';
  // Enable scrollbars on contentArea when zoomed, so transformed overflow is scrollable
  contentArea.style.overflow = (z === 1) ? '' : 'auto';
  // Cross-origin URL with auto-scale base
  if (htmlFrame._autoScale) {
    htmlFrame.style.transform = `scale(${htmlFrame._autoScale * z})`;
    htmlFrame.style.transformOrigin = 'top left';
    return;
  }
  // Iframe visible (same-origin HTML file, PDF)
  if (htmlFrame.style.display === 'block' && (htmlFrame.src || htmlFrame.srcdoc)) {
    htmlFrame.style.transform = z === 1 ? '' : `scale(${z})`;
    htmlFrame.style.transformOrigin = 'top left';
    return;
  }
  // mdContent visible (markdown, text, code, office docs)
  if (mdContent.style.display === 'block') {
    mdContent.style.transform = z === 1 ? '' : `scale(${z})`;
    mdContent.style.transformOrigin = 'top left';
    return;
  }
}

// ===== Keyboard shortcuts =====
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    _toggleDiag();
  }
  if (e.ctrlKey && e.key === 'o') {
    e.preventDefault();
    FileAPI.pickFile(ACCEPT_EXTS).then(fd => { if (fd) loadFile(fd); });
  }
  if (e.key === 'Escape') {
    if (sheet.classList.contains('open')) closeSheet();
  }
  // Document/Image navigation
  if (state.importedFiles.length > 1) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); state.fileType === 'img' ? navigateImage(-1) : navigateDoc(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); state.fileType === 'img' ? navigateImage(1) : navigateDoc(1); }
  }
});

// Register service worker for web platform only
if (!window.__TAURI_INTERNALS__ && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'SW_UPDATED') window.location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===== Handle files opened from external apps (via URL params / Tauri association / platform events) =====
// Check URL params first — if a file is passed, skip session restore
let _hasExternalFile = false;

// Tauri: check for file opened via OS file association
(async function checkTauriFile() {
  if (typeof window.__TAURI_INTERNALS__ === 'undefined') return;
  try {
    const path = await window.__TAURI_INTERNALS__.invoke('get_pending_file');
    if (path) {
      _hasExternalFile = true;
      loadFile({ _path: path }, path.split(/[/\\]/).pop());
    }
  } catch(e) {}
})();

(function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const fileParam = params.get('file');
  if (!fileParam) return;
  _hasExternalFile = true;
  if (fileParam.length > 10 * 1024 * 1024) { showToast('URL 参数过大'); return; }
  try {
    const decoded = atob(fileParam);
    const name = params.get('name') || 'document.md';
    const type = name.endsWith('.html') || name.endsWith('.htm') ? 'text/html' : 'text/markdown';
    const file = new File([decoded], name, { type });
    loadFile(file);
  } catch(e) { showToast('无法解析文件参数'); }
})();

// Defer session restore to not block initial render
if (!_hasExternalFile) {
  setTimeout(() => restoreLastSession().then(() => showRestoreButtonIfAvailable()), 50);
}

// ===== Initial update =====
updateProgress();
// Hide splash screen
var splash = document.getElementById('splash');
if (splash) { splash.style.opacity = '0'; setTimeout(() => { splash.style.display = 'none'; }, 300); }

// KaTeX CSS for HTML export (full, @font-face stripped - 18KB)
// Generated from lib/katex-0.16.11.min.css at build time
const _katexCss = `.katex{font:normal 1.21em KaTeX_Main,Times New Roman,serif;line-height:1.2;text-indent:0;text-rendering:auto}.katex *{-ms-high-contrast-adjust:none!important;border-color:currentColor}.katex .katex-version:after{content:"0.16.11"}.katex .katex-mathml{clip:rect(1px,1px,1px,1px);border:0;height:1px;overflow:hidden;padding:0;position:absolute;width:1px}.katex .katex-html>.newline{display:block}.katex .base{position:relative;white-space:nowrap;width:-webkit-min-content;width:-moz-min-content;width:min-content}.katex .base,.katex .strut{display:inline-block}.katex .textbf{font-weight:700}.katex .textit{font-style:italic}.katex .textrm{font-family:KaTeX_Main}.katex .textsf{font-family:KaTeX_SansSerif}.katex .texttt{font-family:KaTeX_Typewriter}.katex .mathnormal{font-family:KaTeX_Math;font-style:italic}.katex .mathit{font-family:KaTeX_Main;font-style:italic}.katex .mathrm{font-style:normal}.katex .mathbf{font-family:KaTeX_Main;font-weight:700}.katex .boldsymbol{font-family:KaTeX_Math;font-style:italic;font-weight:700}.katex .amsrm,.katex .mathbb,.katex .textbb{font-family:KaTeX_AMS}.katex .mathcal{font-family:KaTeX_Caligraphic}.katex .mathfrak,.katex .textfrak{font-family:KaTeX_Fraktur}.katex .mathboldfrak,.katex .textboldfrak{font-family:KaTeX_Fraktur;font-weight:700}.katex .mathtt{font-family:KaTeX_Typewriter}.katex .mathscr,.katex .textscr{font-family:KaTeX_Script}.katex .mathsf,.katex .textsf{font-family:KaTeX_SansSerif}.katex .mathboldsf,.katex .textboldsf{font-family:KaTeX_SansSerif;font-weight:700}.katex .mathitsf,.katex .textitsf{font-family:KaTeX_SansSerif;font-style:italic}.katex .mainrm{font-family:KaTeX_Main;font-style:normal}.katex .vlist-t{border-collapse:collapse;display:inline-table;table-layout:fixed}.katex .vlist-r{display:table-row}.katex .vlist{display:table-cell;position:relative;vertical-align:bottom}.katex .vlist>span{display:block;height:0;position:relative}.katex .vlist>span>span{display:inline-block}.katex .vlist>span>.pstrut{overflow:hidden;width:0}.katex .vlist-t2{margin-right:-2px}.katex .vlist-s{display:table-cell;font-size:1px;min-width:2px;vertical-align:bottom;width:2px}.katex .vbox{align-items:baseline;display:inline-flex;flex-direction:column}.katex .hbox{width:100%}.katex .hbox,.katex .thinbox{display:inline-flex;flex-direction:row}.katex .thinbox{max-width:0;width:0}.katex .msupsub{text-align:left}.katex .mfrac>span>span{text-align:center}.katex .mfrac .frac-line{border-bottom-style:solid;display:inline-block;width:100%}.katex .hdashline,.katex .hline,.katex .mfrac .frac-line,.katex .overline .overline-line,.katex .rule,.katex .underline .underline-line{min-height:1px}.katex .mspace{display:inline-block}.katex .clap,.katex .llap,.katex .rlap{position:relative;width:0}.katex .clap>.inner,.katex .llap>.inner,.katex .rlap>.inner{position:absolute}.katex .clap>.fix,.katex .llap>.fix,.katex .rlap>.fix{display:inline-block}.katex .llap>.inner{right:0}.katex .clap>.inner,.katex .rlap>.inner{left:0}.katex .clap>.inner>span{margin-left:-50%;margin-right:50%}.katex .rule{border:0 solid;display:inline-block;position:relative}.katex .hline,.katex .overline .overline-line,.katex .underline .underline-line{border-bottom-style:solid;display:inline-block;width:100%}.katex .hdashline{border-bottom-style:dashed;display:inline-block;width:100%}.katex .sqrt>.root{margin-left:.2777777778em;margin-right:-.5555555556em}.katex .fontsize-ensurer.reset-size1.size1,.katex .sizing.reset-size1.size1{font-size:1em}.katex .fontsize-ensurer.reset-size1.size2,.katex .sizing.reset-size1.size2{font-size:1.2em}.katex .fontsize-ensurer.reset-size1.size3,.katex .sizing.reset-size1.size3{font-size:1.4em}.katex .fontsize-ensurer.reset-size1.size4,.katex .sizing.reset-size1.size4{font-size:1.6em}.katex .fontsize-ensurer.reset-size1.size5,.katex .sizing.reset-size1.size5{font-size:1.8em}.katex .fontsize-ensurer.reset-size1.size6,.katex .sizing.reset-size1.size6{font-size:2em}.katex .fontsize-ensurer.reset-size1.size7,.katex .sizing.reset-size1.size7{font-size:2.4em}.katex .fontsize-ensurer.reset-size1.size8,.katex .sizing.reset-size1.size8{font-size:2.88em}.katex .fontsize-ensurer.reset-size1.size9,.katex .sizing.reset-size1.size9{font-size:3.456em}.katex .fontsize-ensurer.reset-size1.size10,.katex .sizing.reset-size1.size10{font-size:4.148em}.katex .fontsize-ensurer.reset-size1.size11,.katex .sizing.reset-size1.size11{font-size:4.976em}.katex .fontsize-ensurer.reset-size2.size1,.katex .sizing.reset-size2.size1{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size2.size2,.katex .sizing.reset-size2.size2{font-size:1em}.katex .fontsize-ensurer.reset-size2.size3,.katex .sizing.reset-size2.size3{font-size:1.1666666667em}.katex .fontsize-ensurer.reset-size2.size4,.katex .sizing.reset-size2.size4{font-size:1.3333333333em}.katex .fontsize-ensurer.reset-size2.size5,.katex .sizing.reset-size2.size5{font-size:1.5em}.katex .fontsize-ensurer.reset-size2.size6,.katex .sizing.reset-size2.size6{font-size:1.6666666667em}.katex .fontsize-ensurer.reset-size2.size7,.katex .sizing.reset-size2.size7{font-size:2em}.katex .fontsize-ensurer.reset-size2.size8,.katex .sizing.reset-size2.size8{font-size:2.4em}.katex .fontsize-ensurer.reset-size2.size9,.katex .sizing.reset-size2.size9{font-size:2.88em}.katex .fontsize-ensurer.reset-size2.size10,.katex .sizing.reset-size2.size10{font-size:3.4566666667em}.katex .fontsize-ensurer.reset-size2.size11,.katex .sizing.reset-size2.size11{font-size:4.1466666667em}.katex .fontsize-ensurer.reset-size3.size1,.katex .sizing.reset-size3.size1{font-size:.7142857143em}.katex .fontsize-ensurer.reset-size3.size2,.katex .sizing.reset-size3.size2{font-size:.8571428571em}.katex .fontsize-ensurer.reset-size3.size3,.katex .sizing.reset-size3.size3{font-size:1em}.katex .fontsize-ensurer.reset-size3.size4,.katex .sizing.reset-size3.size4{font-size:1.1428571429em}.katex .fontsize-ensurer.reset-size3.size5,.katex .sizing.reset-size3.size5{font-size:1.2857142857em}.katex .fontsize-ensurer.reset-size3.size6,.katex .sizing.reset-size3.size6{font-size:1.4285714286em}.katex .fontsize-ensurer.reset-size3.size7,.katex .sizing.reset-size3.size7{font-size:1.7142857143em}.katex .fontsize-ensurer.reset-size3.size8,.katex .sizing.reset-size3.size8{font-size:2.0571428571em}.katex .fontsize-ensurer.reset-size3.size9,.katex .sizing.reset-size3.size9{font-size:2.4685714286em}.katex .fontsize-ensurer.reset-size3.size10,.katex .sizing.reset-size3.size10{font-size:2.9628571429em}.katex .fontsize-ensurer.reset-size3.size11,.katex .sizing.reset-size3.size11{font-size:3.5542857143em}.katex .fontsize-ensurer.reset-size4.size1,.katex .sizing.reset-size4.size1{font-size:.625em}.katex .fontsize-ensurer.reset-size4.size2,.katex .sizing.reset-size4.size2{font-size:.75em}.katex .fontsize-ensurer.reset-size4.size3,.katex .sizing.reset-size4.size3{font-size:.875em}.katex .fontsize-ensurer.reset-size4.size4,.katex .sizing.reset-size4.size4{font-size:1em}.katex .fontsize-ensurer.reset-size4.size5,.katex .sizing.reset-size4.size5{font-size:1.125em}.katex .fontsize-ensurer.reset-size4.size6,.katex .sizing.reset-size4.size6{font-size:1.25em}.katex .fontsize-ensurer.reset-size4.size7,.katex .sizing.reset-size4.size7{font-size:1.5em}.katex .fontsize-ensurer.reset-size4.size8,.katex .sizing.reset-size4.size8{font-size:1.8em}.katex .fontsize-ensurer.reset-size4.size9,.katex .sizing.reset-size4.size9{font-size:2.16em}.katex .fontsize-ensurer.reset-size4.size10,.katex .sizing.reset-size4.size10{font-size:2.5925em}.katex .fontsize-ensurer.reset-size4.size11,.katex .sizing.reset-size4.size11{font-size:3.11em}.katex .fontsize-ensurer.reset-size5.size1,.katex .sizing.reset-size5.size1{font-size:.5555555556em}.katex .fontsize-ensurer.reset-size5.size2,.katex .sizing.reset-size5.size2{font-size:.6666666667em}.katex .fontsize-ensurer.reset-size5.size3,.katex .sizing.reset-size5.size3{font-size:.7777777778em}.katex .fontsize-ensurer.reset-size5.size4,.katex .sizing.reset-size5.size4{font-size:.8888888889em}.katex .fontsize-ensurer.reset-size5.size5,.katex .sizing.reset-size5.size5{font-size:1em}.katex .fontsize-ensurer.reset-size5.size6,.katex .sizing.reset-size5.size6{font-size:1.1111111111em}.katex .fontsize-ensurer.reset-size5.size7,.katex .sizing.reset-size5.size7{font-size:1.3333333333em}.katex .fontsize-ensurer.reset-size5.size8,.katex .sizing.reset-size5.size8{font-size:1.6em}.katex .fontsize-ensurer.reset-size5.size9,.katex .sizing.reset-size5.size9{font-size:1.92em}.katex .fontsize-ensurer.reset-size5.size10,.katex .sizing.reset-size5.size10{font-size:2.3044444444em}.katex .fontsize-ensurer.reset-size5.size11,.katex .sizing.reset-size5.size11{font-size:2.7644444444em}.katex .fontsize-ensurer.reset-size6.size1,.katex .sizing.reset-size6.size1{font-size:.5em}.katex .fontsize-ensurer.reset-size6.size2,.katex .sizing.reset-size6.size2{font-size:.6em}.katex .fontsize-ensurer.reset-size6.size3,.katex .sizing.reset-size6.size3{font-size:.7em}.katex .fontsize-ensurer.reset-size6.size4,.katex .sizing.reset-size6.size4{font-size:.8em}.katex .fontsize-ensurer.reset-size6.size5,.katex .sizing.reset-size6.size5{font-size:.9em}.katex .fontsize-ensurer.reset-size6.size6,.katex .sizing.reset-size6.size6{font-size:1em}.katex .fontsize-ensurer.reset-size6.size7,.katex .sizing.reset-size6.size7{font-size:1.2em}.katex .fontsize-ensurer.reset-size6.size8,.katex .sizing.reset-size6.size8{font-size:1.44em}.katex .fontsize-ensurer.reset-size6.size9,.katex .sizing.reset-size6.size9{font-size:1.728em}.katex .fontsize-ensurer.reset-size6.size10,.katex .sizing.reset-size6.size10{font-size:2.074em}.katex .fontsize-ensurer.reset-size6.size11,.katex .sizing.reset-size6.size11{font-size:2.488em}.katex .fontsize-ensurer.reset-size7.size1,.katex .sizing.reset-size7.size1{font-size:.4166666667em}.katex .fontsize-ensurer.reset-size7.size2,.katex .sizing.reset-size7.size2{font-size:.5em}.katex .fontsize-ensurer.reset-size7.size3,.katex .sizing.reset-size7.size3{font-size:.5833333333em}.katex .fontsize-ensurer.reset-size7.size4,.katex .sizing.reset-size7.size4{font-size:.6666666667em}.katex .fontsize-ensurer.reset-size7.size5,.katex .sizing.reset-size7.size5{font-size:.75em}.katex .fontsize-ensurer.reset-size7.size6,.katex .sizing.reset-size7.size6{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size7.size7,.katex .sizing.reset-size7.size7{font-size:1em}.katex .fontsize-ensurer.reset-size7.size8,.katex .sizing.reset-size7.size8{font-size:1.2em}.katex .fontsize-ensurer.reset-size7.size9,.katex .sizing.reset-size7.size9{font-size:1.44em}.katex .fontsize-ensurer.reset-size7.size10,.katex .sizing.reset-size7.size10{font-size:1.7283333333em}.katex .fontsize-ensurer.reset-size7.size11,.katex .sizing.reset-size7.size11{font-size:2.0733333333em}.katex .fontsize-ensurer.reset-size8.size1,.katex .sizing.reset-size8.size1{font-size:.3472222222em}.katex .fontsize-ensurer.reset-size8.size2,.katex .sizing.reset-size8.size2{font-size:.4166666667em}.katex .fontsize-ensurer.reset-size8.size3,.katex .sizing.reset-size8.size3{font-size:.4861111111em}.katex .fontsize-ensurer.reset-size8.size4,.katex .sizing.reset-size8.size4{font-size:.5555555556em}.katex .fontsize-ensurer.reset-size8.size5,.katex .sizing.reset-size8.size5{font-size:.625em}.katex .fontsize-ensurer.reset-size8.size6,.katex .sizing.reset-size8.size6{font-size:.6944444444em}.katex .fontsize-ensurer.reset-size8.size7,.katex .sizing.reset-size8.size7{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size8.size8,.katex .sizing.reset-size8.size8{font-size:1em}.katex .fontsize-ensurer.reset-size8.size9,.katex .sizing.reset-size8.size9{font-size:1.2em}.katex .fontsize-ensurer.reset-size8.size10,.katex .sizing.reset-size8.size10{font-size:1.4402777778em}.katex .fontsize-ensurer.reset-size8.size11,.katex .sizing.reset-size8.size11{font-size:1.7277777778em}.katex .fontsize-ensurer.reset-size9.size1,.katex .sizing.reset-size9.size1{font-size:.2893518519em}.katex .fontsize-ensurer.reset-size9.size2,.katex .sizing.reset-size9.size2{font-size:.3472222222em}.katex .fontsize-ensurer.reset-size9.size3,.katex .sizing.reset-size9.size3{font-size:.4050925926em}.katex .fontsize-ensurer.reset-size9.size4,.katex .sizing.reset-size9.size4{font-size:.462962963em}.katex .fontsize-ensurer.reset-size9.size5,.katex .sizing.reset-size9.size5{font-size:.5208333333em}.katex .fontsize-ensurer.reset-size9.size6,.katex .sizing.reset-size9.size6{font-size:.5787037037em}.katex .fontsize-ensurer.reset-size9.size7,.katex .sizing.reset-size9.size7{font-size:.6944444444em}.katex .fontsize-ensurer.reset-size9.size8,.katex .sizing.reset-size9.size8{font-size:.8333333333em}.katex .fontsize-ensurer.reset-size9.size9,.katex .sizing.reset-size9.size9{font-size:1em}.katex .fontsize-ensurer.reset-size9.size10,.katex .sizing.reset-size9.size10{font-size:1.2002314815em}.katex .fontsize-ensurer.reset-size9.size11,.katex .sizing.reset-size9.size11{font-size:1.4398148148em}.katex .fontsize-ensurer.reset-size10.size1,.katex .sizing.reset-size10.size1{font-size:.2410800386em}.katex .fontsize-ensurer.reset-size10.size2,.katex .sizing.reset-size10.size2{font-size:.2892960463em}.katex .fontsize-ensurer.reset-size10.size3,.katex .sizing.reset-size10.size3{font-size:.337512054em}.katex .fontsize-ensurer.reset-size10.size4,.katex .sizing.reset-size10.size4{font-size:.3857280617em}.katex .fontsize-ensurer.reset-size10.size5,.katex .sizing.reset-size10.size5{font-size:.4339440694em}.katex .fontsize-ensurer.reset-size10.size6,.katex .sizing.reset-size10.size6{font-size:.4821600771em}.katex .fontsize-ensurer.reset-size10.size7,.katex .sizing.reset-size10.size7{font-size:.5785920926em}.katex .fontsize-ensurer.reset-size10.size8,.katex .sizing.reset-size10.size8{font-size:.6943105111em}.katex .fontsize-ensurer.reset-size10.size9,.katex .sizing.reset-size10.size9{font-size:.8331726133em}.katex .fontsize-ensurer.reset-size10.size10,.katex .sizing.reset-size10.size10{font-size:1em}.katex .fontsize-ensurer.reset-size10.size11,.katex .sizing.reset-size10.size11{font-size:1.1996142719em}.katex .fontsize-ensurer.reset-size11.size1,.katex .sizing.reset-size11.size1{font-size:.2009646302em}.katex .fontsize-ensurer.reset-size11.size2,.katex .sizing.reset-size11.size2{font-size:.2411575563em}.katex .fontsize-ensurer.reset-size11.size3,.katex .sizing.reset-size11.size3{font-size:.2813504823em}.katex .fontsize-ensurer.reset-size11.size4,.katex .sizing.reset-size11.size4{font-size:.3215434084em}.katex .fontsize-ensurer.reset-size11.size5,.katex .sizing.reset-size11.size5{font-size:.3617363344em}.katex .fontsize-ensurer.reset-size11.size6,.katex .sizing.reset-size11.size6{font-size:.4019292605em}.katex .fontsize-ensurer.reset-size11.size7,.katex .sizing.reset-size11.size7{font-size:.4823151125em}.katex .fontsize-ensurer.reset-size11.size8,.katex .sizing.reset-size11.size8{font-size:.578778135em}.katex .fontsize-ensurer.reset-size11.size9,.katex .sizing.reset-size11.size9{font-size:.6945337621em}.katex .fontsize-ensurer.reset-size11.size10,.katex .sizing.reset-size11.size10{font-size:.8336012862em}.katex .fontsize-ensurer.reset-size11.size11,.katex .sizing.reset-size11.size11{font-size:1em}.katex .delimsizing.size1{font-family:KaTeX_Size1}.katex .delimsizing.size2{font-family:KaTeX_Size2}.katex .delimsizing.size3{font-family:KaTeX_Size3}.katex .delimsizing.size4{font-family:KaTeX_Size4}.katex .delimsizing.mult .delim-size1>span{font-family:KaTeX_Size1}.katex .delimsizing.mult .delim-size4>span{font-family:KaTeX_Size4}.katex .nulldelimiter{display:inline-block;width:.12em}.katex .delimcenter,.katex .op-symbol{position:relative}.katex .op-symbol.small-op{font-family:KaTeX_Size1}.katex .op-symbol.large-op{font-family:KaTeX_Size2}.katex .accent>.vlist-t,.katex .op-limits>.vlist-t{text-align:center}.katex .accent .accent-body{position:relative}.katex .accent .accent-body:not(.accent-full){width:0}.katex .overlay{display:block}.katex .mtable .vertical-separator{display:inline-block;min-width:1px}.katex .mtable .arraycolsep{display:inline-block}.katex .mtable .col-align-c>.vlist-t{text-align:center}.katex .mtable .col-align-l>.vlist-t{text-align:left}.katex .mtable .col-align-r>.vlist-t{text-align:right}.katex .svg-align{text-align:left}.katex svg{fill:currentColor;stroke:currentColor;fill-rule:nonzero;fill-opacity:1;stroke-width:1;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;display:block;height:inherit;position:absolute;width:100%}.katex svg path{stroke:none}.katex img{border-style:none;max-height:none;max-width:none;min-height:0;min-width:0}.katex .stretchy{display:block;overflow:hidden;position:relative;width:100%}.katex .stretchy:after,.katex .stretchy:before{content:""}.katex .hide-tail{overflow:hidden;position:relative;width:100%}.katex .halfarrow-left{left:0;overflow:hidden;position:absolute;width:50.2%}.katex .halfarrow-right{overflow:hidden;position:absolute;right:0;width:50.2%}.katex .brace-left{left:0;overflow:hidden;position:absolute;width:25.1%}.katex .brace-center{left:25%;overflow:hidden;position:absolute;width:50%}.katex .brace-right{overflow:hidden;position:absolute;right:0;width:25.1%}.katex .x-arrow-pad{padding:0 .5em}.katex .cd-arrow-pad{padding:0 .55556em 0 .27778em}.katex .mover,.katex .munder,.katex .x-arrow{text-align:center}.katex .boxpad{padding:0 .3em}.katex .fbox,.katex .fcolorbox{border:.04em solid;box-sizing:border-box}.katex .cancel-pad{padding:0 .2em}.katex .cancel-lap{margin-left:-.2em;margin-right:-.2em}.katex .sout{border-bottom-style:solid;border-bottom-width:.08em}.katex .angl{border-right:.049em solid;border-top:.049em solid;box-sizing:border-box;margin-right:.03889em}.katex .anglpad{padding:0 .03889em}.katex .eqn-num:before{content:"(" counter(katexEqnNo) ")";counter-increment:katexEqnNo}.katex .mml-eqn-num:before{content:"(" counter(mmlEqnNo) ")";counter-increment:mmlEqnNo}.katex .mtr-glue{width:50%}.katex .cd-vert-arrow{display:inline-block;position:relative}.katex .cd-label-left{display:inline-block;position:absolute;right:calc(50% + .3em);text-align:left}.katex .cd-label-right{display:inline-block;left:calc(50% + .3em);position:absolute;text-align:right}.katex-display{display:block;margin:1em 0;text-align:center}.katex-display>.katex{display:block;text-align:center;white-space:nowrap}.katex-display>.katex>.katex-html{display:block;position:relative}.katex-display>.katex>.katex-html>.tag{position:absolute;right:0}.katex-display.leqno>.katex>.katex-html>.tag{left:0;right:auto}.katex-display.fleqn>.katex{padding-left:2em;text-align:left}body{counter-reset:katexEqnNo mmlEqnNo}`;

console.log('📖 通用阅读器已启动 [BUILD: ' + __BUILD_ID__ + ']');
console.log('💡 支持 MD/HTML/TXT/PDF/Word/Excel/PPT/CSV/JSON/XML/YAML/代码等');
console.log('📂 点击右上角按钮或按 Ctrl+O 打开文件');
console.log('📋 支持粘贴文件');
var _diag = [];
function _d(m) { if (_diag.length > 200) _diag.shift(); _diag.push(m); }
function _showDiag() {
  var el = document.getElementById('debugPanel');
  if (el) {
    el.textContent = _diag.join('\n');
    el.classList.add('show');
    el.onclick = function() {
      var text = el.textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      el.textContent = '✅ 已复制到剪贴板\n' + text;
    };
  }
}
function _toggleDiag() {
  var el = document.getElementById('debugPanel');
  if (el && el.classList.contains('show')) { _clearDiag(); }
  else { _showDiag(); }
}
function _clearDiag() { _diag = []; var el = document.getElementById('debugPanel'); if (el) el.classList.remove('show'); }
_d('[STARTUP] BUILD=' + __BUILD_ID__);
// Update buildId display with app version
try {
  var _ver = (typeof __VERSION__ !== 'undefined') ? __VERSION__ : 'dev';
  var _buildEl = document.getElementById('buildId');
  if (_buildEl) _buildEl.textContent = 'BUILD: ' + _ver;
} catch(e) {}
_d('[STARTUP] multiFile=' + __FEATURES__.multiFile + ' imgSupport=' + __FEATURES__.imageSupport + ' debugPanel=' + __FEATURES__.debugPanel);
_d('[STARTUP] platform=' + (typeof platform !== 'undefined' ? platform : 'browser'));
_d('[STARTUP] IMAGE_EXTS.has(jpg)=' + (typeof IMAGE_EXTS !== 'undefined' ? IMAGE_EXTS.has('jpg') : 'N/A'));
_d('[STARTUP] BINARY_EXTS.has(img)=' + (typeof BINARY_EXTS !== 'undefined' ? BINARY_EXTS.has('img') : 'N/A'));
_d('[STARTUP] ACCEPT_EXTS includes .jpg=' + (typeof ACCEPT_EXTS !== 'undefined' ? ACCEPT_EXTS.includes('.jpg') : 'N/A'));
_d('[STARTUP] FileAPI.pickFiles=' + (typeof FileAPI !== 'undefined' && typeof FileAPI.pickFiles === 'function' ? 'OK' : 'MISSING'));
_d('[STARTUP] FileAPI.pickFile=' + (typeof FileAPI !== 'undefined' && typeof FileAPI.pickFile === 'function' ? 'OK' : 'MISSING'));
_d('[STARTUP] _showDiag=' + (typeof _showDiag === 'function' ? 'OK' : 'MISSING'));
