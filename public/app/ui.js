// ===== DOM refs =====
const $ = id => document.getElementById(id);
const titleDisplay = $('titleDisplay');
const contentArea = $('contentArea');
const emptyState = $('emptyState');
const mdContent = $('mdContent');
const htmlFrame = $('htmlFrame');
const fileInput = $('fileInput');
const progressFill = $('progressFill');
const toast = $('toast');
const actionStrip = $('actionStrip');
const sheetOverlay = $('sheetOverlay');
const sheet = $('sheet');
const sheetBody = $('sheetBody');
const loadingIndicator = $('loadingIndicator');
const loadingText = $('loadingText');
const zoomDisplay = $('zoomDisplay');

// ===== Theme =====
function getEffectiveTheme() {
  if (state.theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return state.theme;
}

function applyTheme() {
  const t = getEffectiveTheme();
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('theme-color-meta').setAttribute('content', t === 'dark' ? '#1a1a2e' : '#f8f9fa');
}

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});

function setTheme(t) {
  state.theme = t;
  localStorage.setItem('reader-theme', t);
  applyTheme();
}

// ===== Font Size =====
function applyFontSize() {
  document.documentElement.setAttribute('data-font', state.fontSize.toString());
  localStorage.setItem('reader-font-size', state.fontSize.toString());
}
applyFontSize();

function setFontSize(s) {
  state.fontSize = s;
  applyFontSize();
}

// ===== Toast =====
let toastTimer;

function showToast(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ===== About dialog =====
function showAboutDialog() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px';
  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--bg-card);border-radius:16px;padding:28px;max-width:360px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.3);text-align:center';
  dialog.innerHTML = `
    <div style="font-size:40px;margin-bottom:8px">📖</div>
    <h2 style="margin:0 0 4px;font-size:18px">通用阅读器</h2>
    <p style="margin:0 0 16px;font-size:13px;color:var(--text-secondary)">v${typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev'}</p>
    <p style="margin:0 0 6px;font-size:14px">支持 MD / HTML / TXT / PDF /<br>Word / Excel / PPT / CSV / JSON / 代码</p>
    <p style="margin:8px 0 16px;font-size:12px;color:var(--text-secondary)">注：Word、Excel、PPT 仅限基础格式，复杂排版可能无法完整预览</p>
    <p style="margin:16px 0 20px;font-size:13px;color:var(--text-secondary)">版权作者：洋芋哥</p>
    <button id="aboutOkBtn" style="padding:8px 32px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:14px;cursor:pointer;min-width:100px">确定</button>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  document.getElementById('aboutOkBtn').onclick = () => { document.body.removeChild(overlay); };
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
}

// ===== Password dialog =====
function showPasswordDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card);border-radius:16px;padding:24px;max-width:340px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.3);text-align:center';
    dialog.innerHTML = `
      <div style="font-size:40px;margin-bottom:12px">🔒</div>
      <h3 style="margin:0 0 4px;font-size:17px;color:var(--text)">文件已加密</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--text-secondary)">请输入文档密码</p>
      <input type="password" id="pwdInput" placeholder="输入密码" autocomplete="off"
        style="width:100%;padding:12px;border:2px solid var(--border);border-radius:10px;font-size:16px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box">
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="pwdCancel" style="flex:1;padding:12px;border:2px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-size:15px;cursor:pointer">取消</button>
        <button id="pwdSubmit" style="flex:1;padding:12px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-size:15px;font-weight:600;cursor:pointer">解密</button>
      </div>
      <div id="pwdError" style="color:#e74c3c;font-size:13px;margin-top:8px;display:none"></div>`;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector('#pwdInput');
    const submit = dialog.querySelector('#pwdSubmit');
    const cancel = dialog.querySelector('#pwdCancel');
    const error = dialog.querySelector('#pwdError');

    function close(v) { document.body.removeChild(overlay); resolve(v); }

    submit.onclick = () => { const p = input.value; if (!p) { error.textContent='请输入密码'; error.style.display='block'; return; } close(p); };
    cancel.onclick = () => close(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') submit.click(); if (e.key === 'Escape') cancel.click(); };
    input.oninput = () => { error.style.display='none'; };
    setTimeout(() => input.focus(), 100);
  });
}

// ===== Generic prompt dialog (replaces native prompt() for Android WebView compat) =====
function showPromptDialog(options) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px';
    var dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card);border-radius:16px;padding:24px;max-width:340px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.3);text-align:center';
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:16px;color:var(--text)">${options.title || '输入'}</h3>
      <input id="promptInput" type="text" placeholder="${options.placeholder || ''}" value="${options.defaultValue || ''}" autocomplete="off"
        style="width:100%;padding:12px;border:2px solid var(--border);border-radius:10px;font-size:16px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box">
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="promptCancel" style="flex:1;padding:12px;border:2px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-size:15px;cursor:pointer">取消</button>
        <button id="promptSubmit" style="flex:1;padding:12px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-size:15px;font-weight:600;cursor:pointer">确定</button>
      </div>`;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    var input = dialog.querySelector('#promptInput');
    function close(v) { document.body.removeChild(overlay); resolve(v); }
    dialog.querySelector('#promptSubmit').onclick = function() { close(input.value); };
    dialog.querySelector('#promptCancel').onclick = function() { close(''); };
    input.onkeydown = function(e) { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(''); };
    setTimeout(function() { input.focus(); input.select(); }, 100);
  });
}

// ===== Action Buttons =====
function showActionStrip(show) {
  actionStrip.style.display = show ? '' : 'none';
}
// Copy
$('actCopy').addEventListener('click', () => {
  if (!state.fileContent) { showToast('没有打开的文件'); return; }
  copyAllContent();
});
// Bookmark add
$('actBmAdd').addEventListener('click', saveBookmark);
// Bookmark list
$('actBmList').addEventListener('click', showBookmarkSheet);
// URL browse
$('actUrl').addEventListener('click', () => browseUrl());
$('actEdit').addEventListener('click', () => toggleEditor());
// Zoom
$('actZoomIn').addEventListener('click', () => applyZoom(0.1));
$('actZoomOut').addEventListener('click', () => applyZoom(-0.1));
zoomDisplay.textContent = Math.round(state.zoomLevel * 100) + '%';

// ===== Pinch-to-zoom for general content (non-PDF) =====
(function() {
  var gPinchState = null;
  var gPinchStartZoom = 1;
  var gPinchPending = false;
  contentArea.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2 && !document.getElementById('pdfViewerWrapper')) {
      e.preventDefault();
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      gPinchStartZoom = state.zoomLevel;
      gPinchState = { dist: Math.sqrt(dx * dx + dy * dy) };
    }
  }, { passive: false });
  contentArea.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2 && gPinchState) {
      e.preventDefault();
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var ratio = dist / gPinchState.dist;
      var previewZoom = Math.min(4, Math.max(0.25, gPinchStartZoom * ratio));
      // Apply CSS transform for real-time preview
      var target = mdContent.style.display !== 'none' ? mdContent : htmlFrame;
      if (target && target !== htmlFrame._prevPinchTarget) {
        target.style.transformOrigin = 'top left';
        htmlFrame.style.transformOrigin = 'top left';
      }
      target.style.transform = 'scale(' + previewZoom + ')';
      target.style.transformOrigin = 'top left';
      contentArea.style.overflow = 'auto';
      zoomDisplay.textContent = Math.round(previewZoom * 100) + '%';
      gPinchPending = previewZoom;
    }
  }, { passive: false });
  contentArea.addEventListener('touchend', function(e) {
    if (e.touches.length < 2 && gPinchState) {
      if (gPinchPending && Math.abs(gPinchPending - state.zoomLevel) > 0.01) {
        state.zoomLevel = Math.round(gPinchPending * 100) / 100;
        try { localStorage.setItem('reader-zoom', String(state.zoomLevel)); } catch(ex) {}
        reapplyZoom();
      }
      gPinchState = null;
      gPinchPending = false;
    }
  });
})();
// Drawing
$('actDraw').addEventListener('click', () => toggleDrawMode());
// Print
$('actPrint').addEventListener('click', () => printContent());
// Clear
$('actClear').addEventListener('click', () => clearDocument());
// Document navigation
$('actPrev').addEventListener('click', () => navigateDoc(-1));
$('actNext').addEventListener('click', () => navigateDoc(1));

// ===== Bottom Sheet =====
function openSheet(html) {
  sheetBody.innerHTML = html;
  sheetOverlay.classList.add('open');
  sheet.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  sheetOverlay.classList.remove('open');
  sheet.classList.remove('open');
  document.body.style.overflow = '';
}

function showCellContent(text) {
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">📋 单元格内容</div>
    <div class="sheet-group">
      <div style="background:var(--bg);padding:14px;border-radius:var(--radius-sm);font-size:14px;line-height:1.6;word-break:break-all;white-space:pre-wrap;max-height:50vh;overflow-y:auto">${escapeHtml(text)}</div>
      <button class="theme-opt" id="cellCopyBtn" style="width:100%;margin-top:8px">📋 复制此内容</button>
    </div>`;
  openSheet(html);
  setTimeout(() => {
    const btn = document.getElementById('cellCopyBtn');
    if (btn) btn.addEventListener('click', () => {
      closeSheet();
      navigator.clipboard.writeText(text).then(() => showToast('已复制')).catch(() => fallbackCopy(text));
    });
  }, 50);
}

sheetOverlay.addEventListener('click', closeSheet);

// ===== Sheet: Theme =====
function showThemeSheet() {
  const themes = [
    { id: 'light', label: '☀️ 浅色' },
    { id: 'dark', label: '🌙 深色' },
    { id: 'auto', label: '🔄 跟随系统' }
  ];
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">主题设置</div>
    <div class="sheet-group">
      <div class="sheet-label">选择主题</div>
      <div class="theme-options">
        ${themes.map(t => `<button class="theme-opt${state.theme === t.id ? ' selected' : ''}" data-theme="${t.id}">${t.label}</button>`).join('')}
      </div>
    </div>
  `;
  openSheet(html);
  sheet.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.theme);
      sheet.querySelectorAll('.theme-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      showToast(`主题已切换`);
    });
  });
}

// ===== Sheet: Font Size =====
function showFontSheet() {
  const sizes = [
    { id: 14, label: '小' },
    { id: 16, label: '中' },
    { id: 18, label: '大' },
    { id: 20, label: '特大' },
    { id: 24, label: '最大' }
  ];
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">字号设置</div>
    <div class="sheet-group">
      <div class="sheet-label">选择字号</div>
      <div class="font-options">
        ${sizes.map(s => `<button class="font-opt${state.fontSize === s.id ? ' selected' : ''}" data-size="${s.id}">${s.label}</button>`).join('')}
      </div>
    </div>
  `;
  openSheet(html);
  sheet.querySelectorAll('.font-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      setFontSize(parseInt(btn.dataset.size));
      sheet.querySelectorAll('.font-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      showToast(`字号已切换`);
    });
  });
}

// ===== Toolbar actions =====
$('tbTheme').addEventListener('click', showThemeSheet);
$('tbFont').addEventListener('click', showFontSheet);
$('tbStats').addEventListener('click', () => showStats());

// ===== Fullscreen =====
function _pdfFullscreenNav(dir) {
  var pdfWrapper = document.getElementById('pdfViewerWrapper');
  if (pdfWrapper && pdfWrapper._pdfNav) pdfWrapper._pdfNav(dir);
}
$('tbFullscreen').addEventListener('click', () => {
  var pdfWrapper = document.getElementById('pdfViewerWrapper');
  var isPdf = !!pdfWrapper;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
    // True fullscreen for PDF: hide all UI
    if (isPdf) {
      document.querySelector('.header').style.display = 'none';
      document.querySelector('.action-strip').style.display = 'none';
      document.querySelector('.toolbar').style.display = 'none';
      document.querySelector('.progress-bar').style.display = 'none';
      contentArea.style.padding = '0';
      contentArea.style.paddingBottom = '0';
      // Add floating nav buttons
      var fsNav = document.createElement('div');
      fsNav.id = 'pdfFullscreenNav';
      fsNav.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;gap:12px;background:rgba(0,0,0,0.6);border-radius:30px;padding:8px 16px;';
      fsNav.innerHTML = '<button id="fsPrev" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:8px 16px;">◀</button><button id="fsExit" style="background:none;border:none;color:#fff;font-size:14px;cursor:pointer;padding:8px 12px;">✕ 退出</button><button id="fsNext" style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;padding:8px 16px;">▶</button>';
      document.body.appendChild(fsNav);
      document.getElementById('fsPrev').onclick = function() { _pdfFullscreenNav(-1); };
      document.getElementById('fsNext').onclick = function() { _pdfFullscreenNav(1); };
      document.getElementById('fsExit').onclick = function() { $('tbFullscreen').click(); };
      // Re-fit PDF
      if (pdfWrapper._pdfFitWidth) setTimeout(function() { pdfWrapper._pdfFitWidth(); }, 300);
    }
    showToast('进入全屏');
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    // Restore UI
    if (isPdf) {
      document.querySelector('.header').style.display = '';
      document.querySelector('.action-strip').style.display = '';
      document.querySelector('.toolbar').style.display = '';
      document.querySelector('.progress-bar').style.display = '';
      contentArea.style.padding = '';
      contentArea.style.paddingBottom = '';
      var fsNav = document.getElementById('pdfFullscreenNav');
      if (fsNav) fsNav.remove();
      if (pdfWrapper._pdfFitWidth) setTimeout(function() { pdfWrapper._pdfFitWidth(); }, 300);
    }
    showToast('退出全屏');
  }
});

// ===== Scroll Buttons =====
function scrollContentTo(direction) {
  scrollContentToPos(direction === 'top' ? 0 : Infinity, direction === 'top' ? 'auto' : 'smooth');
}
function scrollContentToPos(pos, behavior) {
  behavior = behavior || 'smooth';
  // XLSX virtual scroll
  if (state.fileType === 'xlsx') {
    const wraps = document.querySelectorAll('[id^="xlsx-wrap-"]');
    for (const wrap of wraps) {
      if (wrap.offsetParent !== null) {
        const csv = wrap.querySelector('.csv-table-wrap');
        if (csv) { csv.scrollTo({ top: pos === Infinity ? csv.scrollHeight : pos, behavior }); return; }
        const sa = wrap.querySelector('div[style*="overflow:auto"]');
        if (sa) { sa.scrollTo({ top: pos === Infinity ? sa.scrollHeight : pos, behavior }); return; }
        break;
      }
    }
  }
  // Iframe (same-origin HTML / PDF / Word HTML .doc)
  if (htmlFrame.style.display !== 'none' && (htmlFrame.src || htmlFrame.srcdoc)) {
    try {
      if (htmlFrame.contentWindow) {
        const doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
        if (doc) {
          const bd = doc.body, htm = doc.documentElement;
          const target = pos === Infinity ? Math.max(
            htm ? htm.scrollHeight : 0, bd ? bd.scrollHeight : 0,
            htm ? htm.offsetHeight : 0, bd ? bd.offsetHeight : 0
          ) : pos;
          // Scroll the window inside the iframe
          htmlFrame.contentWindow.scrollTo({ top: target, behavior });
          // Also scroll body and html
          try { if (bd) bd.scrollTop = target; } catch(_) {}
          try { if (htm) htm.scrollTop = target; } catch(_) {}
          return;
        }
      }
    } catch(e) {}
  }
  // contentArea with overflow scroll (zoomed content)
  if (contentArea.scrollHeight > contentArea.clientHeight + 2) {
    contentArea.scrollTo({ top: pos === Infinity ? contentArea.scrollHeight : pos, behavior });
    return;
  }
  // Window scroll (default)
  if (pos === Infinity) window.scrollTo({ top: document.body.scrollHeight, behavior });
  else window.scrollTo({ top: pos, behavior });
}
$('tbScrollUp').addEventListener('click', () => scrollContentTo('top'));
$('tbScrollDown').addEventListener('click', () => scrollContentTo('bottom'));

// ===== Menu: show action sheet =====
$('menuBtn').addEventListener('click', showMenuSheet);

function showMenuSheet() {
  const hasContent = !!state.fileContent;
  const hasHeadings = hasContent && (state.fileType === 'md' || state.fileType === 'docx') && mdContent.querySelectorAll('h1,h2,h3,h4,h5,h6').length > 0;
  const hasSheets = hasContent && state.fileType === 'xlsx' && mdContent.querySelectorAll('.xlsx-sheet-tab').length > 0;
  const files = state.importedFiles;
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">${state.fileName ? escapeHtml(state.fileName) : '通用阅读器'}</div>
    <div class="sheet-group">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${hasContent ? `
        <button class="theme-opt menu-act" data-act="info">ℹ️ 文件信息</button>
        <button class="theme-opt menu-act" data-act="save">💾 另存为</button>
        ${hasHeadings ? `<button class="theme-opt menu-act" data-act="outline">📑 文档大纲</button>` : ''}
        ${hasSheets ? `<button class="theme-opt menu-act" data-act="sheets">📊 切换工作表</button>` : ''}
        <button class="theme-opt menu-act" data-act="url">🌐 浏览网址</button>
        <button class="theme-opt menu-act" data-act="debug">🔧 调试日志</button>
        <button class="theme-opt menu-act" data-act="about">ℹ️ 关于</button>
        ` : `
        <button class="theme-opt menu-act" data-act="open">📂 打开文件</button>
        <button class="theme-opt menu-act" data-act="url">🌐 浏览网址</button>
        <button class="theme-opt menu-act" data-act="debug">🔧 调试日志</button>
        <button class="theme-opt menu-act" data-act="about">ℹ️ 关于</button>
        `}
      </div>
    </div>
    <div class="sheet-group">
      <div class="sheet-label" style="display:flex;align-items:center;gap:6px">
        <span>📂 导入文件</span>
        <span style="font-size:11px;color:var(--text-secondary);font-weight:400">(${files.length})</span>
        <span style="flex:1"></span>
        ${files.length ? `<button class="fl-clear" style="font-size:11px;border:none;background:none;color:#e74c3c;cursor:pointer;padding:0 4px" title="清空列表">清空</button>` : ''}
      </div>
      ${files.length ? files.map((f, i) =>
        `<div class="file-list-item" data-idx="${i}">
          <span class="fl-icon">${getFileIcon(f.type || detectFileType(f.name))}</span>
          <div class="fl-name">${escapeHtml(f.name)}<span class="fl-path">${escapeHtml(f.fullPath || '')}</span></div>
          <button class="fl-del" data-idx="${i}" title="移除">✕</button>
        </div>`
      ).join('') : `<div class="file-list-empty">暂无导入文件<br>将文件或文件夹拖拽到窗口即可批量导入</div>`}
    </div>`;
  openSheet(html);
  setTimeout(() => {
    document.querySelectorAll('.menu-act').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        closeSheet();
        if (act === 'info') showFileInfo();
        else if (act === 'save') showSaveSheet();
        else if (act === 'outline') showWordOutline();
        else if (act === 'sheets') showSheetSwitcher();
        else if (act === 'url') browseUrl();
        else if (act === 'open') FileAPI.pickFiles(ACCEPT_EXTS).then(async fds => {
          if (!fds || !fds.length) return;
          for (const _fd of fds) {
            const _type = detectFileType(_fd.name);
            const _fullPath = _fd._path || _fd.path || _fd.name;
            const _existing = state.importedFiles.findIndex(f => f.fullPath === _fullPath);
            if (_existing >= 0) { state.importedFiles[_existing].type = _type; state.importedFiles[_existing]._fileRef = _fd; state.importedFiles[_existing].content = null; }
            else { state.importedFiles.push({ name: _fd.name, fullPath: _fullPath, type: _type, _fileRef: _fd, content: null }); }
          }
          await openImportedFile(state.importedFiles.length - 1);
          showToast(`已打开 ${fds.length} 个文件`);
        });
        else if (act === 'about') showAboutDialog();
        else if (act === 'debug') _toggleDiag();
      });
    });
    document.querySelectorAll('.file-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.fl-del')) return;
        const i = parseInt(el.dataset.idx);
        const f = state.importedFiles[i];
        if (f && !f.isLoading) openImportedFile(i);
      });
    });
    document.querySelectorAll('.fl-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.dataset.idx);
        state.importedFiles.splice(i, 1);
        if (state.importedFiles.length === 0 && state.fileName.endsWith('.md') && !state.importedFiles.some(f => f.name === state.fileName)) {
          // also clear current content if source removed
        }
        closeSheet();
        showToast('已移除');
        if (state.importedFiles.length) showMenuSheet();
      });
    });
    document.querySelector('.fl-clear')?.addEventListener('click', () => {
      state.importedFiles = [];
      dbClear('files').catch(() => {});
      dbClear('progress').catch(() => {});
      try { localStorage.removeItem('reader-last-session'); } catch(e) {}
      closeSheet();
      showToast('已清空导入列表和缓存');
    });
  }, 50);
}

function showWordOutline() {
  const headings = mdContent.querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (!headings.length) { showToast('没有可导航的标题'); return; }
  let items = '';
  headings.forEach((h, i) => {
    const level = parseInt(h.dataset.level || h.tagName[1]);
    const text = h.textContent.trim();
    if (!text) return;
    items += `<div style="padding:8px 12px 8px ${12 + (level - 1) * 16}px;border-radius:var(--radius-sm);cursor:pointer;font-size:${level <= 2 ? '15px' : '13px'};font-weight:${level <= 2 ? '600' : '400'};color:var(--text);-webkit-tap-highlight-color:transparent" data-target="${h.id}">
      <span style="color:var(--text-secondary);margin-right:6px;font-size:11px">H${level}</span>${escapeHtml(text)}</div>`;
  });
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">📑 文档大纲</div>
    <div class="sheet-group">${items || '<p style="color:var(--text-secondary)">无标题</p>'}</div>`;
  openSheet(html);
  setTimeout(() => {
    document.querySelector('[data-target]')?.parentElement?.querySelectorAll('[data-target]').forEach(el => {
      el.addEventListener('click', () => {
        closeSheet();
        const target = document.getElementById(el.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }, 50);
}

function showSheetSwitcher() {
  const tabs = mdContent.querySelectorAll('.xlsx-sheet-tab');
  if (!tabs.length) { showToast('没有可切换的工作表'); return; }
  let items = '';
  tabs.forEach((tab, i) => {
    const name = tab.textContent;
    const active = tab.classList.contains('active');
    items += `<div style="padding:10px 14px;border-radius:var(--radius-sm);cursor:pointer;display:flex;align-items:center;gap:8px;${active ? 'background:var(--primary-light);color:var(--primary);font-weight:600' : 'color:var(--text)'};-webkit-tap-highlight-color:transparent" data-sidx="${tab.dataset.idx}">
      <span>${active ? '✓' : '📄'}</span><span>${escapeHtml(name)}</span></div>`;
  });
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">📊 工作表</div>
    <div class="sheet-group">${items}</div>`;
  openSheet(html);
  setTimeout(() => {
    document.querySelectorAll('[data-sidx]').forEach(el => {
      el.addEventListener('click', () => {
        closeSheet();
        const idx = el.dataset.sidx;
        const tab = mdContent.querySelector(`.xlsx-sheet-tab[data-idx="${idx}"]`);
        if (tab) {
          setTimeout(() => tab.click(), 100);
        }
      });
    });
  }, 50);
}

function showFileInfo() {
  if (!state.fileContent) { showToast('没有文件信息'); return; }
  // Precise file size
  var sizeBytes = 0;
  if (state.fileContent instanceof ArrayBuffer) {
    sizeBytes = state.fileContent.byteLength;
  } else if (typeof state.fileContent === 'string') {
    sizeBytes = new Blob([state.fileContent]).size;
  } else {
    sizeBytes = new Blob([state.fileContent]).size;
  }
  var sizeStr;
  if (sizeBytes < 1024) sizeStr = sizeBytes + ' B';
  else if (sizeBytes < 1024 * 1024) sizeStr = (sizeBytes / 1024).toFixed(1) + ' KB';
  else sizeStr = (sizeBytes / 1024 / 1024).toFixed(2) + ' MB';

  let lines = 'N/A';
  if (state.fileMeta.rows !== undefined) {
    lines = state.fileMeta.rows + ' 行 × ' + state.fileMeta.cols + ' 列';
  } else if (typeof state.fileContent === 'string') {
    lines = state.fileContent.split('\n').length + ' 行';
  } else {
    const text = mdContent.textContent || '';
    if (text) {
      const c = text.split('\n').length;
      lines = c > 1 ? c + ' 行' : '渲染中';
    }
  }

  // Encoding info for text files
  var encoding = state.fileEncoding || '';
  if (!encoding && typeof state.fileContent === 'string') {
    encoding = 'UTF-8 (text)';
  }

  var encodingHtml = encoding
    ? `<div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm)"><div style="font-weight:700">编码</div><div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(encoding)}</div></div>`
    : '';

  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">ℹ️ 文件信息</div>
    <div class="sheet-group">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:14px">
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm)">
          <div style="font-weight:700">文件名</div>
          <div style="font-size:12px;color:var(--text-secondary);word-break:break-all">${escapeHtml(state.fileName)}</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm)">
          <div style="font-weight:700">格式</div>
          <div style="font-size:12px;color:var(--text-secondary)">.${state.fileExt || state.fileType}</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm)">
          <div style="font-weight:700">大小</div>
          <div style="font-size:12px;color:var(--text-secondary)">${sizeStr}</div></div>
        <div style="background:var(--bg);padding:10px;border-radius:var(--radius-sm)">
          <div style="font-weight:700">行数</div>
          <div style="font-size:12px;color:var(--text-secondary)">${lines}</div></div>
        ${encodingHtml}
      </div>
    </div>`;
  openSheet(html);
}
