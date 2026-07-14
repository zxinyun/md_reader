// ===== Search =====
let searchState = { query: '', marks: [], currentIdx: -1 };

async function buildXlsxSheetForSearch(sheetIdx) {
  const sheetNames = window._xlsxSheetNames || [];
  const wb = window._xlsxWorkbook;
  if (!wb || sheetIdx >= sheetNames.length) return;
  const wrap = document.getElementById(`xlsx-wrap-${sheetIdx}`);
  if (!wrap || wrap._xlsxFullBuilt) return;

  const name = sheetNames[sheetIdx];
  const sheet = wb.Sheets[name];
  const ref = sheet['!ref'];
  if (!ref) { wrap._xlsxFullBuilt = true; return; }

  let range;
  try { range = XLSX.utils.decode_range(ref); } catch(e) { wrap._xlsxFullBuilt = true; return; }
  const totalRows = range.e.r - range.s.r + 1;
  if (totalRows <= 1) { wrap._xlsxFullBuilt = true; return; }

  const MAX_SEARCH_ROWS = 5000;
  const CHUNK = 2000;
  const hdr = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = sheet[addr];
    hdr.push(cell ? String(cell.w ?? cell.v ?? cell.t ?? '') : '');
  }

  const rowLimit = Math.min(totalRows - 1, MAX_SEARCH_ROWS);
  const data = [];
  let nextRow = range.s.r + 1;
  const endRow = range.s.r + rowLimit;

  while (nextRow <= endRow) {
    const batchEnd = Math.min(nextRow + CHUNK - 1, endRow);
    for (let r = nextRow; r <= batchEnd; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        row.push(cell ? String(cell.w ?? cell.v ?? cell.t ?? '') : '');
      }
      data.push(row);
    }
    nextRow = batchEnd + 1;
    await new Promise(r => setTimeout(r, 0));
  }

  try {
    let full = '<div class="csv-table-wrap" style="max-height:50vh;overflow:auto"><table><thead><tr>';
    hdr.forEach(text => {
      full += `<th style="border:1px solid var(--border);padding:6px 10px;white-space:nowrap;background:var(--bg-code);font-weight:600;position:sticky;top:0;z-index:1;min-width:50px">${escapeHtml(text) || '&nbsp;'}</th>`;
    });
    full += '</tr></thead><tbody>';
    data.forEach(row => {
      full += '<tr>';
      row.forEach(cell => {
        const txt = cell || '';
        full += `<td style="border:1px solid var(--border);padding:4px 10px;white-space:nowrap;min-width:50px;max-width:400px;overflow:hidden;text-overflow:ellipsis" class="xlsx-cell" data-full="${escapeAttr(txt)}">${escapeHtml(txt) || '&nbsp;'}</td>`;
      });
      full += '</tr>';
    });
    full += '</tbody></table></div>';
    const rowNote = data.length < totalRows - 1 ? ` (前${data.length}行)` : '';
    full += `<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">工作表: ${escapeHtml(name)} — ${data.length} 行 × ${hdr.length} 列${rowNote}</div>`;
    wrap.innerHTML = full;
    wrap._xlsxFullBuilt = true;
    wrap.dataset.rendered = '1';
    wrap.querySelectorAll('.xlsx-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const fulltxt = cell.dataset.full || cell.textContent;
        if (fulltxt) showCellContent(fulltxt);
      });
      cell.style.cursor = 'pointer';
    });
  } catch(e) {
    console.error('buildXlsxSheetForSearch error:', e);
    wrap._xlsxFullBuilt = true;
    wrap.innerHTML = `<div style="padding:16px;color:var(--text-secondary);font-size:13px">搜索索引不可用 (${escapeHtml(e.message || '')})</div>`;
  }
}

async function rebuildXlsxForSearch() {
  // Only rebuild the currently visible sheet
  const visibleSheet = mdContent.querySelector('.xlsx-sheet:not([style*="display:none"])');
  if (visibleSheet) {
    const idx = parseInt(visibleSheet.dataset.sheet);
    if (!isNaN(idx)) await buildXlsxSheetForSearch(idx);
  }
}

$('actSearch').addEventListener('click', async () => {
  if (!state.fileContent) { showToast('没有打开的文件'); return; }
  const bar = $('searchBar');
  if (bar.style.display === 'none') {
    if (state.fileType === 'xlsx') {
      showToast('正在构建搜索索引...');
      await new Promise(r => setTimeout(r, 0));
      try {
        await rebuildXlsxForSearch();
      } catch(e) {
        showToast('搜索索引构建失败: ' + (e.message || ''));
      }
    }
    bar.style.display = '';
    $('searchInput').focus();
    $('searchInput').value = searchState.query || '';
    if (searchState.query) performSearch(searchState.query);
  } else {
    bar.style.display = 'none';
    clearHighlights();
  }
});

function searchRoot() {
  if (state.fileType === 'html' && htmlFrame.style.display !== 'none') {
    // Use cached document reference from onload
    const doc = htmlFrame._searchDoc;
    if (doc && doc.body) return doc.body;
    // Fallback: try direct access (may throw for cross-origin)
    try { if (htmlFrame.contentDocument) return htmlFrame.contentDocument.body; } catch(e) {}
    return null; // iframe not loaded yet or cross-origin
  }
  if (mdContent.style.display !== 'none') return mdContent;
  return null;
}

function searchWin() {
  if (state.fileType === 'html' && htmlFrame.style.display !== 'none' && htmlFrame.contentWindow) {
    return htmlFrame.contentWindow;
  }
  return window;
}

function injectSearchStyles(doc) {
  if (doc.head && !doc.getElementById('reader-search-style')) {
    const s = doc.createElement('style');
    s.id = 'reader-search-style';
    s.textContent = '.search-highlight{background:#ffdd57!important;color:#1a1a2e!important;border-radius:2px;padding:0 1px}.search-active{background:#ff6b35!important;color:#fff!important;border-radius:2px;padding:0 1px}';
    doc.head.appendChild(s);
  }
}

function performSearch(query) {
  clearHighlights();
  searchState.query = query;
  if (!query.trim()) { $('searchCount').textContent = '0'; return; }

  const root = searchRoot();
  if (!root) { $('searchCount').textContent = '0'; return; }

  if (state.fileType === 'html' && htmlFrame.contentDocument) injectSearchStyles(htmlFrame.contentDocument);

  // For XLSX: use pre-built full HTML tables (only visible sheet has full data)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const q = query.toLowerCase();
  const marks = [];

  textNodes.forEach(node => {
    const text = node.textContent;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(q);
    if (idx === -1) return;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      marks.push(mark);
      last = idx + query.length;
      idx = lower.indexOf(q, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });

  // For XLSX: also search raw data to find results in other sheets
  let totalMarks = marks.length;
  let otherSheetCount = 0;
  if (state.fileType === 'xlsx') {
    const wb = window._xlsxWorkbook;
    const sheetNames = window._xlsxSheetNames || [];
    if (wb && sheetNames.length > 1) {
      const visibleIdx = (() => {
        const vs = mdContent.querySelector('.xlsx-sheet:not([style*="display:none"])');
        return vs ? parseInt(vs.dataset.sheet) : -1;
      })();
      let foundOthers = 0;
      for (let si = 0; si < sheetNames.length; si++) {
        if (si === visibleIdx) continue;
        const wrap = document.getElementById(`xlsx-wrap-${si}`);
        // Check if already built (full HTML table)
        if (wrap && wrap._xlsxFullBuilt) {
          // Count existing marks from this sheet (from the overall TreeWalker above)
          continue;
        }
        // Search raw SheetJS data for this sheet
        const sheet = wb.Sheets[sheetNames[si]];
        const ref = sheet['!ref'];
        if (!ref) continue;
        let range;
        try { range = XLSX.utils.decode_range(ref); } catch(e) { continue; }
        const MAX_ROWS = 5000;
        const endR = Math.min(range.e.r, range.s.r + MAX_ROWS);
        let found = false;
        for (let r = range.s.r; r <= endR && !found; r++) {
          for (let c = range.s.c; c <= range.e.c && !found; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = sheet[addr];
            const text = cell ? String(cell.w ?? cell.v ?? cell.t ?? '') : '';
            if (text.toLowerCase().indexOf(q) !== -1) {
              foundOthers++;
              found = true;
            }
          }
        }
      }
      otherSheetCount = foundOthers;
    }
  }
  totalMarks += otherSheetCount;

  searchState.marks = marks;
  searchState.currentIdx = marks.length > 0 ? 0 : -1;
  $('searchCount').textContent = totalMarks ? (marks.length ? `1/${totalMarks}` : `0/${totalMarks}`) : '0';
  if (marks.length) {
    marks[0].className = 'search-active';
    marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (otherSheetCount > 0) {
    // Results only in other sheets — switch to first match
    switchToNextMatchSheet(query);
  }
}

async function switchToNextMatchSheet(query) {
  const wb = window._xlsxWorkbook;
  const sheetNames = window._xlsxSheetNames || [];
  if (!wb) return;

  const visibleIdx = (() => {
    const vs = mdContent.querySelector('.xlsx-sheet:not([style*="display:none"])');
    return vs ? parseInt(vs.dataset.sheet) : -1;
  })();

  const q = query.toLowerCase();
  // Find the first sheet (other than visible) that has a match
  for (let si = 0; si < sheetNames.length; si++) {
    if (si === visibleIdx) continue;
    const sheet = wb.Sheets[sheetNames[si]];
    const ref = sheet['!ref'];
    if (!ref) continue;
    let range;
    try { range = XLSX.utils.decode_range(ref); } catch(e) { continue; }
    const MAX_ROWS = 5000;
    const endR = Math.min(range.e.r, range.s.r + MAX_ROWS);
    let found = false;
    for (let r = range.s.r; r <= endR && !found; r++) {
      for (let c = range.s.c; c <= range.e.c && !found; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        const text = cell ? String(cell.w ?? cell.v ?? cell.t ?? '') : '';
        if (text.toLowerCase().indexOf(q) !== -1) {
          found = true;
        }
      }
    }
    if (found) {
      await buildXlsxSheetForSearch(si);
      const tab = mdContent.querySelector(`.xlsx-sheet-tab[data-idx="${si}"]`);
      if (tab) tab.click();
      // Re-run search on the new sheet's full HTML
      performSearch(searchState.query);
      return;
    }
  }
}

function clearHighlights() {
  document.querySelectorAll('mark.search-highlight, mark.search-active').forEach(m => {
    const p = m.parentNode;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();
  });
  searchState = { query: '', marks: [], currentIdx: -1 };
  $('searchCount').textContent = '0';
}

function navigateSearch(delta) {
  if (!searchState.marks.length) {
    if (state.fileType === 'xlsx' && searchState.query) {
      switchToNextMatchSheet(searchState.query);
    }
    return;
  }
  if (searchState.currentIdx >= 0 && searchState.currentIdx < searchState.marks.length) {
    searchState.marks[searchState.currentIdx].className = 'search-highlight';
  }
  const total = searchState.marks.length;
  const nextIdx = ((searchState.currentIdx + delta) % total + total) % total;
  const mark = searchState.marks[nextIdx];
  if (state.fileType === 'xlsx') {
    const sheet = mark.closest('.xlsx-sheet');
    if (sheet && sheet.style.display === 'none') {
      const idx = parseInt(sheet.dataset.sheet);
      if (!isNaN(idx)) {
        // Build the target sheet's full HTML, then switch
        buildXlsxSheetForSearch(idx).then(() => {
          const tab = mdContent.querySelector(`.xlsx-sheet-tab[data-idx="${idx}"]`);
          if (tab) tab.click();
          // Re-run search so marks are created in the now-visible sheet
          performSearch(searchState.query);
          setTimeout(() => navigateSearchTo(delta > 0 ? 0 : searchState.marks.length - 1), 100);
        });
        return;
      }
    }
  }
  searchState.currentIdx = nextIdx;
  mark.className = 'search-active';
  $('searchCount').textContent = `${searchState.currentIdx + 1}/${total}`;
  try { mark.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
}

function navigateSearchTo(idx) {
  if (!searchState.marks.length) return;
  if (searchState.currentIdx >= 0 && searchState.currentIdx < searchState.marks.length) {
    searchState.marks[searchState.currentIdx].className = 'search-highlight';
  }
  searchState.currentIdx = idx;
  const mark = searchState.marks[idx];
  mark.className = 'search-active';
  $('searchCount').textContent = `${idx + 1}/${searchState.marks.length}`;
  try { mark.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
}

$('searchInput').addEventListener('input', (e) => {
  performSearch(e.target.value);
});

$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigateSearch(e.shiftKey ? -1 : 1);
  }
  if (e.key === 'Escape') { $('searchClose').click(); }
});

$('searchPrev').addEventListener('click', () => navigateSearch(-1));
$('searchNext').addEventListener('click', () => navigateSearch(1));

$('searchClose').addEventListener('click', () => {
  clearHighlights();
  $('searchBar').style.display = 'none';
});
