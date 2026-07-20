// ===== Word Export (.doc/.docx) =====
// Capture a Mermaid diagram as PNG data URI via html2canvas, returns {dataUri,width,height}
// Capture any DOM element as a PNG image (for export fidelity)
// Returns { dataUri, width, height } or null on failure
async function captureElementAsPng(el, maxDisplayWidth) {
  try {
    if (typeof html2canvas === 'undefined') { await ensureHtml2Canvas(); }
    const clone = el.cloneNode(true);
    const wrapper = document.createElement('div');
    const w = maxDisplayWidth || 560;
    wrapper.style.cssText = `position:fixed;left:-9999px;top:0;overflow:hidden;background:#fff`;
    const inner = document.createElement('div');
    inner.style.cssText = `width:${w}px;box-sizing:border-box`;
    inner.appendChild(clone);
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    await new Promise(r => setTimeout(r, 80));
    const canvas = await html2canvas(wrapper, {
      useCORS: true, scale: 2, backgroundColor: '#ffffff',
      logging: false, allowTaint: false,
    });
    document.body.removeChild(wrapper);
    return { dataUri: canvas.toDataURL('image/png'), width: w, height: Math.round(canvas.height / 2) };
  } catch(e) { return null; }
}

async function captureMermaidAsPng(svgEl) {
  try {
    if (typeof html2canvas === 'undefined') { await ensureHtml2Canvas(); }
    const container = svgEl.closest('.mermaid') || svgEl.parentNode;
    if (!container) return null;
    const clone = container.cloneNode(true);
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;overflow:hidden;background:#fff';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    await new Promise(r => setTimeout(r, 50));
    const canvas = await html2canvas(wrapper, {
      useCORS: true, scale: 2.5, backgroundColor: '#ffffff',
      logging: false, allowTaint: false,
    });
    document.body.removeChild(wrapper);
    const dispW = 560;
    const dispH = Math.round(canvas.height * (dispW / canvas.width));
    return { dataUri: canvas.toDataURL('image/png'), width: dispW, height: dispH };
  } catch(e) { return null; }
}

// Shared: get clean HTML content for export
//   codeBlockFormat: 'pre' → <pre><code> with <br> (for .doc Word HTML)
//                    'p'   → <p> per line, no wrapper (for .docx docshift — ignores <br>)
async function getCleanContentForExport({ codeBlockFormat = 'pre' } = {}) {
  let inner = '';
  if (mdContent.style.display !== 'none') {
    const clone = mdContent.cloneNode(true);
    clone.querySelectorAll('.copy-btn').forEach(el => el.remove());
    clone.querySelectorAll('pre > span').forEach(el => { if (el.style.position === 'absolute') el.remove(); });
    // Mermaid SVGs → PNG
    const svgs = [...clone.querySelectorAll('.mermaid svg')];
    if (svgs.length) {
      await Promise.all(svgs.map(async (svg) => {
        try {
          const result = await captureMermaidAsPng(svg);
          if (result) {
            const img = document.createElement('img');
            img.src = result.dataUri; img.width = result.width; img.height = result.height;
            img.style.cssText = 'max-width:100%;height:auto';
            svg.parentNode.replaceChild(img, svg); return;
          }
        } catch(e) {}
        try {
          const svgStr = new XMLSerializer().serializeToString(svg);
          const b64 = btoa(unescape(encodeURIComponent(svgStr)));
          const img = document.createElement('img');
          img.src = 'data:image/svg+xml;base64,' + b64;
          img.style.cssText = 'max-width:100%;height:auto';
          svg.parentNode.replaceChild(img, svg);
        } catch(e2) {}
      }));
    }
    // KaTeX → PNG
    await replaceKatexWithImages(clone, 560);
    // Code blocks — text-based (editable in Word)
    if (codeBlockFormat === 'p') {
      // Each line as top-level <p> for docshift (ignores <br>)
      clone.querySelectorAll('pre').forEach(pre => {
        const code = pre.querySelector('code');
        if (!code) return;
        const lineHtmls = code.innerHTML.split('\n').filter(l => l.trim());
        if (lineHtmls.length <= 1) return;
        const frag = document.createDocumentFragment();
        lineHtmls.forEach(lineHtml => {
          const p = document.createElement('p');
          p.innerHTML = lineHtml.trim();
          p.style.cssText = "background-color:#f5f5f5;font-family:'Courier New',monospace;font-size:9pt;padding-left:10pt;padding-right:10pt";
          frag.appendChild(p);
        });
        pre.parentNode.replaceChild(frag, pre);
      });
    } else {
      // <pre><code> with <br> for Word HTML (.doc)
      clone.querySelectorAll('pre > code').forEach(codeEl => {
        if (codeEl.innerHTML.includes('\n')) {
          codeEl.innerHTML = codeEl.innerHTML.replace(/\n/g, '<br>');
          codeEl.style.whiteSpace = 'pre';
        }
      });
    }
    // Tables — keep as HTML (editable, with inline styles for Word compatibility)
    clone.querySelectorAll('table').forEach(t => {
      t.style.cssText = (t.style.cssText || '') + ';border-collapse:collapse;width:100%';
      t.querySelectorAll('td, th').forEach(c => {
        c.style.cssText = (c.style.cssText || '') + ';border:1px solid #ccc;padding:4pt 6pt;text-align:left;vertical-align:top';
      });
      t.querySelectorAll('th').forEach(h => {
        h.style.cssText = (h.style.cssText || '') + ';background-color:#eee;font-weight:700';
      });
    });
    inner = clone.innerHTML;
  } else if (htmlFrame.style.display !== 'none') {
    try {
      const doc = htmlFrame.contentDocument || htmlFrame.contentWindow?.document;
      inner = doc?.body?.innerHTML || '';
    } catch(e) { inner = escapeHtml(getOriginalContent()); }
  } else {
    inner = escapeHtml(getOriginalContent());
  }
  return inner.replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
}

async function getContentAsWordHtml() {
  const clean = await getCleanContentForExport();
  const hasKatex = clean.includes('class="katex');
  let katexStyle = '';
  if (hasKatex) { try { katexStyle = await getKaTeXStyle(); } catch(e) {} }
  const hasCode = clean.includes('class="hljs');
  let hljsStyle = '';
  if (hasCode) { try { hljsStyle = await getHighlightStyle(); } catch(e) {} }
  const wordHeader = `\
<html xmlns:o="urn:schemas-microsoft-com:office:office" \
xmlns:w="urn:schemas-microsoft-com:office:word" \
xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
@page{size:A4;margin:2cm;mso-page-orientation:portrait}
body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.5;color:#222;max-width:21cm;margin:0 auto;padding:20px}
h1{font-size:18pt;font-weight:700;border-bottom:2px solid #333;padding-bottom:6pt;margin-top:18pt}
h2{font-size:15pt;font-weight:700;border-bottom:1px solid #999;padding-bottom:4pt;margin-top:16pt}
h3{font-size:13pt;font-weight:700;margin-top:14pt}
h4{font-size:11pt;font-weight:700}
p{margin:0 0 6pt}
pre{font-family:"Courier New",monospace;font-size:9pt;background:#f5f5f5;padding:8pt 10pt;border:1px solid #ddd;page-break-inside:avoid}
pre code{font-family:"Courier New",monospace;font-size:9pt;background:none;padding:0;white-space:pre}
code{font-family:"Courier New",monospace;font-size:9pt;background:#f5f5f5;padding:0 3pt}
table{border-collapse:collapse;width:100%;margin:8pt 0;page-break-inside:avoid}
td,th{border:1px solid #ccc;padding:4pt 6pt;text-align:left;vertical-align:top}
th{background:#eee;font-weight:700}
img{max-width:100%;height:auto;-ms-interpolation-mode:bicubic;page-break-inside:avoid}
.mermaid img{display:block;margin:0 auto;page-break-inside:avoid}
blockquote{margin:8pt 16pt;padding:4pt 12pt;border-left:3pt solid #999;color:#555;page-break-inside:avoid}
a{color:#0563C1;text-decoration:underline}
.mermaid{page-break-inside:avoid}
${katexStyle}
${hljsStyle}
</style></head>`;
  return `${wordHeader}<body>${clean}</body></html>`;
}

async function getContentAsDoc() { return getContentAsWordHtml(); }

async function getContentAsDocx() {
  const html = await getContentAsWordHtml();
  if (typeof htmlDocx === 'undefined') {
    await loadScript('https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.min.js');
  }
  return htmlDocx.asBlob(html, { orientation: 'portrait' });
}

// Extract HTML from a .docx generated by html-docx-js (word/afchunk.mht → MHT → quoted-printable)
async function extractHtmlFromDocx(arrayBuffer) {
  if (typeof JSZip === 'undefined') {
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
  }
  const zip = await JSZip.loadAsync(arrayBuffer);
  const mhtFile = zip.file('word/afchunk.mht');
  if (!mhtFile) { _d('[MHT] word/afchunk.mht not found'); return null; }
  let raw = await mhtFile.async('string');
  _d('[MHT] raw MHT length=' + raw.length);

  // Split MHT into parts by boundary
  var boundaryMatch = raw.match(/boundary="?([^";\r\n]+)"?/);
  if (!boundaryMatch) { _d('[MHT] no boundary found'); return null; }
  var boundary = boundaryMatch[1];
  _d('[MHT] boundary=' + boundary);

  var parts = raw.split('--' + boundary);
  var htmlPart = null;
  var cidMap = {};

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part.trim() === '' || part.trim() === '--') continue;
    var cidMatch = part.match(/Content-ID:\s*<?([^>\r\n]+)>?/i);
    var locMatch = part.match(/Content-Location:\s*(\S+)/i);

    if (/Content-Type:\s*text\/html/i.test(part)) {
      var hEnd = part.indexOf('\r\n\r\n');
      if (hEnd < 0) hEnd = part.indexOf('\n\n');
      if (hEnd >= 0) {
        htmlPart = part.substring(hEnd).trim();
        htmlPart = htmlPart.replace(/=([0-9A-Fa-f]{2})/g, function(_, h) { return String.fromCharCode(parseInt(h, 16)); });
        htmlPart = htmlPart.replace(/=\r?\n/g, '');
        _d('[MHT] HTML part length=' + htmlPart.length);
      }
    } else if (/Content-Type:\s*image\//i.test(part)) {
      var hEnd = part.indexOf('\r\n\r\n');
      if (hEnd < 0) hEnd = part.indexOf('\n\n');
      if (hEnd >= 0) {
        var imgData = part.substring(hEnd).trim().replace(/=\r?\n/g, '');
        var contentType = 'image/png';
        var ctMatch = part.match(/Content-Type:\s*(image\/[^\s;]+)/i);
        if (ctMatch) contentType = ctMatch[1];
        var dataUrl = 'data:' + contentType + ';base64,' + imgData;
        if (cidMatch) cidMap[cidMatch[1]] = dataUrl;
        if (locMatch) cidMap[locMatch[1]] = dataUrl;
        _d('[MHT] image: type=' + contentType + ' cid=' + (cidMatch ? cidMatch[1] : 'none'));
      }
    }
  }

  if (!htmlPart) { _d('[MHT] no HTML part found'); return null; }

  // Replace cid: and file:/// references with data URLs
  var keys = Object.keys(cidMap);
  _d('[MHT] replacing ' + keys.length + ' cid references');
  for (var j = 0; j < keys.length; j++) {
    htmlPart = htmlPart.split(keys[j]).join(cidMap[keys[j]]);
  }

  _d('[MHT] final HTML length=' + htmlPart.length);
  return htmlPart;
}

// ===== KaTeX CSS cache (fetched once from CDN for export) =====
let _katexStyle = null;
async function getKaTeXStyle() {
  if (_katexStyle) return _katexStyle;
  try {
    const resp = await fetch('lib/katex-0.16.11.min.css');
    _katexStyle = await resp.text();
  } catch(e) {
    _katexStyle = '.katex{font:normal 1.21em "Times New Roman",serif;line-height:1.2;white-space:nowrap}.katex-display{display:block;margin:1em 0;text-align:center}.katex .katex-mathml{position:absolute;clip:rect(1px,1px,1px,1px);padding:0;border:0;height:1px;width:1px;overflow:hidden}';
  }
  return _katexStyle;
}

// ===== Highlight.js CSS cache (for Word export) =====
let _highlightStyle = null;
async function getHighlightStyle() {
  if (_highlightStyle) return _highlightStyle;
  try {
    const resp = await fetch('lib/highlight-github.min.css');
    _highlightStyle = await resp.text();
  } catch(e) {
    _highlightStyle = '';
  }
  return _highlightStyle;
}

// ===== Image Export (html2canvas) =====
async function ensureHtml2Canvas() {
  if (typeof html2canvas === 'undefined') {
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  }
}

async function exportAsImage(mode) {
  await ensureHtml2Canvas();
  const target = mdContent.style.display !== 'none' ? mdContent : contentArea;
  if (!target || target.style.display === 'none') { showToast('没有可导出的内容'); return; }
  showToast('正在生成图片...');

  if (mode === 'full-png') {
    const canvas = await html2canvas(target, {
      useCORS: true, scale: 2, backgroundColor: '#ffffff',
      logging: false, allowTaint: false,
    });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.fileName || 'export').replace(/\.[^.]+$/, '') + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 PNG: ${a.download}`);
  } else if (mode === 'full-svg') {
    const clone = target.cloneNode(true);
    // Convert copy buttons to download links (JS doesn't run in SVG foreignObject)
    clone.querySelectorAll('.copy-btn').forEach(el => {
      const code = el.getAttribute('data-code') || el.nextElementSibling?.textContent || '';
      const a = document.createElement('a');
      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(code);
      a.download = 'code.txt';
      a.textContent = '📋 下载';
      a.className = 'copy-btn';
      a.style.cssText = 'position:absolute;bottom:6px;right:6px;background:#e8e8e8;border:1px solid #ccc;border-radius:4px;padding:3px 10px;font-size:11px;color:#555;cursor:pointer;text-decoration:none;z-index:10';
      a.title = '下载代码片段';
      el.parentNode.replaceChild(a, el);
    });
    clone.querySelectorAll('pre > span').forEach(el => { if (el.style.position === 'absolute') el.remove(); });
    // Convert KaTeX elements to PNG (foreignObject lacks KaTeX CSS+fonts)
    await replaceKatexWithImages(clone);
    // Measure actual content height to avoid clipping
    const measureDiv = document.createElement('div');
    measureDiv.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;font-family:-apple-system,sans-serif;line-height:1.7;color:#333;background:#fff';
    const contentClone = clone.cloneNode(true);
    measureDiv.appendChild(contentClone);
    document.body.appendChild(measureDiv);
    const actualHeight = measureDiv.scrollHeight + 40;
    document.body.removeChild(measureDiv);
    const ns = 'http://www.w3.org/1999/xhtml';
    const xhtml = new XMLSerializer().serializeToString(clone);
    const svgH = Math.max(actualHeight, 100);
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${800}" height="${svgH}" viewBox="0 0 800 ${svgH}">
<foreignObject width="100%" height="100%" x="0" y="0">
<div xmlns="${ns}" style="font-family:-apple-system,sans-serif;line-height:1.7;padding:20px;color:#333;background:#fff;max-width:800px">${xhtml}</div>
</foreignObject></svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.fileName || 'export').replace(/\.[^.]+$/, '') + '.svg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 SVG: ${a.download}`);
  } else if (mode === 'sections') {
    const sections = [];
    const headings = target.querySelectorAll('h1,h2,h3');
    if (headings.length < 2) { showToast('标题太少，请使用"整页截图"'); return; }
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      let endEl = i + 1 < headings.length ? headings[i + 1] : null;
      const parts = [];
      let el = h;
      while (el && el !== endEl) {
        parts.push(el);
        el = el.nextElementSibling;
      }
      if (parts.length) sections.push({ title: h.textContent.trim(), elements: parts });
    }
    if (typeof JSZip === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
    }
    const zip = new JSZip();
    for (let i = 0; i < sections.length; i++) {
      const wrap = document.createElement('div');
      wrap.style.background = '#ffffff'; wrap.style.padding = '20px';
      wrap.style.fontFamily = '-apple-system,sans-serif'; wrap.style.color = '#333';
      sections[i].elements.forEach(el => wrap.appendChild(el.cloneNode(true)));
      document.body.appendChild(wrap);
      const canvas = await html2canvas(wrap, { useCORS: true, scale: 2, backgroundColor: '#ffffff', logging: false });
      document.body.removeChild(wrap);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const safeName = sections[i].title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
      zip.file(`${i + 1}. ${safeName}.png`, blob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.fileName || 'export').replace(/\.[^.]+$/, '') + '-分段截图.zip';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${sections.length} 张分段截图`);
  } else if (mode === 'pdf') {
    // Export as PDF via hidden iframe + print
    var content = '';
    if (state.fileType === 'html' && htmlFrame.style.display !== 'none') {
      try {
        var doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
        content = doc.body ? doc.body.innerHTML : '';
      } catch(e) { content = target.innerHTML; }
    } else {
      content = target.innerHTML;
    }
    // Collect stylesheets and set base URL for relative paths (KaTeX fonts)
    var baseUrl = window.location.href.replace(/[/][^/]*$/, '/');
    var styles = '<base href="' + baseUrl + '">\n';
    styles += Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(function(el) { return el.outerHTML; }).join('\n');
    var htmlDoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + (state.fileName || '导出') + '</title>' + styles + '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#333;line-height:1.7}img{max-width:100%;height:auto}pre{white-space:pre-wrap;word-break:break-all}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px}th{background:#f5f5f5}@media print{body{padding:0;margin:0 auto}pre{white-space:pre-wrap}}</style></head><body>' + content + '</body></html>';
    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:none;';
    document.body.appendChild(iframe);
    var iDoc = iframe.contentDocument || iframe.contentWindow.document;
    iDoc.open();
    iDoc.write(htmlDoc);
    iDoc.close();
    iframe.onload = function() {
      setTimeout(function() {
        try { iframe.contentWindow.print(); } catch(e) { showToast('打印失败'); }
        setTimeout(function() { document.body.removeChild(iframe); }, 1000);
      }, 800);
    };
    showToast('请在打印对话框中选择"另存为 PDF"');
  }
}

// ===== Check if current file type supports text export =====
function isTextExportable() {
  return !(state.fileType === 'pdf' || state.fileType === 'img');
}

// ===== Save Sheet =====
function showSaveSheet() {
  const isTable = state.fileType === 'xlsx' || state.fileType === 'csv' || state.fileType === 'xls' || state.fileType === 'et';
  const csvBtn = isTable ? `<button class="theme-opt save-opt" data-ext=".csv" data-mime="text/csv">📊 CSV</button>` : '';
  // Disable text-based save options for non-text-exportable files
  const textDisabled = isTextExportable() ? '' : ' opacity:0.5;pointer-events:none';
  const textTitle = isTextExportable() ? '' : ' title="当前文件类型不支持导出为文本格式"';
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">💾 另存为</div>
    <div class="sheet-group">
      <div class="sheet-label">文档格式</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <button class="theme-opt save-opt" data-ext=".txt" data-mime="text/plain"${textDisabled}${textTitle}>📄 纯文本</button>
        <button class="theme-opt save-opt" data-ext=".md" data-mime="text/markdown"${textDisabled}${textTitle}>📝 Markdown</button>
        <button class="theme-opt save-opt" data-ext=".html" data-mime="text/html"${textDisabled}${textTitle}>🌐 HTML</button>
        ${csvBtn}
        <button class="theme-opt save-opt" data-ext=".doc" data-mime="application/msword"${textDisabled}${textTitle}>📘 Word</button>
        <button class="theme-opt save-opt" data-ext=".docx" data-mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document"${textDisabled}${textTitle}>📗 Word (.docx)</button>
      </div>
    </div>
    <div class="sheet-group">
      <div class="sheet-label">图片/导出</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <button class="theme-opt img-export" data-mode="full-png">🖼️ PNG 截图</button>
        <button class="theme-opt img-export" data-mode="full-svg">🎨 SVG 矢量</button>
        <button class="theme-opt img-export" data-mode="pdf">📕 导出 PDF</button>
        <button class="theme-opt img-export" data-mode="sections">📑 按标题分段</button>
      </div>
    </div>`;
  openSheet(html);
  setTimeout(() => {
    document.querySelectorAll('.save-opt').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ext = btn.dataset.ext;
        if (ext && !isTextExportable()) {
          showToast('⚠️ 当前文件类型不支持导出为文本格式，请使用 PNG/SVG 截图');
          return;
        }
        closeSheet();
        const mime = btn.dataset.mime;
        if (ext === '.docx') {
          showToast('正在生成 DOCX...');
          getContentAsDocx().then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (state.fileName || 'untitled').replace(/\.[^.]+$/, '') + '.docx';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast(`已保存为 ${a.download}`);
          }).catch(e => showToast('DOCX 生成失败: ' + (e.message || '')));
          return;
        }
        if (ext === '.doc') {
          showToast('正在生成 Word 文档...');
          getContentAsDoc().then(content => {
            saveContentAs(content, state.fileName || 'untitled', '.doc', 'application/msword');
            showToast('已保存 Word 文档');
          }).catch(e => showToast('Word 生成失败: ' + (e.message || '')));
          return;
        }
        if (ext === '.csv' && !isTable) {
          showToast('⚠️ 当前文件类型不支持导出 CSV');
          return;
        }
        let content = getOriginalContent();
        if (!content) { showToast('没有可保存的内容'); return; }
        if (ext === '.html') content = await getContentAsHtml();
        else if (ext === '.md') content = getContentAsMd();
        else if (ext === '.csv') content = getContentAsCsv();
        saveContentAs(content, state.fileName || 'untitled', ext, mime);
      });
    });
    document.querySelectorAll('.img-export').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        // PDF print mode: not supported for binary-only file types
        if (mode === 'pdf' && !isTextExportable() && state.fileType !== 'img') {
          showToast('⚠️ PDF 打印不支持当前文件类型');
          return;
        }
        // Section export requires headings (not available for img/pdf)
        if (mode === 'sections' && !isTextExportable()) {
          showToast('⚠️ 分段截图不支持当前文件类型');
          return;
        }
        closeSheet();
        exportAsImage(btn.dataset.mode);
      });
    });
  }, 50);
}
