// ===== Local lib path mapping (offline) =====
const _libMap = {
  'https://cdn.jsdelivr.net/npm/jschardet@3.1.3/dist/jschardet.min.js': 'lib/jschardet.min.js',
  'https://cdn.jsdelivr.net/npm/cfb@1.2.2/dist/cfb.min.js': 'lib/cfb.min.js',
  'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js': 'lib/mammoth.browser.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js': 'lib/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/docx-preview@0.3.0/dist/docx-preview.min.js': 'lib/docx-preview.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js': 'lib/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js': 'lib/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css': 'lib/katex-0.16.11.min.css',
  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js': 'lib/highlight.min.js',
  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css': 'lib/highlight-github.min.css',
  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css': 'lib/highlight-github-dark.min.css',
  'https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.min.js': 'lib/html-docx.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js': 'lib/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/pptxjs@3.0.1/dist/pptx.min.js': 'lib/pptxjs.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js': 'lib/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/pptxviewjs@1.1.9/dist/PptxViewJS.min.js': 'lib/pptxviewjs.min.js',
  'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js': 'lib/mermaid.min.js',
};
function _localUrl(url) { return _libMap[url] || url; }

// ===== Dynamic script loader (local first, CDN fallback) =====
function loadScript(src) {
  var local = _localUrl(src);
  return new Promise(function(resolve, reject) {
    function tryLoad(url) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = function() {
        if (url === local && src !== local) { tryLoad(src); }
        else { reject(new Error('加载脚本失败: ' + url)); }
      };
      document.head.appendChild(s);
    }
    tryLoad(local);
  });
}

// ===== File Loading =====
const BINARY_SIG_RE = /[\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f]/;
function isBinaryContent(buf) {
  if (!buf || !buf.byteLength) return false;
  const len = Math.min(buf.byteLength, 4096);
  const u8 = new Uint8Array(buf, 0, len);
  let nulls = 0, ctrls = 0;
  for (let i = 0; i < len; i++) {
    if (u8[i] === 0) nulls++;
    else if (u8[i] < 32 && u8[i] !== 9 && u8[i] !== 10 && u8[i] !== 13) ctrls++;
  }
  return nulls > 0 || ctrls > len * 0.1;
}
async function loadFile(source) {
  if (!source) return;
  _clearDiag();

  let file;
  let fd;

  if (source instanceof File || (source.size !== undefined && source._file !== undefined)) {
    file = source._file || source;
  } else if (source._path || source.path) {
    fd = source;
  } else if (source instanceof File) {
    file = source;
  } else {
    showToast('无效的文件来源');
    return;
  }

  const name = fd ? fd.name : file.name;
  let ext = fd ? (fd.ext || '') : '';
  if (!ext && name.includes('.')) ext = name.split('.').pop().toLowerCase();
  if (ext.startsWith('.')) ext = ext.slice(1);
  _d('name=' + name + ' ext=' + ext + ' isTauri=' + !!fd + ' hasPath=' + !!(fd && (fd._path || fd.path)));

  if (name.endsWith('.md'))                         { state.fileType = 'md'; _d('type=md endsWith'); }
  else if (name.endsWith('.html') || name.endsWith('.htm')) { state.fileType = 'html'; _d('type=html endsWith'); }
  else if (name.endsWith('.txt') || name.endsWith('.log'))  { state.fileType = 'txt'; _d('type=txt endsWith'); }
  else if (name.endsWith('.pdf'))                   { state.fileType = 'pdf'; _d('type=pdf endsWith'); }
  else if (name.endsWith('.docx') || name.endsWith('.wps') || name.endsWith('.wpt')) { state.fileType = 'docx'; _d('type=docx'); }
  else if (name.endsWith('.doc')) { state.fileType = 'doc'; _d('type=doc'); }
  else if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.et') || name.endsWith('.ett')) { state.fileType = 'xlsx'; _d('type=xlsx'); }
  else if (name.endsWith('.pptx') || name.endsWith('.dps') || name.endsWith('.dpt')) { state.fileType = 'pptx'; _d('type=pptx'); }
  else if (name.endsWith('.csv'))                   { state.fileType = 'csv'; _d('type=csv'); }
  else if (IMAGE_EXTS.has(ext))                     { state.fileType = 'img'; _d('type=img via IMAGE_EXTS'); }
  else if (CODE_EXTS.has(ext))                      { state.fileType = 'code'; _d('type=code via CODE_EXTS'); }
  else                                              { state.fileType = 'txt'; _d('type=txt fallback'); }

  _d('final fileType=' + state.fileType + ' ext=' + ext + ' IMAGE_EXTS.has=' + IMAGE_EXTS.has(ext));

  state.fileName = name;
  state.fileExt = ext;
  titleDisplay.textContent = name;

  try { localStorage.setItem('reader-last-session', JSON.stringify({ name: name, type: state.fileType, ext: ext, timestamp: Date.now() })); } catch(e) {}

  let isBinary = state.fileType === 'pdf' || state.fileType === 'docx' || state.fileType === 'doc' || state.fileType === 'xlsx' || state.fileType === 'pptx' || state.fileType === 'img';
  _d('isBinary=' + isBinary + ' fileType=' + state.fileType);

  let raw;
  if (fd) {
    try {
      raw = await FileAPI.readAsArrayBuffer(fd);
      _d('readAsArrayBuffer fd: type=' + typeof raw + ' isArrayBuffer=' + (raw instanceof ArrayBuffer) + ' byteLength=' + (raw ? raw.byteLength : 0));
      if (!raw || raw.byteLength === 0) _d('WARNING: raw is empty!');
    } catch(e) {
      _d('ERROR: readAsArrayBuffer failed: ' + (e.message || e));
      showToast('读取文件失败'); return;
    }
    _d('check: !isBinary=' + !isBinary + ' fileType==txt=' + (state.fileType === 'txt') + ' isBinaryContent=' + (isBinaryContent(raw)));
    if (!isBinary && state.fileType === 'txt' && isBinaryContent(raw)) {
      if (IMAGE_EXTS.has(ext)) {
        _d('>>> IMAGE ext detected but type=txt, forcing img <<<');
        state.fileType = 'img'; isBinary = true;
      } else {
        _d('>>> WILL SHOW: 不支持的文件格式 <<<');
        showToast('不支持的文件格式'); return;
      }
    }
    _d('check passed');
  } else {
    try {
      raw = await file.arrayBuffer();
      _d('readAsArrayBuffer file: type=' + typeof raw + ' isArrayBuffer=' + (raw instanceof ArrayBuffer) + ' byteLength=' + (raw ? raw.byteLength : 0));
    } catch(e) {
      _d('ERROR: file.arrayBuffer() failed: ' + (e.message || e));
      showToast('读取文件失败'); return;
    }
    _d('check: !isBinary=' + !isBinary + ' fileType==txt=' + (state.fileType === 'txt') + ' isBinaryContent=' + (isBinaryContent(raw)));
    if (!isBinary && state.fileType === 'txt' && isBinaryContent(raw)) {
      if (IMAGE_EXTS.has(ext)) {
        _d('>>> IMAGE ext detected but type=txt, forcing img <<<');
        state.fileType = 'img'; isBinary = true;
      } else {
        _d('>>> WILL SHOW: 不支持的文件格式 <<<');
        showToast('不支持的文件格式'); return;
      }
    }
    _d('check passed');
  }

  if (isBinary) {
    state.fileContent = raw;
    state.fileEncoding = 'Binary';
  } else {
    const decoded = await decodeText(raw);
    state.fileContent = decoded.text;
    state.fileEncoding = decoded.encoding;
  }
  state._currentImportPath = fd ? (fd._path || fd.path) : name;
  _d('fileContent set: type=' + typeof state.fileContent + ' byteLength=' + (state.fileContent ? state.fileContent.byteLength || state.fileContent.length : 0));
  if (!state.importedFiles.some(f => f.name === name && f.fullPath === (fd ? (fd._path || fd.path) : name))) {
    state.importedFiles.push({ name, fullPath: fd ? (fd._path || fd.path) : name, content: state.fileContent, type: state.fileType });
    _d('pushed to importedFiles');
  }
  if (state.fileType === 'pdf') {
    _d('rendering PDF');
    renderPdf(state.fileContent);
  } else if (state.fileType === 'img') {
    _d('rendering IMG, calling buildImageList');
    await buildImageList(fd);
    renderContent();
  } else {
    _d('rendering content type=' + state.fileType);
    renderContent();
  }
  showToast(`已打开: ${name}`);
  var dbContent = state.fileContent instanceof ArrayBuffer ? state.fileContent.slice(0) : state.fileContent;
  dbPut('files', { name: name, content: dbContent, type: state.fileType, updatedAt: Date.now() }).catch(() => {});
  updateDocNav();
}

// ===== Abort mechanism =====
let activeOp = { aborted: false, label: '', seq: 0 };
let _opSeq = 0;

function resetAbort() {
  activeOp.aborted = false;
  activeOp.label = '';
}

function abortOp() {
  activeOp.aborted = true;
  hideLoading();
  showToast(`已取消: ${activeOp.label || '操作'}`);
  mdContent.style.display = 'block';
  mdContent.innerHTML = `<div class="empty-state" style="min-height:auto;padding:40px 0">
    <div class="icon" style="font-size:40px">⏹️</div>
    <h2>操作已取消</h2>
    <p style="font-size:13px;color:var(--text-secondary)">${escapeHtml(activeOp.label || '')}</p></div>`;
}

function showLoading(msg, cancelable = false) {
  resetAbort();
  emptyState.style.display = 'none';
  mdContent.style.display = 'none';
  htmlFrame.style.display = 'none';
  loadingIndicator.style.display = 'flex';
  loadingText.textContent = msg || '加载中...';
  const cb = document.getElementById('cancelBtn');
  if (cancelable) {
    cb.style.display = 'block';
    cb.onclick = abortOp;
    activeOp.label = msg || '加载';
    // Auto-show cancel after 3s if still loading
    setTimeout(() => { if (loadingIndicator.style.display !== 'none') cb.style.display = 'block'; }, 3000);
  } else {
    cb.style.display = 'none';
    cb.onclick = null;
  }
}

function hideLoading() {
  loadingIndicator.style.display = 'none';
  document.getElementById('cancelBtn').style.display = 'none';
}

function showContent() {
  emptyState.style.display = 'none';
  loadingIndicator.style.display = 'none';
  document.getElementById('cancelBtn').style.display = 'none';
}

function updateEditBtn() {
  $('actEdit').style.display = state.fileType === 'md' && editor.style.display === 'none' ? '' : 'none';
}

async function renderContent() {
  showActionStrip(true);
  hideLoading();
  // Remove URL close button if present
  var _ucb = document.getElementById('urlCloseBtn');
  if (_ucb) _ucb.remove();
  // Close PDF viewer if open
  var _pw = document.getElementById('pdfViewerWrapper');
  if (_pw) _pw.remove();
  // Remove any XFO error div from previous URL attempt
  const oldErr = mdContent.querySelector('.xfo-error');
  if (oldErr) oldErr.remove();
  // Reset URL-browsing styles on mdContent iframe parent
  mdContent.style.position = '';
  mdContent.style.overflow = '';
  mdContent.style.height = '';
  mdContent.style.minHeight = '';
  htmlFrame.style.position = '';
  htmlFrame.style.width = '';
  htmlFrame.style.height = '';
  htmlFrame.style.transform = '';
  htmlFrame.style.transformOrigin = '';
  htmlFrame.style.top = '';
  htmlFrame.style.left = '';
  htmlFrame.scrolling = 'auto';
  mdContent.style.display = 'none';
  htmlFrame.style.display = 'none';

  if (state.fileType === 'md') {
    showContent();
    mdContent.style.display = 'block';
    mdContent.innerHTML = mdParser(state.fileContent);
    setupCopyButtons();
    await new Promise(r => setTimeout(r, 0));
    await enhanceMdContent();
    buildMdOutline();
    reapplyZoom();
  } else if (state.fileType === 'html') {
    showContent();
    htmlFrame.style.display = 'block';
    htmlFrame.className = 'html-frame';
    htmlFrame.src = '';
    htmlFrame._searchDoc = null;
    htmlFrame.removeAttribute('sandbox');
    htmlFrame.srcdoc = state.fileContent;
    htmlFrame.onload = () => {
      try {
        const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
        htmlFrame._searchDoc = doc;
        const meta = doc.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=3.0';
        if (doc.head) doc.head.insertBefore(meta, doc.head.firstChild);
        const style = doc.createElement('style');
        style.textContent = `html{overflow:auto!important;padding:0 16px}body{overflow:auto!important;max-width:100%!important;box-sizing:border-box;word-wrap:break-word;overflow-wrap:break-word;margin:16px auto!important;max-width:800px!important}img,video,iframe,embed{max-width:100%;height:auto}table{overflow-x:auto;max-width:100%;display:block}pre{overflow-x:auto}`;
        if (doc.head) doc.head.appendChild(style);
        injectSearchStyles(doc);
        try { doc.defaultView.addEventListener('scroll', updateProgress); } catch(e) {}
      } catch(e) { htmlFrame._searchDoc = null; }
      reapplyZoom();
    };
    htmlFrame.onerror = () => {
      htmlFrame.style.display = 'none';
      mdContent.style.display = 'block';
      mdContent.innerHTML = `<div style="padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm)">${state.fileContent}</div>`;
      reapplyZoom();
    };
  } else if (state.fileType === 'txt') {
    showContent();
    mdContent.style.display = 'block';
    mdContent.innerHTML = `<pre class="txt-content">${escapeHtml(state.fileContent)}</pre>`;
    reapplyZoom();
  } else if (state.fileType === 'docx') {
    if (isEncryptedOffice(state.fileContent)) { handleEncryptedFile(state.fileContent, 'docx'); return; }
    renderDocx(state.fileContent);
  } else if (state.fileType === 'doc') {
    renderDoc(state.fileContent);
  } else if (state.fileType === 'xlsx') {
    if (isEncryptedOffice(state.fileContent)) { handleEncryptedFile(state.fileContent, 'xlsx'); return; }
    renderXlsx(state.fileContent);
  } else if (state.fileType === 'pptx') {
    if (isEncryptedOffice(state.fileContent)) { handleEncryptedFile(state.fileContent, 'pptx'); return; }
    await renderPptx(state.fileContent);
  } else if (state.fileType === 'pdf') {
    renderPdf(state.fileContent);
  } else if (state.fileType === 'csv') {
    renderCsv(state.fileContent);
  } else if (state.fileType === 'code') {
    renderCode(state.fileContent, state.fileExt, state.fileName);
  } else if (state.fileType === 'img') {
    renderImg(state.fileContent, state.fileExt, state.fileName);
  }
  updateEditBtn();
}

var _pdfBlobUrl = null;

function renderPdf(buf) {
  showLoading('正在加载 PDF...');
  // Web: use iframe (browser built-in PDF viewer)
  if (typeof FileAPI !== 'undefined' && FileAPI.platform === 'web') {
    if (_pdfBlobUrl) { URL.revokeObjectURL(_pdfBlobUrl); _pdfBlobUrl = null; }
    const blob = new Blob([buf], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    _pdfBlobUrl = url;
    htmlFrame.style.display = 'block';
    htmlFrame.className = 'pdf-container';
    htmlFrame.src = url;
    htmlFrame.onload = () => { showContent(); hideLoading(); };
    htmlFrame.onerror = () => { hideLoading(); showToast('PDF 加载失败'); };
    return;
  }
  // Mobile (Capacitor/Android): use pdf.js
  showContent();
  renderPdfWithPdfJs(buf);
}

async function renderPdfWithPdfJs(buf) {
  try {
    var baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
    if (!_pdfjsLib) {
      _pdfjsLib = await import(baseUrl + 'lib/pdf.min.mjs');
      _pdfjsLib.GlobalWorkerOptions.workerSrc = baseUrl + 'lib/pdf.worker.min.mjs';
    }
    const loadingTask = _pdfjsLib.getDocument({ data: new Uint8Array(buf) });
    const pdf = await loadingTask.promise;
    htmlFrame.style.display = 'none';
    emptyState.style.display = 'none';

    var wrapper = document.getElementById('pdfViewerWrapper');
    if (wrapper) wrapper.remove();
    wrapper = document.createElement('div');
    wrapper.id = 'pdfViewerWrapper';
    wrapper.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';
    contentArea.appendChild(wrapper);

    var currentScale = 1;
    var _scaleManual = false;
    var currentPage = 1;
    var totalPages = pdf.numPages;
    var baseWidth = 0;
    var thumbScale = 0.12;
    var showThumbs = false;
    var annotations = {};
    var notes = {};
    var activeTool = 'none';
    var drawColor = '#FFEB3B';
    var drawWidth = 3;
    var pageCanvases = [];
    var thumbCanvases = [];

    var btnStyle = 'padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px;cursor:pointer;white-space:nowrap;flex-shrink:0;';

    var toolbar = document.createElement('div');
    toolbar.style.cssText = 'flex-shrink:0;background:var(--bg-card);border-bottom:1px solid var(--border);user-select:none;';
    var row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;align-items:center;gap:4px;padding:6px 8px;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:wrap;';
    row1.innerHTML = [
      '<button id="pdfThumbs" title="缩略图" style="' + btnStyle + 'font-size:16px;">☰</button>',
      '<button id="pdfPrev" title="上一页" style="' + btnStyle + 'font-size:16px;">◀</button>',
      '<input id="pdfPageInput" type="number" min="1" max="' + totalPages + '" value="1" style="width:44px;text-align:center;padding:4px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px;flex-shrink:0;" />',
      '<span id="pdfPageInfo" style="font-size:13px;color:var(--text-secondary);flex-shrink:0;">/' + totalPages + '</span>',
      '<button id="pdfNext" title="下一页" style="' + btnStyle + 'font-size:16px;">▶</button>',
      '<div style="width:1px;height:20px;background:var(--border);margin:0 2px;flex-shrink:0;"></div>',
      '<button id="pdfZoomOut" title="缩小" style="' + btnStyle + 'font-size:16px;">−</button>',
      '<span id="pdfZoomLevel" style="font-size:12px;color:var(--text-secondary);min-width:36px;text-align:center;flex-shrink:0;">100%</span>',
      '<button id="pdfZoomIn" title="放大" style="' + btnStyle + 'font-size:16px;">+</button>',
      '<button id="pdfRotate" title="旋转/镜像" style="' + btnStyle + 'font-size:16px;">🔄</button>',
      '<div style="width:1px;height:20px;background:var(--border);margin:0 2px;flex-shrink:0;"></div>',
      '<button id="pdfToolBtn" title="标注工具" style="' + btnStyle + 'font-size:16px;">✏️</button>',
      '<button id="pdfClose" title="关闭" style="' + btnStyle + 'font-size:14px;color:#f44336;">✕</button>'
    ].join('');
    toolbar.appendChild(row1);

    var row2 = document.createElement('div');
    row2.id = 'pdfAnnoBar';
    row2.style.cssText = 'display:none;align-items:center;gap:4px;padding:4px 8px 6px;border-top:1px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch;';
    row2.innerHTML = [
      '<button id="pdfToolHighlight" title="高亮" style="' + btnStyle + 'font-size:15px;">🖍</button>',
      '<button id="pdfToolDraw" title="画笔" style="' + btnStyle + 'font-size:15px;">✏</button>',
      '<button id="pdfToolRect" title="矩形" style="' + btnStyle + 'font-size:15px;">▭</button>',
      '<button id="pdfToolUnderline" title="下划线" style="' + btnStyle + 'font-size:15px;font-weight:bold;">U̲</button>',
      '<select id="pdfDrawColor" style="padding:4px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;flex-shrink:0;">' +
        '<option value="#FFEB3B">黄色</option>' +
        '<option value="#FF5722">红色</option>' +
        '<option value="#4CAF50">绿色</option>' +
        '<option value="#2196F3">蓝色</option>' +
        '<option value="#FF9800">橙色</option>' +
      '</select>',
      '<button id="pdfToolNote" title="便签" style="' + btnStyle + 'font-size:15px;">📝</button>',
      '<button id="pdfToolEraser" title="清除标注" style="' + btnStyle + 'font-size:14px;">🗑</button>'
    ].join('');
    toolbar.appendChild(row2);
    wrapper.appendChild(toolbar);

    var body = document.createElement('div');
    body.style.cssText = 'flex:1;display:flex;overflow:hidden;position:relative;';

    var thumbPanel = document.createElement('div');
    thumbPanel.id = 'pdfThumbPanel';
    thumbPanel.style.cssText = 'width:140px;overflow-y:auto;border-right:1px solid var(--border);background:var(--bg-card);flex-shrink:0;padding:8px;display:none;flex-direction:column;gap:6px;';
    body.appendChild(thumbPanel);

    var scrollContainer = document.createElement('div');
    scrollContainer.style.cssText = 'flex:1;overflow-x:auto;overflow-y:auto;padding:12px;-webkit-overflow-scrolling:touch;';
    body.appendChild(scrollContainer);

    wrapper.appendChild(body);

    var pagesContainer = document.createElement('div');
    pagesContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;position:relative;min-width:min-content;';
    scrollContainer.appendChild(pagesContainer);

    function updatePageInfo() {
      document.getElementById('pdfPageInfo').textContent = '/' + totalPages;
      document.getElementById('pdfPageInput').value = currentPage;
      document.getElementById('pdfZoomLevel').textContent = Math.round(currentScale * 100) + '%';
      highlightThumb(currentPage);
    }

    function highlightThumb(page) {
      thumbCanvases.forEach(function(t, idx) {
        t.container.style.outline = (idx + 1 === page) ? '2px solid var(--primary)' : 'none';
      });
    }

    async function renderThumbnails() {
      thumbPanel.innerHTML = '';
      thumbCanvases = [];
      for (var i = 1; i <= totalPages; i++) {
        var page = await pdf.getPage(i);
        var vp = page.getViewport({ scale: thumbScale * (window.devicePixelRatio || 1) });
        var c = document.createElement('canvas');
        c.width = vp.width;
        c.height = vp.height;
        c.style.cssText = 'width:100%;height:auto;display:block;border-radius:4px;cursor:pointer;';
        var ctx = c.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        var label = document.createElement('div');
        label.style.cssText = 'text-align:center;font-size:11px;color:var(--text-secondary);padding:2px 0;';
        label.textContent = i;
        var container = document.createElement('div');
        container.style.cssText = 'padding:2px;border-radius:6px;cursor:pointer;transition:background 0.15s;';
        container.onmouseenter = function() { this.style.background = 'var(--bg-hover, rgba(128,128,128,0.1))'; };
        container.onmouseleave = function() { this.style.background = 'transparent'; };
        container.appendChild(c);
        container.appendChild(label);
        (function(pageNum) {
          container.addEventListener('click', function() {
            if (pageNum !== currentPage) {
              currentPage = pageNum;
              renderAllPages();
            }
          });
        })(i);
        thumbPanel.appendChild(container);
        thumbCanvases.push({ container: container, pageNum: i });
      }
      highlightThumb(currentPage);
    }

    function createPageOverlay(pageNum) {
      var existing = pagesContainer.querySelector('[data-overlay="' + pageNum + '"]');
      if (existing) existing.remove();
      var pageData = pageCanvases[pageNum - 1];
      if (!pageData) return null;
      var wrap = pageData.element;
      var canvas = pageData.canvas;
      var overlay = document.createElement('canvas');
      overlay.setAttribute('data-overlay', pageNum);
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:' + Math.round(canvas.width / (window.devicePixelRatio || 1)) + 'px;height:100%;cursor:crosshair;touch-action:none;';
      wrap.style.position = 'relative';
      wrap.appendChild(overlay);
      return overlay;
    }

    async function renderAllPages() {
      pagesContainer.innerHTML = '';
      pagesContainer.style.alignItems = 'center';
      pageCanvases = [];
      var page = await pdf.getPage(currentPage);
      // Auto-fit: calculate scale to fit container width (always on first load)
      var containerW = scrollContainer.clientWidth - 24;
      var rawViewport = page.getViewport({ scale: 1 });
      if (containerW > 0 && !_scaleManual) {
        currentScale = containerW / rawViewport.width * (window.devicePixelRatio || 1);
      }
      var viewport = page.getViewport({ scale: currentScale });
      baseWidth = viewport.width;
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var dispW = Math.round(viewport.width / (window.devicePixelRatio || 1));
      canvas.style.cssText = 'width:' + dispW + 'px;height:auto;display:block;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.2);';
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var wrap = document.createElement('div');
      wrap.style.position = 'relative';
      if (mirror || vMirror || rotation !== 0) {
        var transforms = [];
        if (mirror) transforms.push('scaleX(-1)');
        if (vMirror) transforms.push('scaleY(-1)');
        if (rotation !== 0) transforms.push('rotate(' + rotation + 'deg)');
        wrap.style.transform = transforms.join(' ');
        wrap.style.transformOrigin = 'center center';
      }
      wrap.appendChild(canvas);
      pagesContainer.appendChild(wrap);
      pageCanvases.push({ element: wrap, canvas: canvas, pageNum: currentPage, viewport: viewport });
      renderAnnotations();
      updatePageInfo();
    }

    function renderAnnotations() {
      Object.keys(annotations).forEach(function(key) {
        var ann = annotations[key];
        var pageData = pageCanvases[ann.pageNum - 1];
        if (!pageData) return;
        var overlay = pageData.element.querySelector('[data-overlay="' + ann.pageNum + '"]');
        if (!overlay) overlay = createPageOverlay(ann.pageNum);
        if (!overlay) return;
        var ctx = overlay.getContext('2d');
        if (ann.type === 'highlight') {
          ctx.fillStyle = ann.color + '66';
          ctx.fillRect(ann.x, ann.y, ann.w, ann.h);
        } else if (ann.type === 'rect') {
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
        } else if (ann.type === 'underline') {
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(ann.x, ann.y);
          ctx.lineTo(ann.x + ann.w, ann.y);
          ctx.stroke();
        } else if (ann.type === 'draw' && ann.points) {
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = ann.width || 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ann.points.forEach(function(p, pi) {
            if (pi === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        }
      });
      Object.keys(notes).forEach(function(key) {
        var note = notes[key];
        var pageData = pageCanvases[note.pageNum - 1];
        if (!pageData) return;
        var wrap = pageData.element;
        var marker = wrap.querySelector('.pdf-note-marker');
        if (marker) marker.remove();
        var m = document.createElement('div');
        m.className = 'pdf-note-marker';
        m.title = note.text;
        m.style.cssText = 'position:absolute;top:' + (note.y || 10) + 'px;right:10px;width:24px;height:24px;background:#FF9800;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
        m.textContent = '📝';
        (function(nk) {
          m.addEventListener('click', async function() {
            var txt = await showPromptDialog({ title: '编辑便签', placeholder: '输入便签内容...', defaultValue: notes[nk].text || '' });
            if (txt) { notes[nk].text = txt; m.title = txt; }
          });
        })(key);
        wrap.appendChild(m);
      });
    }

    document.getElementById('pdfPageInput').addEventListener('change', function() {
      var p = parseInt(this.value);
      if (p >= 1 && p <= totalPages) {
        currentPage = p;
        renderAllPages();
      }
    });
    document.getElementById('pdfPrev').addEventListener('click', function() {
      if (currentPage > 1) {
        currentPage--;
        renderAllPages().then(renderThumbnails);
      }
    });
    document.getElementById('pdfNext').addEventListener('click', function() {
      if (currentPage < totalPages) {
        currentPage++;
        renderAllPages().then(renderThumbnails);
      }
    });
    document.getElementById('pdfZoomIn').addEventListener('click', function() {
      _scaleManual = true;
      currentScale = Math.min(currentScale * 1.25, 10);
      renderAllPages().then(renderThumbnails);
    });
    document.getElementById('pdfZoomOut').addEventListener('click', function() {
      _scaleManual = true;
      currentScale = Math.max(currentScale / 1.25, 0.25);
      renderAllPages().then(renderThumbnails);
    });
    // Register PDF zoom for main toolbar zoom buttons
    wrapper._pdfZoom = function(delta) {
      _scaleManual = true;
      currentScale = Math.min(Math.max(currentScale * (1 + delta), 0.25), 10);
      renderAllPages().then(renderThumbnails);
      zoomDisplay.textContent = Math.round(currentScale * 100) + '%';
    };
    wrapper._pdfFitWidth = function() {
      _scaleManual = false;
      renderAllPages().then(renderThumbnails);
    };
    wrapper._pdfNav = function(dir) {
      var newPage = currentPage + dir;
      if (newPage < 1 || newPage > totalPages) return;
      currentPage = newPage;
      renderAllPages().then(renderThumbnails);
    };
    function saveRotatedPage() {
      var pd = pageCanvases[0];
      if (!pd) { showToast('没有可保存的页面'); return; }
      var srcCanvas = pd.canvas;
      var c = document.createElement('canvas');
      var w = srcCanvas.width, h = srcCanvas.height;
      // Swap dimensions for 90/270 rotation
      if (rotation % 180 !== 0) { c.width = h; c.height = w; } else { c.width = w; c.height = h; }
      var ctx = c.getContext('2d');
      ctx.save();
      ctx.translate(c.width / 2, c.height / 2);
      if (mirror) ctx.scale(-1, 1);
      if (vMirror) ctx.scale(1, -1);
      if (rotation !== 0) ctx.rotate(rotation * Math.PI / 180);
      ctx.drawImage(srcCanvas, -w / 2, -h / 2);
      ctx.restore();
      c.toBlob(function(blob) {
        if (!blob) { showToast('保存失败'); return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (state.fileName || 'page') + '_p' + currentPage + '_rotated.png';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('已保存第 ' + currentPage + ' 页');
      }, 'image/png');
    }
    // Delay first render so container has layout dimensions
    setTimeout(function() { renderAllPages().then(renderThumbnails); }, 50);
    document.getElementById('pdfThumbs').addEventListener('click', function() {
      showThumbs = !showThumbs;
      thumbPanel.style.display = showThumbs ? 'flex' : 'none';
      this.style.background = showThumbs ? 'var(--primary)' : '';
      this.style.color = showThumbs ? '#fff' : '';
    });
    var rotation = 0, mirror = false, vMirror = false;
    document.getElementById('pdfRotate').addEventListener('click', function(e) {
      var existing = document.getElementById('pdfRotateMenu');
      if (existing) { existing.remove(); return; }
      var btn = this;
      var rect = btn.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.id = 'pdfRotateMenu';
      menu.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;z-index:99999;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:4px;display:flex;flex-direction:column;gap:2px;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
      var subBtnStyle = 'padding:8px 16px;border:none;border-radius:4px;background:transparent;color:var(--text);font-size:14px;cursor:pointer;white-space:nowrap;text-align:left;';
      var items = [
        { text: '↺ 左旋90°', action: function() { rotation = (rotation - 90 + 360) % 360; renderAllPages(); showToast('已左旋 ' + rotation + '°'); } },
        { text: '↻ 右旋90°', action: function() { rotation = (rotation + 90) % 360; renderAllPages(); showToast('已右旋 ' + rotation + '°'); } },
        { text: '↔ 水平镜像', action: function() { mirror = !mirror; renderAllPages(); showToast(mirror ? '已水平镜像' : '已取消镜像'); } },
        { text: '↕ 垂直镜像', action: function() { vMirror = !vMirror; renderAllPages(); showToast(vMirror ? '已垂直镜像' : '已取消垂直镜像'); } },
        { text: '💾 保存当前页', action: function() { saveRotatedPage(); } }
      ];
      items.forEach(function(item) {
        var b = document.createElement('button');
        b.textContent = item.text;
        b.style.cssText = subBtnStyle;
        b.addEventListener('click', function() { item.action(); menu.remove(); });
        b.addEventListener('touchstart', function() { this.style.background = 'var(--primary-light)'; }, {passive:true});
        b.addEventListener('touchend', function() { this.style.background = 'transparent'; });
        menu.appendChild(b);
      });
      document.body.appendChild(menu);
      setTimeout(function() {
        document.addEventListener('click', function closeMenu(ev) {
          if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('click', closeMenu); }
        });
      }, 10);
    });
    document.getElementById('pdfClose').addEventListener('click', function() {
      wrapper.remove();
      pageCanvases = [];
      thumbCanvases = [];
      annotations = {};
      notes = {};
      try { pdf.destroy(); } catch(e) {}
      state.fileContent = null;
      state.fileName = '';
      state.fileType = '';
      state.fileExt = '';
      state.fileEncoding = '';
      titleDisplay.textContent = '';
      mdContent.style.display = 'none';
      htmlFrame.style.display = 'none';
      emptyState.style.display = 'flex';
    });

    function setTool(tool) {
      activeTool = (activeTool === tool) ? 'none' : tool;
      ['pdfToolHighlight','pdfToolDraw','pdfToolRect','pdfToolUnderline','pdfToolNote'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.background = '';
      });
      if (activeTool !== 'none') {
        var map = { highlight: 'pdfToolHighlight', draw: 'pdfToolDraw', rect: 'pdfToolRect', underline: 'pdfToolUnderline', note: 'pdfToolNote' };
        var el = document.getElementById(map[activeTool]);
        if (el) el.style.background = 'var(--primary)';
      }
      pagesContainer.style.cursor = activeTool !== 'none' ? 'crosshair' : '';
    }
    document.getElementById('pdfToolBtn').addEventListener('click', function() {
      var bar = document.getElementById('pdfAnnoBar');
      var isOpen = bar.style.display !== 'none';
      bar.style.display = isOpen ? 'none' : 'flex';
      this.style.background = isOpen ? '' : 'var(--primary)';
      this.style.color = isOpen ? '' : '#fff';
    });
    document.getElementById('pdfToolHighlight').addEventListener('click', function() { setTool('highlight'); });
    document.getElementById('pdfToolDraw').addEventListener('click', function() { setTool('draw'); });
    document.getElementById('pdfToolRect').addEventListener('click', function() { setTool('rect'); });
    document.getElementById('pdfToolUnderline').addEventListener('click', function() { setTool('underline'); });
    document.getElementById('pdfToolNote').addEventListener('click', function() { setTool('note'); });
    document.getElementById('pdfDrawColor').addEventListener('change', function() { drawColor = this.value; });
    document.getElementById('pdfToolEraser').addEventListener('click', function() {
      Object.keys(annotations).forEach(function(k) {
        if (annotations[k].pageNum === currentPage) delete annotations[k];
      });
      Object.keys(notes).forEach(function(k) {
        if (notes[k].pageNum === currentPage) delete notes[k];
      });
      var pageData = pageCanvases[currentPage - 1];
      if (pageData) {
        var overlay = pageData.element.querySelector('[data-overlay="' + currentPage + '"]');
        if (overlay) { var ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height); }
        var marker = pageData.element.querySelector('.pdf-note-marker');
        if (marker) marker.remove();
      }
    });

    var drawingState = null;
    function getTouchPos(e) {
      var pageData = pageCanvases[currentPage - 1];
      if (!pageData) return null;
      var rect = pageData.canvas.getBoundingClientRect();
      var scaleRatio = pageData.canvas.width / rect.width;
      var touch = e.touches[0] || e.changedTouches[0];
      return { x: (touch.clientX - rect.left) * scaleRatio, y: (touch.clientY - rect.top) * scaleRatio, canvas: pageData.canvas, element: pageData.element };
    }
    function getMousePos(e) {
      var pageData = pageCanvases[currentPage - 1];
      if (!pageData) return null;
      var rect = pageData.canvas.getBoundingClientRect();
      var scaleRatio = pageData.canvas.width / rect.width;
      return { x: (e.clientX - rect.left) * scaleRatio, y: (e.clientY - rect.top) * scaleRatio, canvas: pageData.canvas, element: pageData.element };
    }
    async function handleDrawStart(x, y) {
      if (activeTool === 'note') {
        var text = await showPromptDialog({ title: '添加便签', placeholder: '输入便签内容...', defaultValue: '' });
        if (text) {
          var key = 'note_' + Date.now();
          notes[key] = { pageNum: currentPage, x: x, y: y, text: text };
          renderAnnotations();
        }
        return;
      }
      drawingState = { startX: x, startY: y, points: [{ x: x, y: y }] };
    }
    function handleDrawMove(x, y, isTouch) {
      if (!drawingState || activeTool === 'none' || activeTool === 'note') return;
      drawingState.points.push({ x: x, y: y });
      var pageData = pageCanvases[currentPage - 1];
      if (!pageData) return;
      if (activeTool === 'draw' || activeTool === 'underline') {
        var overlay = pageData.element.querySelector('[data-overlay="' + currentPage + '"]');
        if (!overlay) overlay = createPageOverlay(currentPage);
        if (!overlay) return;
        var ctx = overlay.getContext('2d');
        var pts = drawingState.points;
        if (pts.length >= 2) {
          ctx.strokeStyle = drawColor;
          ctx.lineWidth = activeTool === 'underline' ? 3 : 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.stroke();
        }
      } else if (activeTool === 'highlight' || activeTool === 'rect') {
        // Draw temporary preview on a separate canvas — NO renderAnnotations call
        var preview = pageData.element.querySelector('#pdfPrevCanvas');
        if (!preview) {
          preview = document.createElement('canvas');
          preview.id = 'pdfPrevCanvas';
          preview.width = pageData.canvas.width;
          preview.height = pageData.canvas.height;
          preview.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
          pageData.element.appendChild(preview);
        }
        var pctx = preview.getContext('2d');
        pctx.clearRect(0, 0, preview.width, preview.height);
        var sx = drawingState.startX, sy = drawingState.startY;
        var x1 = Math.min(sx, x), y1 = Math.min(sy, y);
        var w = Math.abs(x - sx), h = Math.abs(y - sy);
        if (activeTool === 'highlight') {
          pctx.fillStyle = drawColor + '66';
          pctx.fillRect(x1, y1, w, h);
        } else {
          pctx.strokeStyle = drawColor;
          pctx.lineWidth = 2;
          pctx.strokeRect(x1, y1, w, h);
        }
      }
    }
    function handleDrawEnd(x, y) {
      if (!drawingState || activeTool === 'none' || activeTool === 'note') { drawingState = null; return; }
      // Remove preview canvas if any
      var _pd = pageCanvases[currentPage - 1];
      if (_pd) {
        var _pv = _pd.element.querySelector('#pdfPrevCanvas');
        if (_pv) _pv.remove();
      }
      var key = 'ann_' + Date.now();
      var sx = drawingState.startX, sy = drawingState.startY;
      if (activeTool === 'highlight') {
        annotations[key] = { type: 'highlight', pageNum: currentPage, x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy), color: drawColor };
      } else if (activeTool === 'rect') {
        annotations[key] = { type: 'rect', pageNum: currentPage, x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy), color: drawColor };
      } else if (activeTool === 'underline') {
        annotations[key] = { type: 'underline', pageNum: currentPage, x: Math.min(sx, x), y: y, w: Math.abs(x - sx), h: 0, color: drawColor };
      } else if (activeTool === 'draw') {
        annotations[key] = { type: 'draw', pageNum: currentPage, points: drawingState.points, color: drawColor, width: 2 };
      }
      drawingState = null;
      renderAnnotations();
    }
    // Mouse events
    pagesContainer.addEventListener('mousedown', function(e) {
      if (activeTool === 'none') return;
      var pos = getMousePos(e);
      if (pos) handleDrawStart(pos.x, pos.y);
    });
    pagesContainer.addEventListener('mousemove', function(e) {
      var pos = getMousePos(e);
      if (pos) handleDrawMove(pos.x, pos.y);
    });
    pagesContainer.addEventListener('mouseup', function(e) {
      var pos = getMousePos(e);
      if (pos) handleDrawEnd(pos.x, pos.y);
    });
    // Touch events
    pagesContainer.addEventListener('touchstart', function(e) {
      if (activeTool === 'none') return;
      if (e.touches.length === 1) {
        e.preventDefault();
        // Ensure overlay exists for real-time drawing
        var pageData = pageCanvases[currentPage - 1];
        if (pageData) {
          var existing = pageData.element.querySelector('[data-overlay="' + currentPage + '"]');
          if (!existing) createPageOverlay(currentPage);
        }
        var pos = getTouchPos(e);
        if (pos) handleDrawStart(pos.x, pos.y);
      }
    }, { passive: false });
    pagesContainer.addEventListener('touchmove', function(e) {
      if (drawingState && e.touches.length === 1) {
        e.preventDefault();
        var pos = getTouchPos(e);
        if (pos) handleDrawMove(pos.x, pos.y, true);
      }
    }, { passive: false });
    pagesContainer.addEventListener('touchend', function(e) {
      if (drawingState) {
        var pos = getTouchPos(e);
        if (pos) handleDrawEnd(pos.x, pos.y);
      }
    });

    var pinchState = null;
    var pinchStartScale = currentScale;
    var pinchPending = false;
    wrapper.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartScale = currentScale;
        pinchState = { dist: Math.sqrt(dx * dx + dy * dy) };
      }
    }, { passive: false });
    wrapper.addEventListener('touchmove', function(e) {
      if (e.touches.length === 2 && pinchState) {
        e.preventDefault();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var ratio = dist / pinchState.dist;
        var previewScale = Math.min(Math.max(pinchStartScale * ratio, 0.25), 10);
        var ratioCSS = previewScale / currentScale;
        pagesContainer.style.transform = 'scale(' + ratioCSS + ')';
        pagesContainer.style.transformOrigin = 'top center';
        document.getElementById('pdfZoomLevel').textContent = Math.round(previewScale * 100) + '%';
        pinchPending = previewScale;
      }
    }, { passive: false });
    wrapper.addEventListener('touchend', function(e) {
      if (e.touches.length < 2 && pinchState) {
        pagesContainer.style.transform = '';
        if (pinchPending && Math.abs(pinchPending - currentScale) > 0.01) {
          _scaleManual = true;
          currentScale = pinchPending;
          renderAllPages().then(function() { renderThumbnails(); updatePageInfo(); });
        }
        pinchState = null;
        pinchPending = false;
      }
    });

    // Fit first page to screen width
    var _initFitPage = await pdf.getPage(1);
    var _initFitVp = _initFitPage.getViewport({ scale: 1 });
    currentScale = (scrollContainer.clientWidth - 24) / _initFitVp.width;
    await renderAllPages();
    await renderThumbnails();
    hideLoading();
  } catch (e) {
    console.error('PDF render error:', e);
    hideLoading();
    showToast('PDF 加载失败: ' + e.message);
  }
}

// ===== URL browsing =====
async function browseUrl(prefill) {
  const url = prefill || await showPromptDialog({ title: '输入网址', placeholder: 'https://', defaultValue: 'https://' });
  if (!url || !url.trim()) return;
  let finalUrl = url.trim();
  if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
    finalUrl = 'https://' + finalUrl;
  }
  // Clean up any previous XFO error div (which leaves iframe in DOM with display:none)
  const oldErr = mdContent.querySelector('.xfo-error');
  if (oldErr) oldErr.remove();
  showLoading('正在加载网页...', true);
  state.fileContent = null;
  state.fileName = finalUrl;
  state.fileType = 'html';
  state.fileExt = '';
  titleDisplay.textContent = finalUrl;
  try { localStorage.setItem('reader-last-session', JSON.stringify({ name: finalUrl, type: 'html', ext: '', timestamp: Date.now() })); } catch(e) {}
  showContent();
  const oldUrl = htmlFrame.src;
  htmlFrame.style.display = 'block';
  htmlFrame.className = 'html-frame';
  htmlFrame._searchDoc = null;

  function openInExternalBrowser(url) {
    if (typeof FileAPI !== 'undefined' && FileAPI.platform === 'tauri') {
      if (window.__TAURI__ && window.__TAURI__.shell && window.__TAURI__.shell.open) {
        window.__TAURI__.shell.open(url);
        return;
      }
    }
    window.open(url, '_blank');
  }

  function showXfoError(msg) {
    hideLoading();
    htmlFrame.style.display = 'none';
    mdContent.style.display = 'block';
    const oldErr = mdContent.querySelector('.xfo-error');
    if (oldErr) oldErr.remove();
    const div = document.createElement('div');
    div.className = 'empty-state xfo-error';
    div.style.cssText = 'min-height:auto;padding:40px 0';
    div.innerHTML = `<div class="icon" style="font-size:48px">🌐</div>
      <h2>无法加载此网页</h2>
      <p style="max-width:300px;line-height:1.6;font-size:13px">${escapeHtml(msg || '该网站禁止在框架中显示或拒绝连接')}</p>
      <button onclick="openInExternalBrowser('${escapeHtml(finalUrl)}')" style="margin-top:12px;padding:8px 20px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">🌐 使用浏览器打开</button>
      <br><a href="${escapeHtml(finalUrl)}" target="_blank" style="display:inline-block;margin-top:8px;color:var(--primary);font-size:13px">在新标签页中打开 →</a>`;
    mdContent.appendChild(div);
  }

  // Pre-check connectivity (non-blocking: catch errors silently, let iframe try)
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    await fetch(finalUrl, { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
  } catch(_) {
    /* network pre-check failed — still try iframe */
  }

  // Shared check for browser error pages (Chinese + English)
  function isBlockedPage(bodyText) {
    if (!bodyText) return true;
    const t = bodyText.trim();
    if (t.length < 30) return true;
    return /(cannot be displayed|X-Frame-Options|denied frame|connection.*(refused|reset|close)|refused.*connect|err_connection|err_name_not_resolved|err_timed_out|access denied|blocked|forbidden|403|404|500|502|503|504)/i.test(t) ||
           /(拒绝了|无法访问|无法连接|连接失败|拒绝连接|禁止显示|拒绝显示|找不到服务器|网页无法打开|这个网页无法|打不开|不安全|没有权限|已取消.*连接|超时)/.test(t);
  }

  htmlFrame.onload = () => {
    clearTimeout(loadTimer);
    hideLoading();
    try {
      const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
      const bodyText = (doc.body?.textContent || '').trim();
      if (isBlockedPage(bodyText)) { showXfoError(); return; }
      htmlFrame._searchDoc = doc;
      const meta = doc.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=3.0, minimum-scale=0.25';
      if (doc.head) doc.head.insertBefore(meta, doc.head.firstChild);
      const hs = doc.createElement('style');
      hs.textContent = '*{max-width:100%!important;box-sizing:border-box!important;word-wrap:break-word!important;overflow-wrap:break-word!important}html{overflow-x:hidden!important}body{overflow-x:hidden!important;width:100%!important;margin:0!important;padding:0 8px!important}table{display:block!important;overflow-x:auto!important;max-width:100%!important}pre,code{white-space:pre-wrap!important;word-break:break-all!important}img,video,iframe,embed{max-width:100%!important;height:auto!important}';
      if (doc.head) doc.head.appendChild(hs);
      injectSearchStyles(doc);
      try { doc.defaultView.addEventListener('scroll', updateProgress); } catch(e) {}
    } catch(e) {
      /* cross-origin: loaded successfully but can't inject — scale iframe to fit */
      try {
        const parent = htmlFrame.parentElement;
        if (!parent) return;
        const cw = parent.clientWidth || window.innerWidth;
        if (cw <= 0) return;
        const estW = 1280;
        const s = Math.min(cw / estW, 1);
        htmlFrame._autoScale = s;
        htmlFrame.style.position = 'absolute';
        htmlFrame.style.top = '0';
        htmlFrame.style.left = '0';
        htmlFrame.style.width = estW + 'px';
        htmlFrame.style.height = (window.innerHeight / s) + 'px';
        htmlFrame.style.transformOrigin = 'top left';
        htmlFrame.style.transform = `scale(${s * state.zoomLevel})`;
        htmlFrame.scrolling = 'yes';
        parent.style.position = 'relative';
        parent.style.minHeight = '100vh';
      } catch(se) {}
    }
    reapplyZoom();
    showToast('已加载: ' + finalUrl);
    if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
  };
  htmlFrame.onerror = () => {
    clearTimeout(loadTimer);
    showXfoError();
  };
  // Reset iframe and parent styles from previous URL load
  htmlFrame.style.width = '';
  htmlFrame.style.height = '';
  htmlFrame.style.transform = '';
  htmlFrame.style.transformOrigin = '';
  htmlFrame.style.position = '';
  htmlFrame.style.top = '';
  htmlFrame.style.left = '';
  htmlFrame.scrolling = 'auto';
  if (htmlFrame.parentElement) {
    htmlFrame.parentElement.style.position = '';
    htmlFrame.parentElement.style.overflow = '';
    htmlFrame.parentElement.style.height = '';
    htmlFrame.parentElement.style.minHeight = '';
  }
  let loadTimer = setTimeout(() => {
    try {
      const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
      const bodyText = (doc.body?.textContent || '').trim();
      if (isBlockedPage(bodyText)) { showXfoError(); return; }
    } catch(e) { /* cross-origin page loaded successfully */ }
    hideLoading();
  }, 15000);

  htmlFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  htmlFrame.src = finalUrl;
  showActionStrip(true);

  // Add floating close button for URL browsing
  var closeBtn = document.getElementById('urlCloseBtn');
  if (closeBtn) closeBtn.remove();
  closeBtn = document.createElement('button');
  closeBtn.id = 'urlCloseBtn';
  closeBtn.innerHTML = '✕';
  closeBtn.title = '关闭网页';
  closeBtn.style.cssText = 'position:fixed;top:calc(var(--header-h) + 8px);right:8px;z-index:200;width:36px;height:36px;border:none;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
  closeBtn.onclick = function() {
    htmlFrame.src = '';
    htmlFrame.style.display = 'none';
    mdContent.style.display = 'none';
    emptyState.style.display = 'flex';
    state.fileContent = null;
    state.fileName = '';
    state.fileType = '';
    titleDisplay.textContent = '通用阅读器';
    closeBtn.remove();
    showActionStrip(false);
  };
  document.body.appendChild(closeBtn);
}

async function renderDocx(arrayBuffer) {
  _d('[DOCX] renderDocx called, size=' + (arrayBuffer ? arrayBuffer.byteLength : 0));
  showLoading('正在渲染 Word 文档...', true);

  // First: detect MHT-based docx (exported by this app via html-docx-js)
  try {
    if (typeof JSZip === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    }
    const zip = await JSZip.loadAsync(arrayBuffer);
    var zipFiles = Object.keys(zip.files);
    _d('[DOCX] ZIP files: ' + zipFiles.join(', '));
    var mhtEntry = zip.file('word/afchunk.mht');
    _d('[DOCX] word/afchunk.mht exists=' + !!mhtEntry);
    if (mhtEntry) {
      _d('[DOCX] extracting MHT...');
      const html = await extractHtmlFromDocx(arrayBuffer);
      _d('[DOCX] MHT html length=' + (html ? html.length : 0) + ' snippet=' + (html ? html.substring(0, 200) : 'null'));
      if (html) {
        showContent();
        htmlFrame.style.display = 'block';
        mdContent.style.display = 'none';
        htmlFrame.srcdoc = html;
        showToast(`已打开: ${state.fileName}`);
        return;
      }
      _d('[DOCX] MHT extraction returned null');
    }
  } catch(e) { _d('[DOCX] MHT extraction error: ' + (e.message || e)); }

  // Standard docx — try docx-preview
  try {
    if (typeof docx === 'undefined') {
      _d('[DOCX] loading docx-preview library...');
      // JSZip must be loaded first (docx-preview depends on it)
      if (typeof JSZip === 'undefined') {
        await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
        _d('[DOCX] JSZip loaded, typeof JSZip=' + typeof JSZip);
      }
      await loadScript('https://cdn.jsdelivr.net/npm/docx-preview@0.3.0/dist/docx-preview.min.js');
      if (activeOp.aborted) return;
      _d('[DOCX] docx-preview loaded, typeof docx=' + typeof docx);
    } else {
      _d('[DOCX] docx-preview already loaded');
    }
    showContent();
    mdContent.style.display = 'block';
    mdContent.style.overflowX = 'auto';
    mdContent.style.padding = '0';
    const wrap = document.createElement('div');
    wrap.className = 'docx-preview-wrap';
    wrap.id = 'docx-render';
    mdContent.innerHTML = '';
    mdContent.appendChild(wrap);

    _d('[DOCX] calling docx.renderAsync...');
    await docx.renderAsync(arrayBuffer, wrap, null, {
      className: 'docx-preview',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: true,
      breakPages: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
    });
    if (activeOp.aborted) return;
    _d('[DOCX] renderAsync completed, wrap children=' + wrap.children.length);

    // Verify content was rendered; if empty, treat as failed and fall back to mammoth
    if (typeof docx === 'undefined' || !wrap.querySelector('[class*="docx-"]')) {
      throw new Error('渲染结果为空');
    }

    // Clean up empty paragraphs and excessive whitespace
    wrap.querySelectorAll('p').forEach(p => {
      const txt = p.textContent.replace(/\u00A0/g, ' ').trim();
      if (!txt && !p.querySelector('img, table, ol, ul')) p.classList.add('doc-empty-removed');
    });
    // Collapse consecutive line breaks in rendered text
    wrap.querySelectorAll('p').forEach(p => {
      const m = p.querySelectorAll('br');
      if (m.length > 3) m.forEach((b, i) => { if (i > 0) b.remove(); });
    });
    // Remove empty table cells that only contain &nbsp;
    wrap.querySelectorAll('td, th').forEach(cell => {
      if (cell.innerHTML.replace(/&nbsp;|\u00A0/g, '').trim() === '' && !cell.querySelector('img')) {
        cell.innerHTML = '';
      }
    });

    // Detect and mark black-block images (EMF/WMF rendering failures)
    wrap.querySelectorAll('img').forEach(img => {
      // Check if image failed to load (broken src) or is a data URL with x-emf/x-wmf
      if (img.naturalWidth === 0 && img.naturalHeight === 0 && img.src.startsWith('data:')) {
        img.style.background = 'var(--bg-code)';
        img.style.border = '1px dashed var(--border)';
        img.style.minWidth = '100px';
        img.style.minHeight = '60px';
        img.alt = '[图片格式不支持]';
        _d('[DOCX] black block image detected, src=' + img.src.substring(0, 80));
      }
    });
    // Also handle div-based shapes with black background (common EMF/WMF placeholder)
    wrap.querySelectorAll('div, span').forEach(el => {
      var bg = getComputedStyle(el).backgroundColor;
      if (bg === 'rgb(0, 0, 0)' || bg === '#000000') {
        var w = el.offsetWidth;
        var h = el.offsetHeight;
        if (w > 50 && h > 50 && el.textContent.trim().length === 0) {
          el.style.background = 'var(--bg-code)';
          el.style.border = '1px dashed var(--border)';
          _d('[DOCX] black block shape detected: ' + w + 'x' + h);
        }
      }
    });

    // Force page margins on sections (inline styles from docx-preview override CSS)
    wrap.querySelectorAll('section').forEach(sec => {
      sec.style.padding = '48px 56px';
      sec.style.margin = '12px auto';
      sec.style.maxWidth = '100%';
      sec.style.boxSizing = 'border-box';
      sec.style.position = 'relative';
      sec.style.overflow = 'hidden';
    });
    _d('[DOCX] forced padding on ' + wrap.querySelectorAll('section').length + ' sections');

    buildWordOutline();
    showToast(`已渲染: ${state.fileName}`);
    reapplyZoom();
  } catch (e) {
    if (activeOp.aborted) return;
    _d('[DOCX] renderAsync FAILED: ' + (e.message || e));
    // Try extracting MHT altChunk (from documents exported by this app via html-docx-js)
    try {
      const html = await extractHtmlFromDocx(arrayBuffer);
      if (activeOp.aborted) return;
      if (html) {
        _d('[DOCX] MHT altChunk extracted OK');
        showContent();
        htmlFrame.style.display = 'block';
        mdContent.style.display = 'none';
        htmlFrame.srcdoc = html;
        showToast(`已打开: ${state.fileName}`);
        return;
      }
    } catch (_) {}
    // Fallback to mammoth
    try {
      _d('[DOCX] falling back to mammoth...');
      showLoading('使用简化模式...', true);
      if (typeof mammoth === 'undefined') {
        _d('[DOCX] loading mammoth library...');
        await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js');
        if (activeOp.aborted) return;
        _d('[DOCX] mammoth loaded, typeof mammoth=' + typeof mammoth);
      }
      _d('[DOCX] calling mammoth.convertToHtml...');
      const result = await mammoth.convertToHtml({ arrayBuffer });
      if (activeOp.aborted) return;
      _d('[DOCX] mammoth result length=' + (result.value ? result.value.length : 0));
      showContent();
      mdContent.style.display = 'block';
      if (result.value && result.value.trim()) {
        mdContent.innerHTML = result.value;
        buildWordOutline();
        showToast(`已打开 (简化模式): ${state.fileName}`);
      } else {
        mdContent.innerHTML = `<div class="empty-state" style="min-height:auto;padding:40px 0">
          <div class="icon" style="font-size:40px">⚠️</div>
          <h2>无法读取此 .docx 文件</h2>
          <p style="font-size:13px;color:var(--text-secondary);max-width:400px;margin:8px auto">
          该文档可能是由本应用导出的格式，与 docx-preview 库不完全兼容。<br>
          请尝试用 Office / WPS 打开后另存为新 .docx 文件再导入。</p></div>`;
        showToast('文档格式不兼容，建议另存后重试');
      }
      reapplyZoom();
    } catch (e2) {
      if (activeOp.aborted) return;
      hideLoading();
      mdContent.style.display = 'block';
      mdContent.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h2>解析失败</h2><p>${escapeHtml(e2.message || '无法解析 Word 文档')}</p></div>`;
      showToast('Word 解析失败');
    }
  }
}

// ===== Render .doc (legacy Word binary, or Word HTML exported from this app) =====
async function renderDoc(arrayBuffer) {
  _d('[DOC] renderDoc called, size=' + (arrayBuffer ? arrayBuffer.byteLength : 0));
  try {
    // Check if this is actually Word HTML (exported from this app's "另存为 → Word")
    const header = new TextDecoder('utf-8').decode(arrayBuffer.slice(0, 1024));
    if (header.includes('<html') || header.includes('<!DOCTYPE html>')) {
      _d('[DOC] detected HTML header, rendering as HTML');
      const html = new TextDecoder('utf-8').decode(arrayBuffer);
      showContent();
      htmlFrame.style.display = 'block';
      mdContent.style.display = 'none';
      htmlFrame.srcdoc = html;
      showToast('以 HTML 方式显示 Word 文档');
      return;
    }
  } catch(e) {}

  // Check if it's actually a .docx file (starts with PK ZIP signature)
  const sig = new Uint8Array(arrayBuffer.slice(0, 4));
  if (sig[0] === 0x50 && sig[1] === 0x4B && sig[2] === 0x03 && sig[3] === 0x04) {
    _d('[DOC] detected ZIP signature, treating as .docx');
    // It's a ZIP file — try mammoth.js (docx format)
    try {
      showLoading('正在解析 Word 文档...', true);
      if (typeof mammoth === 'undefined') {
        _d('[DOC] loading mammoth...');
        await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js');
        _d('[DOC] mammoth loaded');
      }
      _d('[DOC] calling mammoth.convertToHtml...');
      const result = await mammoth.convertToHtml({ arrayBuffer });
      _d('[DOC] mammoth result length=' + (result.value ? result.value.length : 0));
      if (result.value && result.value.trim()) {
        showContent();
        mdContent.style.display = 'block';
        mdContent.innerHTML = result.value;
        buildWordOutline();
        showToast(`已打开: ${state.fileName}`);
        reapplyZoom();
        return;
      }
    } catch(e) {}
  }

  // Real binary .doc — try CFB-based extraction
  try {
    _d('[DOC] trying CFB-based .doc extraction...');
    showLoading('正在解析 .doc 文档...', true);
    if (typeof CFB === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/cfb@1.2.2/dist/cfb.min.js');
    }
    const ole = CFB.read(new Uint8Array(arrayBuffer), { type: 'array' });
    var skipStreams = /^(CompObj|SummaryInformation|DocumentSummaryInformation|ObjectPool|[\x00-\x1f])/i;
    var bestText = '';
    if (ole.FileIndex) {
      for (var fi = 0; fi < ole.FileIndex.length; fi++) {
        var entry = ole.FileIndex[fi];
        if (!entry || !entry.content || entry.content.length < 80) continue;
        var name = (ole.FullPaths[fi] || '').replace(/^.*\//, '');
        if (skipStreams.test(name)) continue;
        var data = entry.content;
        // Extract long UTF-16LE text sequences (10+ consecutive printable chars)
        var segments = [];
        var seg = '';
        for (var i = 0; i < data.length - 1; i += 2) {
          var code = data[i] | (data[i + 1] << 8);
          if (code >= 0x20 && code <= 0x7E || code >= 0x4E00 && code <= 0x9FFF || code >= 0x3000 && code <= 0x303F || code >= 0xFF00 && code <= 0xFFEF || code >= 0x00C0 && code <= 0x024F || code === 0x0D || code === 0x0A) {
            seg += String.fromCharCode(code);
          } else {
            if (seg.replace(/[\s\n\r]/g, '').length >= 10) segments.push(seg);
            seg = '';
          }
        }
        if (seg.replace(/[\s\n\r]/g, '').length >= 10) segments.push(seg);
        var txt = segments.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        if (txt.length > 50 && txt.length > bestText.length) {
          bestText = txt;
        }
      }
    }
    if (bestText.length > 30) {
      showContent();
      mdContent.style.display = 'block';
      mdContent.innerHTML = `<div style="padding:16px;background:var(--bg-card);border-radius:var(--radius-sm);white-space:pre-wrap;font-family:var(--font-body);line-height:1.8;">${escapeHtml(bestText)}</div>`;
      buildWordOutline();
      showToast(`已提取文本: ${state.fileName}（格式可能不完整）`);
      reapplyZoom();
      return;
    }
  } catch(e) {
    _d('[DOC] CFB extraction failed: ' + (e.message || e));
  }

  // Fallback: simple binary scan
  try {
    _d('[DOC] trying extractTextFromBinaryDoc fallback...');
    const text = extractTextFromBinaryDoc(arrayBuffer);
    _d('[DOC] extractTextFromBinaryDoc result length=' + (text ? text.length : 0));
    if (text && text.trim().length > 10) {
      showContent();
      mdContent.style.display = 'block';
      mdContent.innerHTML = `<div style="padding:16px;background:var(--bg-card);border-radius:var(--radius-sm);white-space:pre-wrap;font-family:var(--font-body);line-height:1.8;">${escapeHtml(text)}</div>`;
      buildWordOutline();
      showToast(`已提取文本: ${state.fileName}（格式可能不完整）`);
      reapplyZoom();
      return;
    }
  } catch(e) {}

  // All attempts failed
  _d('[DOC] all parsing attempts failed');
  showContent();
  mdContent.style.display = 'block';
  mdContent.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h2>无法解析 .doc 文件</h2><p>该文件可能是加密或特殊格式的 Word 文档。<br>请尝试用 Word / WPS 打开后另存为 <strong>.docx</strong> 格式后再导入。</p></div>`;
  showToast('.doc 格式解析失败');
}

function extractTextFromBinaryDoc(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  var segments = [];
  var seg = '';
  for (var i = 0; i < bytes.length - 1; i += 2) {
    var code = bytes[i] | (bytes[i + 1] << 8);
    if (code >= 0x20 && code <= 0x7E || code >= 0x4E00 && code <= 0x9FFF || code >= 0x3000 && code <= 0x303F || code >= 0xFF00 && code <= 0xFFEF || code >= 0x00C0 && code <= 0x024F || code === 0x0D || code === 0x0A) {
      seg += String.fromCharCode(code);
    } else {
      if (seg.replace(/[\s\n\r]/g, '').length >= 10) segments.push(seg);
      seg = '';
    }
  }
  if (seg.replace(/[\s\n\r]/g, '').length >= 10) segments.push(seg);
  var txt = segments.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return txt.length > 30 ? txt : '';
}

function buildWordOutline() {
  const headings = mdContent.querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (!headings.length) return;
  // Add id to each heading for scroll targeting
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'doc-heading-' + i;
    h.style.cursor = 'pointer';
    // Store depth for outline display
    h.dataset.level = h.tagName[1];
  });
}

async function renderXlsx(arrayBuffer) {
  showLoading('正在解析 Excel 文档...', true);
  try {
    if (typeof XLSX === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      if (activeOp.aborted) return;
    }
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    // Store for cross-sheet search rebuild
    window._xlsxWorkbook = workbook;
    window._xlsxSheetNames = workbook.SheetNames;
    if (activeOp.aborted) return;
    showContent();
    mdContent.style.display = 'block';
    mdContent.style.overflowX = 'auto';

    const sheetNames = workbook.SheetNames;
    const totalSheets = sheetNames.length;
    let html = '';

    // Build tabs first if multiple sheets
    if (totalSheets > 1) {
      html = '<div style="display:flex;flex-wrap:wrap;margin-bottom:12px">';
      sheetNames.forEach((name, idx) => {
        html += `<span class="xlsx-sheet-tab${idx === 0 ? ' active' : ''}" data-idx="${idx}">${escapeHtml(name)}</span>`;
      });
      html += '</div>';
    }

    // Placeholder containers for each sheet
    sheetNames.forEach((name, idx) => {
      const sheet = workbook.Sheets[name];
      const ref = sheet['!ref'];
      let rows = 0;
      if (ref) { try { rows = XLSX.utils.decode_range(ref).e.r + 1; } catch(e) {} }
      const info = rows ? `${rows} 行` : '空';
      html += `<div class="xlsx-sheet" data-sheet="${idx}"${idx > 0 ? ' style="display:none"' : ''}>`;
      html += `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">工作表: ${escapeHtml(name)} (${info})</div>`;
      html += `<div class="xlsx-wrap" id="xlsx-wrap-${idx}" style="overflow-x:auto;-webkit-overflow-scrolling:touch"></div></div>`;
    });

    mdContent.innerHTML = html;
    if (activeOp.aborted) return;

    // Sheet tab switching
    mdContent.querySelectorAll('.xlsx-sheet-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const idx = tab.dataset.idx;
        mdContent.querySelectorAll('.xlsx-sheet-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        mdContent.querySelectorAll('.xlsx-sheet').forEach(s => s.style.display = 'none');
        const target = mdContent.querySelector(`.xlsx-sheet[data-sheet="${idx}"]`);
        if (target) target.style.display = 'block';
        // Reset render flag and start progressive render
        const wrap = document.getElementById(`xlsx-wrap-${idx}`);
        if (wrap) {
          delete wrap.dataset.rendered;
          renderSheetProgressively(idx);
        }
      });
    });

    // Merge-aware rendering for large sheets
    function renderSheetProgressively(sheetIdx) {
      return new Promise((resolve) => {
        if (activeOp.aborted) { resolve(); return; }
        const name = sheetNames[sheetIdx];
        const sheet = workbook.Sheets[name];
        const wrap = document.getElementById(`xlsx-wrap-${sheetIdx}`);
        if (!wrap || wrap.dataset.rendered === '1') { resolve(); return; }

        const ref = sheet['!ref'];
        if (!ref) { wrap.innerHTML = '<p style="color:var(--text-secondary);font-size:13px">空工作表</p>'; wrap.dataset.rendered = '1'; resolve(); return; }

        let range;
        try { range = XLSX.utils.decode_range(ref); } catch(e) { range = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }; }
        const totalRows = range.e.r - range.s.r + 1;
        const totalCols = range.e.c - range.s.c + 1;

        // Read merge info
        const merges = sheet['!merges'] || [];
        const hasMerges = merges.length > 0;
        // Build merge skip map: "r,c" -> true for covered cells
        const mergeSkip = {};
        const mergeAttrs = {}; // "r,c" -> { colspan, rowspan }
        merges.forEach(m => {
          const colspan = m.e.c - m.s.c + 1;
          const rowspan = m.e.r - m.s.r + 1;
          mergeAttrs[m.s.r + ',' + m.s.c] = { colspan, rowspan };
          for (let r = m.s.r; r <= m.e.r; r++)
            for (let c = m.s.c; c <= m.e.c; c++)
              if (r !== m.s.r || c !== m.s.c) mergeSkip[r + ',' + c] = true;
        });

        // Chunked data extraction for large sheets
        state.fileMeta = { ...state.fileMeta, rows: 0, cols: 0 };

        function extractRow(r) {
          const row = [];
          for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = sheet[addr];
            row.push(cell ? String(cell.w ?? cell.v ?? cell.t ?? '') : '');
          }
          return row;
        }

        // Extract header synchronously (always small)
        const headerRow = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
          const cell = sheet[addr];
          headerRow.push(cell ? String(cell.w ?? cell.v ?? cell.t ?? '') : '');
        }
        wrap._xlsxHeader = headerRow;
        wrap._xlsxHasMerges = hasMerges;

        // Extract data in chunks to prevent UI freeze
        const allData = [];
        const TOTAL = range.e.r - range.s.r;
        const CHUNK = 2000;
        if (TOTAL > 200) showLoading(`正在读取数据... 0/${TOTAL} 行`, true);
        let nextRow = range.s.r + 1;
        let cancelled = false;

        let extractSafetyTimer = null;
        if (TOTAL > 200) {
          extractSafetyTimer = setTimeout(() => {
            if (wrap.dataset.rendered === '1') return;
            cancelled = true;
            if (allData.length > 0) finishRender(allData);
            else finishRender([headerRow.map(() => '')]);
          }, 30000);
        }

        function extractChunk() {
          try {
            if (activeOp.aborted) { cancelled = true; return; }
            const end = Math.min(nextRow + CHUNK, range.e.r + 1);
            for (let r = nextRow; r < end; r++) {
              allData.push(extractRow(r));
            }
            nextRow = end;
            const pct = TOTAL > 0 ? Math.round((allData.length / TOTAL) * 100) : 100;
            loadingText.textContent = `正在读取数据... ${allData.length}/${TOTAL} 行 (${pct}%)`;
            if (nextRow <= range.e.r && !cancelled) {
              setTimeout(extractChunk, 0);
            } else if (!cancelled) {
              if (extractSafetyTimer) clearTimeout(extractSafetyTimer);
              finishRender(allData);
            }
          } catch(e) {
            console.error('extractChunk error:', e);
            if (extractSafetyTimer) clearTimeout(extractSafetyTimer);
            cancelled = true;
            if (allData.length > 0) finishRender(allData);
            else finishRender([headerRow.map(() => '')]);
          }
        }

        function finishRender(dataRows) {
          try {
            if (activeOp.aborted) return;
            state.fileMeta = { ...state.fileMeta, rows: dataRows.length, cols: headerRow.length };
            wrap._xlsxData = dataRows;

            const MAX_FULL_TABLE = 2000;
            if ((hasMerges || totalRows <= 200) && totalRows <= MAX_FULL_TABLE) {
            // Full table render with merge support (capped to prevent string overflow)
            // Calculate column widths
            const colWidths = [];
            const SAMPLE_MAX = 1000;
            const sampleStep = dataRows.length > SAMPLE_MAX ? Math.max(1, Math.floor(dataRows.length / SAMPLE_MAX)) : 1;
            for (let c = 0; c < headerRow.length; c++) {
              let maxW = dispLen(headerRow[c]);
              for (let r = 0; r < dataRows.length && maxW < 160; r += sampleStep) {
                const cellLen = dispLen(dataRows[r][c] || '');
                if (cellLen > maxW) maxW = cellLen;
              }
              colWidths.push(Math.max(Math.min(maxW, 160), 1));
            }
            const colPx = colWidths.map(w => Math.max(w * 8 + 24, 60) + 'px');

            const parts = [];
            parts.push('<div class="csv-table-wrap" style="max-height:60vh;overflow:auto"><table style="table-layout:fixed"><colgroup>');
            colPx.forEach(w => { parts.push(`<col style="width:${w}">`); });
            parts.push('</colgroup><thead><tr>');
            for (let c = range.s.c; c <= range.e.c; c++) {
              if (mergeSkip[range.s.r + ',' + c]) continue;
              const attrs = mergeAttrs[range.s.r + ',' + c];
              const text = headerRow[c - range.s.c] || '';
              parts.push(`<th${attrs ? ` colspan="${attrs.colspan}" rowspan="${attrs.rowspan}"` : ''} style="border:1px solid var(--border);padding:6px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--bg-code);font-weight:600;position:sticky;top:0;z-index:1">${escapeHtml(text) || '&nbsp;'}</th>`);
            }
            parts.push('</tr></thead><tbody>');
            for (let r = 0; r < dataRows.length; r++) {
              parts.push('<tr>');
              for (let c = 0; c < headerRow.length; c++) {
                if (mergeSkip[(range.s.r + 1 + r) + ',' + (range.s.c + c)]) continue;
                const attrs = mergeAttrs[(range.s.r + 1 + r) + ',' + (range.s.c + c)];
                const text = dataRows[r][c] || '';
                parts.push(`<td${attrs ? ` colspan="${attrs.colspan}" rowspan="${attrs.rowspan}"` : ''} style="border:1px solid var(--border);padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="xlsx-cell" data-full="${escapeAttr(text)}">${escapeHtml(text) || '&nbsp;'}</td>`);
              }
              parts.push('</tr>');
            }
            parts.push('</tbody></table></div>');
            parts.push(`<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">${dataRows.length} 行 × ${headerRow.length} 列${hasMerges ? ' (含合并单元格)' : ''}</div>`);
            const html = parts.join('');
            hideLoading();
            mdContent.style.display = 'block';
            mdContent.style.overflowX = 'auto';
            wrap.innerHTML = html;
            wrap.dataset.rendered = '1';
            wrap.querySelectorAll('.xlsx-cell').forEach(cell => {
              cell.addEventListener('click', () => { const f = cell.dataset.full || cell.textContent; if (f) showCellContent(f); });
              cell.style.cursor = 'pointer';
            });
            showToast(`${name}: ${dataRows.length} 行 × ${headerRow.length} 列`);
            reapplyZoom();
            resolve();
            return;
          }

          // Virtual scroll (no merges or too large for full-table)
          if (hasMerges) showToast(`${name}: 超过${MAX_FULL_TABLE}行且含合并单元格，合并效果不可见`);
          const ROW_HEIGHT = 36;
          const BUFFER = 5;
          const VIEWPORT_HEIGHT = Math.min(window.innerHeight * 0.6, 600);

          // Column width calculation with sampling for large sheets
          const colWidths = [];
          const SAMPLE_MAX = 1000;
          const sampleStep = dataRows.length > SAMPLE_MAX ? Math.max(1, Math.floor(dataRows.length / SAMPLE_MAX)) : 1;
          for (let c = 0; c < headerRow.length; c++) {
            let maxW = dispLen(headerRow[c]);
            for (let r = 0; r < dataRows.length && maxW < 160; r += sampleStep) {
              const cellLen = dispLen(dataRows[r][c] || '');
              if (cellLen > maxW) maxW = cellLen;
            }
            colWidths.push(Math.max(Math.min(maxW, 160), 1));
          }
          const colPx = colWidths.map(w => Math.max(w * 8 + 24, 60) + 'px');

          hideLoading();
          mdContent.style.display = 'block';
          mdContent.style.overflowX = 'auto';
          wrap.innerHTML = '';
          wrap.style.overflowX = 'auto';

          const scrollArea = document.createElement('div');
          const areaH = VIEWPORT_HEIGHT + ROW_HEIGHT;
          scrollArea.style.cssText = `overflow:auto;height:${areaH}px;position:relative`;
          wrap.appendChild(scrollArea);

          const totalH = (dataRows.length + 1) * ROW_HEIGHT;
          const spacer = document.createElement('div');
          spacer.style.cssText = `height:${totalH}px;position:relative`;
          scrollArea.appendChild(spacer);

          // Header row (flex layout matching data cells exactly)
          const headerDiv = document.createElement('div');
          headerDiv.style.cssText = `position:sticky;top:0;z-index:2;display:flex;background:var(--bg-card)`;
          headerRow.forEach((text, ci) => {
            const cell = document.createElement('div');
            cell.textContent = text || '\u00A0';
            cell.style.cssText = `box-sizing:border-box;border:1px solid var(--border);padding:6px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:${ROW_HEIGHT}px;flex:none;width:${colPx[ci]};background:var(--bg-code);font-weight:600`;
            headerDiv.appendChild(cell);
          });
          spacer.appendChild(headerDiv);

          let visibleRowEls = [];

          function renderVisible() {
            const scrollTop = scrollArea.scrollTop;
            const viewH = scrollArea.clientHeight;
            const startIdx = Math.max(0, Math.floor((scrollTop - ROW_HEIGHT) / ROW_HEIGHT) - BUFFER);
            const endIdx = Math.min(dataRows.length, Math.ceil((scrollTop + viewH - ROW_HEIGHT) / ROW_HEIGHT) + BUFFER);
            visibleRowEls.forEach(el => el.remove());
            visibleRowEls = [];
            for (let i = startIdx; i < endIdx; i++) {
              const rowDiv = document.createElement('div');
              const topPos = (i + 1) * ROW_HEIGHT;
              rowDiv.style.cssText = `position:absolute;top:${topPos}px;left:0;right:0;height:${ROW_HEIGHT}px;display:flex`;
              const row = dataRows[i];
              for (let c = 0; c < headerRow.length; c++) {
                const cell = document.createElement('div');
                const txt = row[c] || '';
                cell.textContent = txt || '\u00A0';
                cell.dataset.full = txt;
                cell.style.cssText = `box-sizing:border-box;border:1px solid var(--border);padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;height:${ROW_HEIGHT}px;flex:none;width:${colPx[c]};cursor:pointer`;
                cell.addEventListener('click', () => { if (cell.dataset.full) showCellContent(cell.dataset.full); });
                rowDiv.appendChild(cell);
              }
              spacer.appendChild(rowDiv);
              visibleRowEls.push(rowDiv);
            }
          }

          scrollArea.addEventListener('scroll', () => { renderVisible(); updateProgress(); });
          renderVisible();
          wrap.dataset.rendered = '1';
          showToast(`${name}: ${dataRows.length} 行 × ${headerRow.length} 列 (虚拟滚动)`);
          reapplyZoom();
          resolve();
          } catch(e) {
            console.error('finishRender error:', e);
            hideLoading();
            mdContent.style.display = 'block';
            mdContent.style.overflowX = 'auto';
            if (wrap) {
              wrap.innerHTML = `<div style="padding:20px;color:var(--text-secondary);font-size:13px">渲染时发生错误: ${escapeHtml(e.message || '未知错误')}</div>`;
              wrap.dataset.rendered = '1';
            }
            reapplyZoom();
            resolve();
          }
        }

        // Start chunked extraction
        extractChunk();
      });
    }

    // Start rendering first visible sheet
    const firstSheet = document.querySelector('.xlsx-sheet:not([style*="display:none"])') || document.querySelector('.xlsx-sheet');
    if (firstSheet) {
      const idx = firstSheet.dataset.sheet;
      if (idx !== undefined) renderSheetProgressively(parseInt(idx));
    }

  } catch (e) {
    hideLoading();
    mdContent.style.display = 'block';
    mdContent.innerHTML = `<div class="empty-state" style="min-height:auto;padding:40px 0">
      <div class="icon" style="font-size:48px">⚠️</div>
      <h2>解析失败</h2><p style="max-width:300px;line-height:1.6;font-size:13px">${escapeHtml(e.message || '无法解析 Excel 文档')}</p></div>`;
    showToast('Excel 解析失败');
    reapplyZoom();
  }
}

// ===== Render PPTX =====
async function renderPptx(arrayBuffer) {
  showLoading('正在解析 PPT 文档...', true);
  var mySeq = ++_opSeq;
  activeOp.seq = mySeq;
  activeOp.aborted = false;
  try {
    if (typeof JSZip === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
      if (activeOp.aborted || activeOp.seq !== mySeq) { hideLoading(); return; }
    }
    mdContent.style.display = 'block';
    mdContent.style.overflowX = 'auto';

    if (arrayBuffer && arrayBuffer.byteLength >= 8) {
      var magic = new Uint8Array(arrayBuffer, 0, 8);
      var isOle2 = magic[0]===0xD0 && magic[1]===0xCF && magic[2]===0x11 && magic[3]===0xE0 && magic[4]===0xA1 && magic[5]===0xB1 && magic[6]===0x1A && magic[7]===0xE1;
      if (isOle2) {
        hideLoading();
        mdContent.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h2>不支持旧版 PPT 格式</h2><p>此文件为旧版 .ppt 格式 (Office 97-2003)。<br>当前仅支持 .pptx 格式 (Office 2007+)。<br>请使用 PowerPoint、WPS 或 LibreOffice 另存为 .pptx 后再试。</p></div>';
        showToast('不支持旧版 .ppt 格式');
        reapplyZoom();
        return;
      }
    }

    const zip = await JSZip.loadAsync(arrayBuffer);
    if (activeOp.aborted || activeOp.seq !== mySeq) { hideLoading(); return; }
    const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort();
    if (!slideFiles.length) throw new Error('未找到幻灯片');

    let html = '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">共 ' + slideFiles.length + ' 张幻灯片 (文本模式)</div>';
    const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

    for (let i = 0; i < slideFiles.length; i++) {
      if (activeOp.aborted || activeOp.seq !== mySeq) break;
      if (i > 0) { await new Promise(r => setTimeout(r, 0)); if (activeOp.aborted || activeOp.seq !== mySeq) break; }
      const xmlText = await zip.files[slideFiles[i]].async('text');
      const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
      const spTree = xml.getElementsByTagNameNS(NS_P, 'spTree')[0];
      if (!spTree) continue;
      const shapes = spTree.getElementsByTagNameNS(NS_P, 'sp');
      const texts = [];
      for (let s = 0; s < shapes.length; s++) {
        const txBody = shapes[s].getElementsByTagNameNS(NS_P, 'txBody')[0];
        if (!txBody) continue;
        const paras = txBody.getElementsByTagNameNS(NS_A, 'p');
        for (let p = 0; p < paras.length; p++) {
          const runs = paras[p].getElementsByTagNameNS(NS_A, 'r');
          let t = '';
          for (let r = 0; r < runs.length; r++) {
            const tn = runs[r].getElementsByTagNameNS(NS_A, 't')[0];
            if (tn) t += tn.textContent;
          }
          if (t.trim()) texts.push(escapeHtml(t.trim()));
        }
      }
      html += '<div class="ppt-slide"><div class="ppt-slide-num">幻灯片 ' + (i + 1) + '</div><div class="ppt-slide-content">';
      texts.forEach(t => { html += t.length < 50 ? '<p class="ppt-title">' + t + '</p>' : '<p>' + t + '</p>'; });
      html += '</div></div>';
    }

    if (activeOp.aborted || activeOp.seq !== mySeq) { hideLoading(); return; }
    mdContent.innerHTML = html;
    showContent();
    hideLoading();
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom:16px;padding:12px;background:var(--bg);border:1px solid var(--accent);border-radius:8px';
    var fullBtn = document.createElement('button');
    fullBtn.textContent = '完整渲染';
    fullBtn.style.cssText = 'width:100%;padding:10px 20px;border:none;border-radius:6px;background:var(--accent);color:#fff;cursor:pointer;font-size:15px;font-weight:600';
    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:6px;text-align:center';
    desc.textContent = '包含图片、表格等完整内容';
    wrapper.appendChild(fullBtn);
    wrapper.appendChild(desc);
    mdContent.insertBefore(wrapper, mdContent.firstChild);
    showToast('已打开 (文本模式): ' + state.fileName);
    reapplyZoom();

    fullBtn.addEventListener('click', function() {
      fullBtn.disabled = true; fullBtn.textContent = '渲染中...'; fullBtn.style.opacity = '0.6';
      renderPptxFull(arrayBuffer).catch(function(e) {
        hideLoading(); mdContent.style.display = 'block'; if (fullBtn) { fullBtn.disabled = false; fullBtn.textContent = '完整渲染'; fullBtn.style.opacity = '1'; } _d('renderPptxFull error: ' + (e && e.message || e));
      });
      _d('fullRenderBtn clicked, renderPptxFull started');
    });
  } catch (e) {
    hideLoading();
    mdContent.style.display = 'block';
    mdContent.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h2>解析失败</h2><p>' + escapeHtml(e.message || '无法解析 PPT 文档') + '</p></div>';
    showToast('PPT 解析失败');
    reapplyZoom();
  }
}

// ===== Full PPT render (Canvas-based, on demand) =====
async function renderPptxFull(arrayBuffer) {
  showLoading('正在准备完整渲染...', true);
  var mySeq = ++_opSeq;
  activeOp.seq = mySeq;
  activeOp.aborted = false;
  var pptTimeout = setTimeout(function() {
    try { activeOp.aborted = true; hideLoading(); showToast('渲染超时'); mdContent.style.display = 'block'; mdContent.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h2>渲染超时</h2><p>幻灯片文件过大或格式复杂，请重试或使用其他工具查看</p></div>'; } catch(e) {}
  }, 60000);
  try {
    if (typeof Chart === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js');
      if (activeOp.aborted || activeOp.seq !== mySeq) { hideLoading(); return; }
    }
    if (typeof JSZip === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
      if (activeOp.aborted || activeOp.seq !== mySeq) { hideLoading(); return; }
    }
    if (typeof PptxViewJS === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/pptxviewjs@1.1.9/dist/PptxViewJS.min.js');
      if (activeOp.aborted || activeOp.seq !== mySeq) { hideLoading(); return; }
    }
    mdContent.style.display = 'block';
    mdContent.style.overflowX = 'auto';

    var canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
    try {
      var viewer = new PptxViewJS.PPTXViewer({ canvas: canvas, autoRenderFirstSlide: false });
      await viewer.loadFile(arrayBuffer.slice(0));
      var total = viewer.getSlideCount();
      var html = '<div style="margin-bottom:16px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px"><button id="textModeBtn" style="width:100%;padding:10px 20px;border:none;border-radius:6px;background:var(--bg-card);color:var(--text);cursor:pointer;font-size:15px;font-weight:600;border:1px solid var(--border)">文本模式</button><div style="font-size:12px;color:var(--text-secondary);margin-top:6px;text-align:center">仅显示文字内容，速度更快</div></div><div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">共 ' + total + ' 张幻灯片</div>';
      for (var i = 0; i < total; i++) {
        if (activeOp.aborted || activeOp.seq !== mySeq) break;
        if (i > 0) { showLoading('正在渲染第 ' + (i + 1) + '/' + total + ' 张幻灯片...', true); await new Promise(function(r) { setTimeout(r, 0); }); if (activeOp.aborted || activeOp.seq !== mySeq) break; }
        await viewer.render(canvas, { slideIndex: i });
        html += '<div class="ppt-slide"><div class="ppt-slide-num">幻灯片 ' + (i + 1) + '</div><div class="ppt-slide-content" style="text-align:center;padding:0"><img src="' + canvas.toDataURL('image/png') + '" style="max-width:100%;height:auto;display:block;border:1px solid var(--border);border-radius:4px;margin:0 auto" alt="Slide ' + (i + 1) + '"></div></div>';
      }
      if (!activeOp.aborted && activeOp.seq === mySeq) {
        showContent();
        mdContent.style.display = 'block';
        mdContent.innerHTML = html;
        var textBtn = document.getElementById('textModeBtn');
        if (textBtn) textBtn.onclick = function() { renderPptx(arrayBuffer); };
        showToast('已渲染: ' + state.fileName);
        reapplyZoom();
      }
    } finally {
      if (canvas.parentNode) document.body.removeChild(canvas);
    }
  } finally {
    clearTimeout(pptTimeout);
  }
}

// ===== Render CSV =====
function renderCsv(text) {
  showContent();
  mdContent.style.display = 'block';
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) { mdContent.innerHTML = '<div class="empty-state"><h2>空文件</h2></div>'; return; }

  function parseCsvLine(line) {
    const result = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (i + 1 < line.length && line[i+1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { result.push(cur); cur = ''; }
        else cur += c;
      }
    }
    result.push(cur);
    return result;
  }

  const rows = lines.map(parseCsvLine);
  const header = rows[0];

  let table = `<div class="csv-table-wrap"><table><thead><tr>`;
  header.forEach(h => { table += `<th>${escapeHtml(h)}</th>`; });
  table += `</tr></thead><tbody>`;
  for (let i = 1; i < rows.length; i++) {
    table += `<tr>`;
    rows[i].forEach(c => { table += `<td>${escapeHtml(c) || '&nbsp;'}</td>`; });
    table += `</tr>`;
  }
  table += `</tbody></table></div>`;
  table += `<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">共 ${rows.length} 行, ${header.length} 列</div>`;
  mdContent.innerHTML = table;
  reapplyZoom();
}

// ===== Render code/text file =====
const FILE_ICONS = {
  js:'🟨', ts:'🔵', jsx:'⚛️', tsx:'⚛️', py:'🐍', rb:'💎', php:'🐘',
  sh:'⬛', bash:'⬛', css:'🎨', scss:'🎨', less:'🎨', java:'☕', go:'🔷',
  rs:'🦀', swift:'🐦', kt:'📱', dart:'🎯', lua:'🌙', r:'📊', pl:'🐪',
  sql:'🗃️', vue:'💚', svelte:'🧡', astro:'🌌', c:'⚙️', cpp:'⚙️', h:'📋',
  json:'📋', xml:'📄', yaml:'📄', yml:'📄', ini:'⚙️', toml:'⚙️',
  env:'🔒', log:'📝', tex:'📐', rst:'📄', bat:'🪟', ps1:'🪟', gradle:'📦',
  dockerfile:'🐳', gitignore:'📄', editorconfig:'📄',
};

function renderCode(text, ext, fileName) {
  showContent();
  mdContent.style.display = 'block';
  const icon = FILE_ICONS[ext] || '📄';
  const lang = ext.toUpperCase();
  // Format JSON for readability
  let display = text;
  if (ext === 'json') {
    try { display = JSON.stringify(JSON.parse(text), null, 2); } catch(e) {}
  }
  const html = `<div class="code-header">
    <span class="file-icon">${icon}</span>
    <span class="file-name">${escapeHtml(fileName)}</span>
    <span class="lang-badge">${escapeHtml(lang)}</span>
  </div>
  <pre class="code-body"><code>${escapeHtml(display)}</code></pre>`;
  mdContent.innerHTML = html;
  reapplyZoom();
}

// ===== Image Viewer =====
function getMimeForExt(ext) {
  const map = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
    webp:'image/webp', bmp:'image/bmp', svg:'image/svg+xml', ico:'image/x-icon',
    heic:'image/heic', heif:'image/heif', avif:'image/avif', tiff:'image/tiff', tif:'image/tiff' };
  return map[ext] || 'image/png';
}
async function buildImageList(fd) {
  _d('buildImageList: fd=' + !!fd + ' importedFiles=' + state.importedFiles.length + ' fileName=' + state.fileName);
  const list = [];
  state.importedFiles.forEach(f => {
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
    if (IMAGE_EXTS.has(ext) && !list.some(e => e.name === f.name)) {
      list.push({ name: f.name, ext, content: f.content, path: f.fullPath, loaded: !!f.content });
      _d('buildImageList: added from importedFiles: ' + f.name + ' loaded=' + !!f.content);
    }
  });
  if (fd) {
    const fp = fd._path || fd.path;
    _d('buildImageList: fd._path=' + (fp || '(empty)'));
    if (fp) {
      const sep = fp.includes('/') ? '/' : '\\';
      const dir = fp.replace(/[/\\][^/\\]+$/, '');
      _d('buildImageList: scanning dir=' + dir);
      try {
        const entries = await FileAPI.listDir(dir);
        _d('buildImageList: dir entries=' + (entries ? entries.length : 0));
        if (entries && entries.length) {
          entries.forEach(e => {
            const eext = e.includes('.') ? e.split('.').pop().toLowerCase() : '';
            if (IMAGE_EXTS.has(eext) && !list.some(x => x.name === e)) {
              list.push({ name: e, ext: eext, content: null, path: dir + sep + e, loaded: false });
              _d('buildImageList: added from dir: ' + e);
            }
          });
        }
      } catch(e) {
        _d('buildImageList: listDir ERROR: ' + (e.message || e));
      }
    }
  } else {
    _d('buildImageList: fd is null, skipping dir scan');
  }
  if (!list.some(f => f.name === state.fileName)) {
    _d('buildImageList: current file not in list, adding it');
    list.push({ name: state.fileName, ext: state.fileExt, content: state.fileContent, path: '', loaded: true });
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  state.imageFiles = list;
  state.imageIndex = list.findIndex(f => f.name === state.fileName);
  if (state.imageIndex < 0) state.imageIndex = 0;
  _d('buildImageList: final list=' + state.imageFiles.length + ' idx=' + state.imageIndex + ' hasNav=' + (state.imageFiles.length > 1));
}
function renderImg(buf, ext, fileName) {
  showContent();
  mdContent.style.display = 'block';
  if (Array.isArray(buf)) buf = new Uint8Array(buf).buffer;
  const blob = new Blob([buf], { type: getMimeForExt(ext) });
  const dataUrl = URL.createObjectURL(blob);
  if (state._currentImgDataUrl) URL.revokeObjectURL(state._currentImgDataUrl);
  state._currentImgDataUrl = dataUrl;
  const hasNav = state.imageFiles.length > 1;
  const idx = state.imageIndex;
  const total = state.imageFiles.length;
  let html = '<div class="img-viewer">';
  if (hasNav) {
    html += '<div class="img-nav"><button class="img-nav-btn" id="imgPrev"' + (idx === 0 ? ' disabled' : '') + '>◀</button><span class="img-counter" id="imgCounter">' + (idx+1) + ' / ' + total + '</span><button class="img-nav-btn" id="imgNext"' + (idx === total-1 ? ' disabled' : '') + '>▶</button></div>';
  }
  html += '<div class="img-display">';
  if (hasNav) {
    html += '<div class="img-nav-overlay img-nav-overlay-left" id="imgOverlayLeft"><span class="nav-arrow">◀</span></div>';
    html += '<div class="img-nav-overlay img-nav-overlay-right" id="imgOverlayRight"><span class="nav-arrow">▶</span></div>';
  }
  html += '<img src="' + dataUrl + '" alt="' + escapeHtml(fileName) + '" class="img-preview" id="imgPreview"></div><div class="img-convert-toolbar"><span class="img-convert-label">转换为:</span><button class="img-convert-btn" data-fmt="png">PNG</button><button class="img-convert-btn" data-fmt="jpeg">JPG</button><button class="img-convert-btn" data-fmt="webp">WEBP</button><button class="img-convert-btn" data-fmt="gif">GIF</button><button class="img-convert-btn" data-fmt="bmp">BMP</button></div></div>';
  mdContent.innerHTML = html;
  if (hasNav) {
    $('imgPrev').addEventListener('click', () => navigateImage(-1));
    $('imgNext').addEventListener('click', () => navigateImage(1));
    $('imgOverlayLeft').addEventListener('click', () => navigateImage(-1));
    $('imgOverlayRight').addEventListener('click', () => navigateImage(1));
  }
  document.querySelectorAll('.img-convert-btn').forEach(btn => {
    btn.addEventListener('click', () => convertImage(btn.dataset.fmt));
  });
  reapplyZoom();
}
function navigateImage(dir) {
  const newIdx = state.imageIndex + dir;
  if (newIdx < 0 || newIdx >= state.imageFiles.length) return;
  if (state._currentImgDataUrl) { URL.revokeObjectURL(state._currentImgDataUrl); state._currentImgDataUrl = ''; }
  state.imageIndex = newIdx;
  const f = state.imageFiles[newIdx];
  state.fileName = f.name;
  state.fileExt = f.ext;
  titleDisplay.textContent = f.name;
  try { localStorage.setItem('reader-last-session', JSON.stringify({ name: f.name, type: 'img', ext: f.ext, timestamp: Date.now() })); } catch(e) {}
  // Always check importedFiles for latest content (handles re-load and lazy load)
  var imported = state.importedFiles.find(function(x) { return x.name === f.name; });
  if (imported && imported.content) {
    f.content = imported.content; f.loaded = true;
    state.fileContent = imported.content;
    showImgPreview(imported.content, f.ext, f.name);
  } else if (f.loaded && f.content) {
    state.fileContent = f.content;
    showImgPreview(f.content, f.ext, f.name);
  } else if (imported && imported._fileRef) {
    showLoading('加载 ' + f.name + '...');
    readFileBlob(imported._fileRef, true).then(function(buf) {
      if (!buf || buf.byteLength === 0) { hideLoading(); showToast('无法加载: ' + f.name); return; }
      imported.content = buf;
      f.content = buf; f.loaded = true;
      state.fileContent = buf;
      hideLoading();
      showImgPreview(buf, f.ext, f.name);
    }).catch(function() { hideLoading(); showToast('加载失败: ' + f.name); });
  } else if (f.path) {
    showLoading('加载 ' + f.name + '...');
    FileAPI.readAsArrayBuffer({ _path: f.path, name: f.name }).then(buf => {
      if (!buf || buf.byteLength === 0) { hideLoading(); showToast('无法加载: ' + f.name); return; }
      f.content = buf; f.loaded = true;
      state.fileContent = buf;
      hideLoading();
      showImgPreview(buf, f.ext, f.name);
    }).catch(() => { hideLoading(); showToast('加载失败: ' + f.name); });
  } else {
    showToast('无法加载: ' + f.name);
  }
}
function navigateDoc(dir) {
  activeOp.aborted = true;
  var idx = state.importedFiles.findIndex(function(f) { return f.fullPath === state._currentImportPath || f.name === state.fileName; });
  if (idx < 0) idx = state.importedFiles.findIndex(function(f) { return f.name === state.fileName; });
  if (idx < 0) return;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.importedFiles.length) return;
  var f = state.importedFiles[newIdx];
  // Lazy load: read content if not loaded
  if ((f.content === null || f.content === undefined) && f._fileRef) {
    showLoading('正在加载 ' + f.name + '...');
    var binary = isBinaryType(f.type);
    readFileBlob(f._fileRef, binary).then(function(content) {
      f.content = content;
      hideLoading();
      navigateDoc(dir);
    }).catch(function(e) {
      hideLoading();
      showToast('读取文件失败: ' + (e.message || e));
    });
    return;
  }
  if (!f.content && f.content !== '') { showToast('文件内容为空: ' + f.name); return; }
  state._currentImportPath = f.fullPath;
  // Close PDF viewer if open
  var _pw = document.getElementById('pdfViewerWrapper');
  if (_pw) _pw.remove();
  state.fileContent = f.content;
  state.fileName = f.name;
  state.fileType = f.type || detectFileType(f.name);
  state.fileExt = getFileExt(f.name);
  titleDisplay.textContent = f.name;
  showActionStrip(true);
  try { localStorage.setItem('reader-last-session', JSON.stringify({ name: f.name, type: state.fileType, ext: state.fileExt, timestamp: Date.now() })); } catch(e) {}
  if (state.fileType === 'img') { buildImageList(null).then(renderContent); }
  else renderContent();
  // For PDF in multi-file mode, keep action strip visible for navigation
  if (state.fileType === 'pdf' && state.importedFiles.length > 1) { showActionStrip(true); }
  // Save content to IndexedDB for session restore on next app launch
  if (state.fileContent) {
    dbPut('files', { name: f.name, content: state.fileContent, type: state.fileType, updatedAt: Date.now() }).catch(() => {});
  }
  updateDocNav();
}

function updateDocNav() {
  var idx = state.importedFiles.findIndex(function(f) { return f.fullPath === state._currentImportPath || f.name === state.fileName; });
  if (idx < 0) idx = state.importedFiles.findIndex(function(f) { return f.name === state.fileName; });
  var hasNav = state.importedFiles.length > 1 && idx >= 0;
  var prevEl = document.getElementById('actPrev');
  var nextEl = document.getElementById('actNext');
  var ctrEl = document.getElementById('docCounter');
  if (prevEl) { prevEl.style.display = hasNav ? '' : 'none'; prevEl.disabled = idx <= 0; }
  if (nextEl) { nextEl.style.display = hasNav ? '' : 'none'; nextEl.disabled = idx >= state.importedFiles.length - 1; }
  if (ctrEl) { ctrEl.style.display = hasNav ? '' : 'none'; ctrEl.textContent = hasNav ? (idx + 1) + '/' + state.importedFiles.length : ''; }
}

function showImgPreview(buf, ext, fileName) {
  if (Array.isArray(buf)) buf = new Uint8Array(buf).buffer;
  const blob = new Blob([buf], { type: getMimeForExt(ext) });
  const dataUrl = URL.createObjectURL(blob);
  if (state._currentImgDataUrl) URL.revokeObjectURL(state._currentImgDataUrl);
  state._currentImgDataUrl = dataUrl;
  const img = document.getElementById('imgPreview');
  if (img) {
    img.src = dataUrl;
    img.alt = fileName;
    const prev = document.getElementById('imgPrev');
    const next = document.getElementById('imgNext');
    const ctr = document.getElementById('imgCounter');
    if (prev) prev.disabled = state.imageIndex === 0;
    if (next) next.disabled = state.imageIndex === state.imageFiles.length - 1;
    if (ctr) ctr.textContent = (state.imageIndex+1) + ' / ' + state.imageFiles.length;
  }
}
async function convertImage(fmt) {
  const img = document.getElementById('imgPreview');
  if (!img || !img.complete) { showToast('图片尚未加载完成'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const mimeMap = { png:'image/png', jpeg:'image/jpeg', webp:'image/webp', bmp:'image/bmp', gif:'image/gif' };
  const mime = mimeMap[fmt] || 'image/png';
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;
  canvas.toBlob(blob => {
    if (!blob) { showToast('转换失败'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileName.replace(/\.[^.]+$/, '') + '.' + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    showToast('已转换为 ' + fmt.toUpperCase());
  }, mime);
}

// ===== Markdown Enhancement: KaTeX, Highlight.js, Mermaid, TOC =====
let _enhancedCSS = {};

function loadCSS(href) {
  href = _localUrl(href);
  if (_enhancedCSS[href]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => { _enhancedCSS[href] = true; resolve(); };
    link.onerror = reject;
    document.head.appendChild(link);
  });
}

function loadHighlightTheme() {
  const theme = getEffectiveTheme();
  const href = theme === 'dark' ? 'lib/highlight-github-dark.min.css' : 'lib/highlight-github.min.css';
  document.querySelectorAll('link[data-hljs]').forEach(el => el.remove());
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.hljs = '1';
  document.head.appendChild(link);
}

async function ensureKaTeX() {
  if (typeof katex === 'undefined') {
    await loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js');
    await loadCSS('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css');
  }
}

async function ensureHighlightJS() {
  if (typeof hljs === 'undefined') {
    await loadScript('https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js');
  }
  loadHighlightTheme();
}

async function ensureMermaid() {
  if (typeof mermaid === 'undefined') {
    await loadScript('https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js');
    await new Promise(r => setTimeout(r, 100));
  }
  try {
    mermaid.initialize({ startOnLoad: false, theme: getEffectiveTheme() === 'dark' ? 'dark' : 'default', securityLevel: 'loose' });
  } catch(e) {}
}

function buildMdOutline() {
  const headings = mdContent.querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (!headings.length) return;
  headings.forEach((h, i) => {
    if (!h.id) h.id = 'md-heading-' + i;
    h.dataset.level = h.tagName[1];
    h.style.cursor = 'pointer';
  });
}

async function enhanceMdContent() {
  if (state.fileType !== 'md') return;
  await new Promise(r => setTimeout(r, 0));
  try { await renderMathFromDataTex(); } catch(e) {}
  try { await enhanceDisplayMath(); } catch(e) {}
  try { await enhanceInlineMath(); } catch(e) {}
  await new Promise(r => setTimeout(r, 0));
  try { await enhanceSyntaxHighlighting(); } catch(e) {}
  try { await enhanceMermaid(); } catch(e) {}
}

// Render KaTeX from data-tex attributes (created by parseInline)
async function renderMathFromDataTex() {
  await ensureKaTeX();
  // Display math
  var dispEls = mdContent.querySelectorAll('div.katex-display[data-tex]');
  for (var i = 0; i < dispEls.length; i++) {
    try {
      var el = dispEls[i];
      var tex = el.getAttribute('data-tex');
      el.innerHTML = katex.renderToString(tex, { displayMode: true, throwOnError: false });
      el.setAttribute('data-tex', tex);
    } catch(e) {}
    if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }
  // Inline math
  var inlEls = mdContent.querySelectorAll('span.katex-inline[data-tex]');
  for (var j = 0; j < inlEls.length; j++) {
    try {
      var el = inlEls[j];
      var tex = el.getAttribute('data-tex');
      el.innerHTML = katex.renderToString(tex, { displayMode: false, throwOnError: false });
      el.setAttribute('data-tex', tex);
    } catch(e) {}
    if (j % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }
}

async function enhanceDisplayMath() {
  await ensureKaTeX();
  const children = Array.from(mdContent.children);
  // Single-line $$expr$$
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el.tagName === 'P') {
      const m = el.textContent.trim().match(/^\$\$(.+)\$\$$/);
      if (m) {
        const math = m[1].trim();
        if (math) { try { el.innerHTML = katex.renderToString(math, { displayMode: true, throwOnError: false }); el.setAttribute('data-tex', math); } catch(e) {} }
      }
    }
  }
  // Multi-line $$...$$
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (el.tagName === 'P' && el.textContent.trim() === '$$') {
      const parts = [];
      let j = i + 1;
      while (j < children.length) {
        const next = children[j];
        if (next.tagName === 'P' && next.textContent.trim() === '$$') {
          const math = parts.join('\n').trim();
          if (math) {
            try {
              const html = katex.renderToString(math, { displayMode: true, throwOnError: false });
              const div = document.createElement('div');
              div.innerHTML = html;
              div.setAttribute('data-tex', math);
              el.replaceWith(div);
              next.remove();
              for (let k = i + 1; k < j; k++) children[k] && children[k].remove();
            } catch(e) { i = j; break; }
          }
          i = j;
          break;
        }
        parts.push(next.textContent);
        j++;
      }
    }
  }
}

async function enhanceInlineMath() {
  await ensureKaTeX();
  const walker = document.createTreeWalker(mdContent, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_ACCEPT;
      const t = p.tagName;
      if (t === 'CODE' || t === 'PRE' || t === 'SCRIPT' || t === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  }, false);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(node => {
    const text = node.textContent;
    const regex = /\$(?!\$)([^$]+?)\$(?!\$)/g;
    let match;
    const parts = [];
    let last = 0;
    let found = false;
    while ((match = regex.exec(text)) !== null) {
      const expr = match[1].trim();
      if (!expr || !/[a-zA-Z\\]/.test(expr)) continue;
      found = true;
      parts.push(text.slice(last, match.index));
      try {
        parts.push('<span data-tex="' + escapeHtml(expr) + '">' + katex.renderToString(expr, { displayMode: false, throwOnError: false }) + '</span>');
      } catch(e) { parts.push('$' + expr + '$'); }
      last = match.index + match[0].length;
    }
    if (found) {
      parts.push(text.slice(last));
      const span = document.createElement('span');
      span.innerHTML = parts.join('');
      node.parentNode.replaceChild(span, node);
    }
  });
}

async function enhanceSyntaxHighlighting() {
  await ensureHighlightJS();
  mdContent.querySelectorAll('pre code[class*="language-"]').forEach(block => {
    if (block.classList.contains('language-mermaid')) return;
    hljs.highlightElement(block);
  });
  mdContent.querySelectorAll('pre code:not([class*="language-"])').forEach(block => {
    if (block.textContent.trim().length > 20) hljs.highlightElement(block);
  });
}

async function enhanceMermaid() {
  try {
    await ensureMermaid();
    const blocks = mdContent.querySelectorAll('pre code.language-mermaid');
    if (!blocks.length) return;
    blocks.forEach(block => {
      const pre = block.parentNode;
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = block.textContent;
      pre.replaceWith(div);
    });
    await new Promise(r => setTimeout(r, 50));
    const mermaidNodes = mdContent.querySelectorAll('.mermaid');
    if (mermaidNodes.length) {
      await mermaid.run({ nodes: Array.from(mermaidNodes), suppressErrors: true });
    }
  } catch(e) {
    mdContent.querySelectorAll('.mermaid').forEach(el => {
      const pre = document.createElement('pre');
      pre.textContent = el.textContent;
      el.replaceWith(pre);
    });
  }
}

// Hook theme change into highlight & mermaid
const origSetTheme = setTheme;
setTheme = function(t) {
  origSetTheme(t);
  if (state.fileType === 'md' && mdContent.style.display !== 'none') {
    loadHighlightTheme();
    try { mermaid.initialize({ theme: getEffectiveTheme() === 'dark' ? 'dark' : 'default' }); } catch(e) {}
  }
};

// ===== Text Statistics =====
function computeStats(text) {
  if (!text) return null;
  return {
    totalChars: text.length,
    charsNoSpace: text.replace(/\s/g, '').length,
    chinese: (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length,
    english: (text.match(/[a-zA-Z]/g) || []).length,
    digits: (text.match(/[0-9]/g) || []).length,
    spaces: (text.match(/\s/g) || []).length,
    punctuation: (text.match(/[.,!?;:，。！？；：、""''（）《》【】「」『』—…·\-\/\\@#$%^&*()_+={}\[\]|<>~`]/g) || []).length,
    lines: text.split(/\r?\n/).length,
    paras: text.split(/\r?\n\s*\r?\n/).filter(p => p.trim()).length,
    words: (text.match(/[a-zA-Z]+/g) || []).length,
  };
}

function showStats() {
  const text = getDisplayText();
  if (!text) { showToast('没有内容可统计'); return; }
  const s = computeStats(text);
  if (!s) { showToast('统计失败'); return; }
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">📊 文本统计</div>
    <div class="sheet-group">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:14px">
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--primary)">${s.totalChars.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">总字符</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--primary)">${s.charsNoSpace.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">不含空格</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700">${s.chinese.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">中文字符</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700">${s.english.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">英文字母</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700">${s.digits.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">数字</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700">${s.punctuation.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">标点符号</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700">${s.words.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">英文单词</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm);text-align:center">
          <div style="font-size:22px;font-weight:700">${s.paras.toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-secondary)">段落</div></div>
      </div>
    </div>`;
  openSheet(html);
}

// ===== Copy functions =====
function getDisplayText() {
  if (state.fileType === 'pdf') return '';
  if (mdContent.style.display !== 'none')
    return mdContent.textContent || mdContent.innerText || '';
  if (htmlFrame.style.display !== 'none') {
    try {
      const doc = htmlFrame.contentDocument || htmlFrame.contentWindow?.document;
      return doc?.body?.textContent || '';
    } catch(e) { return ''; }
  }
  return '';
}

function getOriginalContent() {
  if (!state.fileContent) return '';
  if (state.fileType === 'pdf') return '';
  if (state.fileType === 'docx' || state.fileType === 'xlsx' || state.fileType === 'pptx') {
    return mdContent.textContent || mdContent.innerText || '';
  }
  return state.fileContent;
}

async function copyAllContent(mode) {
  if (!mode) mode = 'original';
  var text = '';
  if (mode === 'rendered') {
    // Copy the rendered/visible content
    if (state.fileType === 'html' && htmlFrame.style.display !== 'none') {
      try {
        var doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
        text = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
      } catch(e) { text = mdContent.innerText || mdContent.textContent || ''; }
    } else if (state.fileType === 'md') {
      text = mdContent.innerText || mdContent.textContent || '';
    } else if (state.fileType === 'docx' || state.fileType === 'xlsx' || state.fileType === 'pptx' || state.fileType === 'doc') {
      text = mdContent.innerText || mdContent.textContent || '';
    } else {
      text = getOriginalContent();
    }
  } else {
    text = getOriginalContent();
  }
  if (!text) { showToast('没有可复制的内容'); return; }
  try {
    await navigator.clipboard.writeText(text);
    const len = text.length;
    const label = mode === 'rendered' ? '渲染样式' : '原始格式';
    showToast(`已复制 ${label} (${len.toLocaleString()} 字符)`);
  } catch (e) {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('已复制到剪贴板'); }
  catch (e) { showToast('复制失败，请手动选择复制'); }
  document.body.removeChild(ta);
}

function showCopySheet() {
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">📋 复制内容</div>
    <div class="sheet-group">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="theme-opt" id="copyRenderedBtn" style="flex:none">📄 渲染样式</button>
        <button class="theme-opt" id="copyOriginalBtn" style="flex:none">📝 原始格式</button>
      </div>
      <p style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-top:8px">渲染样式：复制显示后的文本内容<br>原始格式：复制源文件原始内容<br>提示：你也可以长按或拖动选择部分文本后复制</p>
    </div>`;
  openSheet(html);
  setTimeout(() => {
    const renderedBtn = document.getElementById('copyRenderedBtn');
    const originalBtn = document.getElementById('copyOriginalBtn');
    if (renderedBtn) renderedBtn.addEventListener('click', () => { closeSheet(); copyAllContent('rendered'); });
    if (originalBtn) originalBtn.addEventListener('click', () => { closeSheet(); copyAllContent('original'); });
  }, 50);
}

// ===== Save As =====
async function saveContentAs(content, filename, ext, mime) {
  if (!content) { showToast('没有可保存的内容'); return; }
  if (FileAPI.platform === 'tauri') {
    const finalName = filename.replace(/\.[^.]+$/, '') + ext;
    await FileAPI.saveFile(content, finalName, mime);
    showToast(`已保存为 ${finalName}`);
    return;
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\.[^.]+$/, '') + ext;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`已保存为 ${a.download}`);
}

async function getContentAsHtml() {
  if (state.fileType === 'html') return state.fileContent;
  let inner = '';
  if (mdContent.style.display !== 'none') {
    const clone = mdContent.cloneNode(true);
    clone.querySelectorAll('pre > span').forEach(el => { if (el.style.position === 'absolute') el.remove(); });
    clone.querySelectorAll('.katex-mathml').forEach(el => el.remove());
    inner = clone.innerHTML;
  } else if (htmlFrame.style.display !== 'none') {
    try {
      const doc = htmlFrame.contentDocument || htmlFrame.contentWindow?.document;
      inner = doc?.body?.innerHTML || '';
    } catch(e) { inner = getOriginalContent(); }
  }
  if (!inner) inner = escapeHtml(getOriginalContent());
  const exportStyle = `body{font-family:-apple-system,sans-serif;line-height:1.7;max-width:720px;margin:0 auto;padding:20px;color:#333}
img{max-width:100%;height:auto}pre{overflow-x:auto;background:#f5f5f5;padding:12px 12px 36px;border-radius:6px;position:relative;font-size:0.85em}
pre code{font-family:"SF Mono",Consolas,monospace;font-size:inherit}
pre .copy-btn{position:absolute;bottom:6px;right:6px;background:#e8e8e8;border:1px solid #ccc;border-radius:4px;padding:3px 10px;font-size:11px;color:#555;cursor:pointer;user-select:none;-webkit-user-select:none}
pre .copy-btn:hover{background:#ddd}
pre .copy-btn:active{background:#ccc}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px}
blockquote{border-left:4px solid #6c5ce7;margin:1em 0;padding:0.5em 1em;background:#f8f7ff}
.mermaid{text-align:center;margin:1em 0;overflow-x:auto}`;
  const copyScript = `<script>
document.addEventListener('click',function(e){var b=e.target.closest('.copy-btn');if(!b)return;var c=b.getAttribute('data-code')||b.nextElementSibling.textContent;if(navigator.clipboard)navigator.clipboard.writeText(c).then(function(){var t=b.textContent;b.textContent='\u2713 \u5df2\u590d\u5236';setTimeout(function(){b.textContent=t},1500)});else{var t=document.createElement('textarea');t.value=c;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();b.textContent='\u2713 \u5df2\u590d\u5236';setTimeout(function(){b.textContent='\u590d\u5236'},1500)}});
<\/script>`;
  const katexStyle = (inner.includes('class="katex') || inner.includes('class="katex-display')) && _katexCss ? `<style>${_katexCss}</style>` : '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(state.fileName)}</title>
<style>${exportStyle}</style>
${katexStyle}
</head><body>${inner}${copyScript}</body></html>`;
}

function getContentAsMd() {
  if (state.fileType === 'md') return state.fileContent;
  if (state.fileType === 'html') {
    try {
      const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
      if (doc && doc.body) return htmlToMarkdown(doc.body);
    } catch(e) {}
    return state.fileContent || '';
  }
  if (state.fileType === 'txt' || state.fileType === 'code') return state.fileContent || '';
  return mdContent.innerText || mdContent.textContent || '';
}

function htmlToMarkdown(el) {
  var md = '';
  for (var i = 0; i < el.childNodes.length; i++) {
    var node = el.childNodes[i];
    if (node.nodeType === 3) {
      md += node.textContent;
    } else if (node.nodeType === 1) {
      var tag = node.tagName.toLowerCase();
      // KaTeX: extract LaTeX from data-tex attribute (set during rendering)
      if (node.classList && (node.classList.contains('katex') || node.classList.contains('katex-display'))) {
        var texAttr = node.getAttribute('data-tex') || (node.parentElement && node.parentElement.getAttribute('data-tex'));
        if (texAttr) {
          if (node.classList.contains('katex-display')) {
            md += '\n$$' + texAttr.trim() + '$$\n\n';
          } else {
            md += '$' + texAttr.trim() + '$';
          }
          continue;
        }
        // Fallback: try annotation
        var ann = node.querySelector('annotation');
        if (ann) {
          var tex = ann.textContent.trim();
          md += node.classList.contains('katex-display') ? '\n$$' + tex + '$$\n\n' : '$' + tex + '$';
          continue;
        }
        // Fallback: visible text (imperfect)
        var katexHtml = node.querySelector('.katex-html');
        var katexText = katexHtml ? katexHtml.textContent.trim() : node.textContent.trim();
        if (katexText) {
          md += node.classList.contains('katex-display') ? '\n$$' + katexText + '$$\n\n' : '$' + katexText + '$';
          continue;
        }
      }
      // data-tex on span wrapper (inline math)
      if (node.getAttribute && node.getAttribute('data-tex')) {
        md += '$' + node.getAttribute('data-tex').trim() + '$';
        continue;
      }
      var inner = htmlToMarkdown(node);
      if (tag === 'h1') md += '\n# ' + inner.trim() + '\n\n';
      else if (tag === 'h2') md += '\n## ' + inner.trim() + '\n\n';
      else if (tag === 'h3') md += '\n### ' + inner.trim() + '\n\n';
      else if (tag === 'h4') md += '\n#### ' + inner.trim() + '\n\n';
      else if (tag === 'h5') md += '\n##### ' + inner.trim() + '\n\n';
      else if (tag === 'h6') md += '\n###### ' + inner.trim() + '\n\n';
      else if (tag === 'p') md += inner.trim() + '\n\n';
      else if (tag === 'br') md += '\n';
      else if (tag === 'strong' || tag === 'b') md += '**' + inner.trim() + '**';
      else if (tag === 'em' || tag === 'i') md += '*' + inner.trim() + '*';
      else if (tag === 'del' || tag === 's') md += '~~' + inner.trim() + '~~';
      else if (tag === 'code' && node.parentNode.tagName.toLowerCase() !== 'pre') md += '`' + inner + '`';
      else if (tag === 'pre') {
        var codeEl = node.querySelector('code');
        var lang = '';
        if (codeEl) {
          var cls = codeEl.className || '';
          var m = cls.match(/language-(\w+)/);
          if (m) lang = m[1];
        }
        md += '\n```' + lang + '\n' + (codeEl || node).textContent + '\n```\n\n';
      }
      else if (tag === 'a') md += '[' + inner.trim() + '](' + (node.getAttribute('href') || '') + ')';
      else if (tag === 'img') md += '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
      else if (tag === 'blockquote') md += inner.trim().split('\n').map(function(l) { return '> ' + l; }).join('\n') + '\n\n';
      else if (tag === 'ul') {
        var items = node.querySelectorAll(':scope > li');
        items.forEach(function(li) { md += '- ' + htmlToMarkdown(li).trim() + '\n'; });
        md += '\n';
      }
      else if (tag === 'ol') {
        var items = node.querySelectorAll(':scope > li');
        items.forEach(function(li, idx) { md += (idx + 1) + '. ' + htmlToMarkdown(li).trim() + '\n'; });
        md += '\n';
      }
      else if (tag === 'li') md += inner;
      else if (tag === 'hr') md += '\n---\n\n';
      else if (tag === 'table') md += htmlTableToMarkdown(node);
      else if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'span') md += inner;
      else md += inner;
    }
  }
  return md;
}

function htmlTableToMarkdown(table) {
  var rows = [];
  var trs = table.querySelectorAll('tr');
  trs.forEach(function(tr) {
    var cells = [];
    tr.querySelectorAll('th,td').forEach(function(cell) {
      cells.push(htmlToMarkdown(cell).trim().replace(/\|/g, '\\|'));
    });
    rows.push(cells);
  });
  if (!rows.length) return '';
  var md = '| ' + rows[0].join(' | ') + ' |\n';
  md += '| ' + rows[0].map(function() { return '---'; }).join(' | ') + ' |\n';
  for (var i = 1; i < rows.length; i++) {
    md += '| ' + rows[i].join(' | ') + ' |\n';
  }
  return '\n' + md + '\n';
}

function getContentAsCsv() {
  if (state.fileType === 'csv') return state.fileContent;
  if (state.fileType === 'xlsx') {
    const text = mdContent.textContent || '';
    return text.split('\n').filter(l => l.trim()).join('\n');
  }
  const text = getOriginalContent();
  return text;
}

// ===== Replace KaTeX elements with PNG images in a DOM clone (for export) =====
async function replaceKatexWithImages(clone, maxDisplayWidth) {
  const els = [...clone.querySelectorAll('.katex-display, .katex:not(.katex-display .katex)')];
  if (!els.length) return;
  await ensureHtml2Canvas();
  await new Promise(r => setTimeout(r, 100));
  for (const el of els) {
    try {
      const isDisplay = el.classList.contains('katex-display');
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;width:' + (isDisplay ? '800px' : 'auto');
      const ce = el.cloneNode(true);
      wrapper.appendChild(ce);
      document.body.appendChild(wrapper);
      await new Promise(r => setTimeout(r, 50));
      const canvas = await html2canvas(wrapper, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true,
        logging: false, allowTaint: false,
      });
      document.body.removeChild(wrapper);
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      const cw = canvas.width / 2;  // CSS pixels (after dividing by scale)
      const ch = canvas.height / 2;
      let iw, ih;
      if (isDisplay) {
        iw = maxDisplayWidth > 0 && maxDisplayWidth < cw ? maxDisplayWidth : cw;
        ih = Math.round(ch * (iw / cw));
        img.style.cssText = 'display:block;margin:1em auto;max-width:100%;height:auto';
      } else {
        iw = Math.round(cw);
        ih = Math.round(ch);
        img.style.cssText = 'display:inline-block;vertical-align:middle;max-width:100%;height:auto';
      }
      img.width = iw;
      img.height = ih;
      el.parentNode.replaceChild(img, el);
    } catch(e) { /* skip – keep original KaTeX HTML as fallback */ }
  }
}
