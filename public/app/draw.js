// ===== Drawing / Annotation =====
let drawings = [];
let currentPath = null;
let drawMode = 'pen';
let drawColor = '#e74c3c';
let drawWidth = 4;
let isDrawing = false;
let drawVisible = true;
let selectedDrawIdx = -1;
let isDraggingText = false;
let textDragOffX = 0, textDragOffY = 0;
const drawOverlay = document.getElementById('drawOverlay');
const drawCanvas = document.getElementById('drawCanvas');
const drawCtx = drawCanvas.getContext('2d');
const drawToolbar = document.getElementById('drawToolbar');
const drawCursor = document.getElementById('drawCursor');
const textControls = document.getElementById('textControls');
let drawHistory = [[]];
let drawHistoryIdx = 0;

function saveDrawSnapshot() {
  drawHistory = drawHistory.slice(0, drawHistoryIdx + 1);
  drawHistory.push([...drawings]);
  drawHistoryIdx++;
}

function undoDraw() {
  if (drawHistoryIdx <= 0) return;
  deselectText();
  drawHistoryIdx--;
  drawings = [...drawHistory[drawHistoryIdx]];
  redrawDrawings(true);
}

function redoDraw() {
  if (drawHistoryIdx >= drawHistory.length - 1) return;
  deselectText();
  drawHistoryIdx++;
  drawings = [...drawHistory[drawHistoryIdx]];
  redrawDrawings(true);
}

function positionCanvas() {
  const cr = contentArea.getBoundingClientRect();
  drawOverlay.style.left = cr.left + 'px';
  drawOverlay.style.top = cr.top + 'px';
  drawOverlay.style.width = cr.width + 'px';
  drawOverlay.style.height = cr.height + 'px';
  const dpr = window.devicePixelRatio || 1;
  const w = cr.width, h = cr.height;
  if (drawCanvas.width !== w * dpr || drawCanvas.height !== h * dpr) {
    drawCanvas.width = w * dpr;
    drawCanvas.height = h * dpr;
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.scale(dpr, dpr);
  }
}

function getTextBounds(item) {
  drawCtx.font = `bold ${item.fontSize}px sans-serif`;
  const m = drawCtx.measureText(item.content);
  return { w: m.width + 4, h: item.fontSize + 4 };
}

function drawShape(ctx, item, sl, st) {
  const sx = item.start.x - sl;
  const sy = item.start.y - st;
  const ex = item.end.x - sl;
  const ey = item.end.y - st;
  ctx.beginPath();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = item.width;
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  if (item.shape === 'line') {
    ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  } else if (item.shape === 'arrow') {
    const angle = Math.atan2(ey - sy, ex - sx);
    const len = Math.hypot(ex - sx, ey - sy);
    const headLen = Math.min(18, len * 0.35);
    const headAngle = 0.4;
    ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - headLen * Math.cos(angle - headAngle), ey - headLen * Math.sin(angle - headAngle));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - headLen * Math.cos(angle + headAngle), ey - headLen * Math.sin(angle + headAngle));
    ctx.stroke();
  } else if (item.shape === 'rect') {
    ctx.rect(Math.min(sx, ex), Math.min(sy, ey), Math.abs(ex - sx), Math.abs(ey - sy)); ctx.stroke();
  } else if (item.shape === 'ellipse') {
    const cx = (sx + ex) / 2, cy = (sy + ey) / 2;
    const rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
    if (rx > 0 && ry > 0) { ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
}

function drawTextItem(ctx, item, sl, st, isSelected) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const bx = item.x - sl - 2, by = item.y - st - 2;
  const b = getTextBounds(item);
  if (isSelected) {
    ctx.fillStyle = 'rgba(108,92,231,0.12)';
    ctx.fillRect(bx, by, b.w, b.h);
    ctx.strokeStyle = 'var(--primary)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bx, by, b.w, b.h);
    ctx.setLineDash([]);
  }
  ctx.fillStyle = item.color;
  ctx.font = `bold ${item.fontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(item.content, item.x - sl, item.y - st);
  ctx.strokeStyle = item.color;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, b.w, b.h);
}

function redrawDrawings(forceShow) {
  if (!drawOverlay.style.display || drawOverlay.style.display === 'none') return;
  const w = drawOverlay.offsetWidth;
  const h = drawOverlay.offsetHeight;
  if (!w || !h) return;
  drawCtx.clearRect(0, 0, w, h);
  if (!drawVisible && !forceShow) return;
  const st = contentArea.scrollTop;
  const sl = contentArea.scrollLeft;
  for (let i = 0; i < drawings.length; i++) {
    const item = drawings[i];
    if (item.type === 'shape') {
      drawShape(drawCtx, item, sl, st);
    } else if (item.type === 'text') {
      drawTextItem(drawCtx, item, sl, st, i === selectedDrawIdx);
    } else {
      drawCtx.beginPath();
      if (item.mode === 'eraser') {
        drawCtx.globalCompositeOperation = 'destination-out';
        drawCtx.strokeStyle = 'rgba(0,0,0,1)';
      } else if (item.mode === 'highlighter') {
        drawCtx.globalCompositeOperation = 'source-over';
        drawCtx.strokeStyle = '#ffeb3b';
        drawCtx.globalAlpha = 0.22;
      } else {
        drawCtx.globalCompositeOperation = 'source-over';
        drawCtx.strokeStyle = item.color;
        drawCtx.globalAlpha = 1;
      }
      drawCtx.lineWidth = item.width;
      drawCtx.lineCap = 'round';
      drawCtx.lineJoin = 'round';
      let first = true;
      for (const p of item.points) {
        const sx = p.x - sl;
        const sy = p.y - st;
        if (sy < -200 || sy > h + 200 || sx < -200 || sx > w + 200) { first = true; continue; }
        if (first) { drawCtx.moveTo(sx, sy); first = false; }
        else drawCtx.lineTo(sx, sy);
      }
      drawCtx.stroke();
    }
  }
  drawCtx.globalCompositeOperation = 'source-over';
  drawCtx.globalAlpha = 1;
  drawCtx.setLineDash([]);
}

function setupPathContext(mode, color, width) {
  if (mode === 'eraser') {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    drawCtx.lineWidth = width * 3 + 10;
  } else if (mode === 'highlighter') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = '#ffeb3b';
    drawCtx.globalAlpha = 0.22;
    drawCtx.lineWidth = Math.max(width * 3, 12);
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = color;
    drawCtx.globalAlpha = 1;
    drawCtx.lineWidth = width;
  }
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
}

function hitTestText(docX, docY) {
  const sl = contentArea.scrollLeft, st = contentArea.scrollTop;
  for (let i = drawings.length - 1; i >= 0; i--) {
    const item = drawings[i];
    if (item.type !== 'text') continue;
    const b = getTextBounds(item);
    const bx = item.x - sl - 2, by = item.y - st - 2;
    if (docX >= bx + sl && docX <= bx + sl + b.w && docY >= by + st && docY <= by + st + b.h) return i;
  }
  return -1;
}

function updateTextControls() {
  if (selectedDrawIdx >= 0 && drawings[selectedDrawIdx] && drawings[selectedDrawIdx].type === 'text') {
    const t = drawings[selectedDrawIdx];
    textControls.style.display = 'inline-flex';
    $('textSizeDisplay').textContent = t.fontSize;
    $('drawColor').value = t.color;
  } else {
    textControls.style.display = 'none';
  }
}

function deselectText() {
  if (selectedDrawIdx >= 0) {
    selectedDrawIdx = -1;
    isDraggingText = false;
    textControls.style.display = 'none';
    redrawDrawings(true);
  }
}

async function startDraw(e) {
  if (!drawOverlay.classList.contains('active')) return;
  e.preventDefault();
  const cr = contentArea.getBoundingClientRect();
  const x = e.clientX - cr.left;
  const y = e.clientY - cr.top;
  const docX = x + contentArea.scrollLeft;
  const docY = y + contentArea.scrollTop;
  // Hit test existing text (any mode)
  const hit = hitTestText(docX, docY);
  if (hit >= 0) {
    selectedDrawIdx = hit;
    const t = drawings[hit];
    textDragOffX = docX - t.x;
    textDragOffY = docY - t.y;
    isDraggingText = true;
    updateTextControls();
    redrawDrawings(true);
    return;
  }
  deselectText();
  // Text mode: create new
  if (drawMode === 'text') {
    const text = await showPromptDialog({ title: '输入标注文字', placeholder: '', defaultValue: '' });
    if (text && text.trim()) {
      const fontSize = drawWidth * 3 + 10;
      drawings.push({ type: 'text', x: docX, y: docY, content: text.trim(), color: drawColor, fontSize });
      saveDrawSnapshot();
      redrawDrawings(true);
    }
    return;
  }
  // Shapes: start drag
  if (['line', 'arrow', 'rect', 'ellipse'].includes(drawMode)) {
    isDrawing = true;
    currentPath = { type: 'shape', shape: drawMode, start: { x: docX, y: docY }, end: { x: docX, y: docY }, color: drawColor, width: drawWidth };
    return;
  }
  // Freehand path
  isDrawing = true;
  const finalW = drawMode === 'highlighter' ? Math.max(drawWidth * 3, 12) : drawMode === 'eraser' ? drawWidth * 3 + 10 : drawWidth;
  currentPath = { type: 'path', mode: drawMode, color: drawColor, width: finalW, points: [] };
  setupPathContext(drawMode, drawColor, drawWidth);
  drawCtx.beginPath();
  drawCtx.moveTo(x, y);
  currentPath.points.push({ x: docX, y: docY });
}

function moveDraw(e) {
  if (!drawOverlay.classList.contains('active')) return;
  const cr = contentArea.getBoundingClientRect();
  const x = e.clientX - cr.left;
  const y = e.clientY - cr.top;
  const docX = x + contentArea.scrollLeft;
  const docY = y + contentArea.scrollTop;
  // Text dragging
  if (isDraggingText && selectedDrawIdx >= 0) {
    e.preventDefault();
    const t = drawings[selectedDrawIdx];
    t.x = docX - textDragOffX;
    t.y = docY - textDragOffY;
    redrawDrawings(true);
    return;
  }
  if (!isDrawing) return;
  e.preventDefault();
  if (currentPath.type === 'shape') {
    currentPath.end = { x: docX, y: docY };
    if (drawVisible) { redrawDrawings(true); drawShape(drawCtx, currentPath, contentArea.scrollLeft, contentArea.scrollTop); }
  } else {
    if (!drawVisible) return;
    currentPath.points.push({ x: docX, y: docY });
    drawCtx.lineTo(x, y);
    drawCtx.stroke();
  }
}

function endDraw(e) {
  if (isDraggingText && selectedDrawIdx >= 0) {
    isDraggingText = false;
    saveDrawSnapshot();
    return;
  }
  if (!isDrawing) return;
  isDrawing = false;
  if (currentPath && (currentPath.type !== 'shape' || currentPath.start.x !== currentPath.end.x || currentPath.start.y !== currentPath.end.y)) {
    drawings.push(currentPath);
    saveDrawSnapshot();
    if (drawVisible) redrawDrawings(true);
    else { const w = drawOverlay.offsetWidth, h = drawOverlay.offsetHeight; if (w && h) drawCtx.clearRect(0, 0, w, h); }
  }
  currentPath = null;
}

function clearDrawings() {
  if (drawings.length === 0) { showToast('没有标注需要清除'); return; }
  deselectText();
  drawings = [];
  saveDrawSnapshot();
  const w = drawOverlay.offsetWidth, h = drawOverlay.offsetHeight;
  if (w && h) drawCtx.clearRect(0, 0, w, h);
  showToast('已清除所有标注');
}

function toggleDrawMode() {
  const active = drawOverlay.classList.toggle('active');
  hideCursor();
  drawOverlay.style.display = active ? 'block' : 'none';
  drawToolbar.style.display = active ? 'flex' : 'none';
  if (active) {
    positionCanvas();
    redrawDrawings(true);
    document.querySelectorAll('.draw-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === drawMode));
    $('actDraw').style.background = 'var(--primary)';
    $('actDraw').style.color = '#fff';
    if (state.zoomLevel !== 1) showToast('建议先重置缩放为 100%，否则标注可能不准确');
    else showToast('标注模式已开启');
  } else {
    isDrawing = false;
    currentPath = null;
    deselectText();
    $('actDraw').style.background = '';
    $('actDraw').style.color = '';
  }
}

function setDrawMode(mode) {
  drawMode = mode;
  document.querySelectorAll('.draw-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  deselectText();
  if (mode === 'eraser') {
    const s = drawWidth * 3 + 10;
    drawCursor.style.width = s + 'px';
    drawCursor.style.height = s + 'px';
  }
}

function toggleDrawVisibility() {
  drawVisible = !drawVisible;
  if (drawVisible) {
    redrawDrawings(true);
  } else {
    const w = drawOverlay.offsetWidth, h = drawOverlay.offsetHeight;
    if (w && h) drawCtx.clearRect(0, 0, w, h);
  }
  showToast(drawVisible ? '标注已显示' : '标注已隐藏');
}

function hideCursor() { drawCursor.style.display = 'none'; }

// Text editing helpers
async function editSelectedText() {
  if (selectedDrawIdx < 0) return;
  const t = drawings[selectedDrawIdx];
  if (t.type !== 'text') return;
  const newText = await showPromptDialog({ title: '编辑文字', placeholder: '', defaultValue: t.content });
  if (newText && newText.trim()) {
    t.content = newText.trim();
    saveDrawSnapshot();
    redrawDrawings(true);
    updateTextControls();
  }
}

function deleteSelectedText() {
  if (selectedDrawIdx < 0) return;
  drawings.splice(selectedDrawIdx, 1);
  selectedDrawIdx = -1;
  textControls.style.display = 'none';
  saveDrawSnapshot();
  redrawDrawings(true);
}

function textSizeChange(delta) {
  if (selectedDrawIdx < 0) return;
  const t = drawings[selectedDrawIdx];
  if (t.type !== 'text') return;
  t.fontSize = Math.max(10, Math.min(72, t.fontSize + delta));
  updateTextControls();
  redrawDrawings(true);
}

// ===== Print =====
function printContent() {
  if (!state.fileContent && !htmlFrame.src && !htmlFrame.srcdoc) {
    showToast('没有可打印的内容');
    return;
  }
  if (drawOverlay.classList.contains('active')) toggleDrawMode();
  const savedZoom = state.zoomLevel;
  if (savedZoom !== 1) {
    state.zoomLevel = 1;
    reapplyZoom();
    zoomDisplay.textContent = '100%';
  }
  window.print();
  if (savedZoom !== 1) {
    state.zoomLevel = savedZoom;
    reapplyZoom();
    zoomDisplay.textContent = Math.round(savedZoom * 100) + '%';
  }
}

// ===== Drawing event listeners =====
drawCanvas.addEventListener('pointerdown', startDraw);
drawCanvas.addEventListener('pointermove', moveDraw);
drawCanvas.addEventListener('pointerup', endDraw);
drawCanvas.addEventListener('pointercancel', (e) => { endDraw(e); hideCursor(); });
// Cursor tracking
drawCanvas.addEventListener('pointermove', (e) => {
  if (!drawOverlay.classList.contains('active')) return;
  // Reset cursor to default circle style
  drawCursor.style.borderRadius = '50%';
  drawCursor.style.border = '2px solid rgba(0,0,0,0.35)';
  drawCursor.style.background = 'rgba(0,0,0,0.06)';
  drawCursor.style.left = e.clientX + 'px';
  drawCursor.style.top = e.clientY + 'px';
  if (drawMode === 'eraser') {
    const s = drawWidth * 3 + 10;
    drawCursor.style.width = s + 'px';
    drawCursor.style.height = s + 'px';
    drawCursor.style.display = 'block';
  } else if (drawMode === 'text') {
    drawCursor.style.width = '2px';
    drawCursor.style.height = drawWidth * 4 + 16 + 'px';
    drawCursor.style.display = 'block';
    drawCursor.style.borderRadius = '0';
    drawCursor.style.border = 'none';
    drawCursor.style.background = 'var(--primary)';
  } else {
    drawCursor.style.display = 'none';
  }
});
drawCanvas.addEventListener('pointerleave', hideCursor);
document.addEventListener('pointerup', () => { if (isDrawing) endDraw(); if (isDraggingText) { isDraggingText = false; saveDrawSnapshot(); } });
// Double-click to edit text
drawCanvas.addEventListener('dblclick', (e) => {
  if (!drawOverlay.classList.contains('active') || selectedDrawIdx < 0) return;
  editSelectedText();
});
// Toolbar controls
document.querySelectorAll('.draw-btn[data-mode]').forEach(b => b.addEventListener('click', () => setDrawMode(b.dataset.mode)));
$('drawColor').addEventListener('input', (e) => {
  drawColor = e.target.value;
  if (selectedDrawIdx >= 0 && drawings[selectedDrawIdx] && drawings[selectedDrawIdx].type === 'text') {
    drawings[selectedDrawIdx].color = drawColor;
    redrawDrawings(true);
  }
});
$('drawWidth').addEventListener('change', (e) => {
  drawWidth = parseInt(e.target.value);
  if (drawMode === 'eraser') {
    const s = drawWidth * 3 + 10;
    drawCursor.style.width = s + 'px';
    drawCursor.style.height = s + 'px';
  }
});
$('drawClear').addEventListener('click', clearDrawings);
$('drawToggleVis').addEventListener('click', toggleDrawVisibility);
$('drawUndo').addEventListener('click', undoDraw);
$('drawRedo').addEventListener('click', redoDraw);
$('drawClose').addEventListener('click', toggleDrawMode);
// Text controls
$('textSizeDown').addEventListener('click', () => textSizeChange(-2));
$('textSizeUp').addEventListener('click', () => textSizeChange(2));
$('textEdit').addEventListener('click', editSelectedText);
$('textDelete').addEventListener('click', deleteSelectedText);
// Redraw on scroll/resize
contentArea.addEventListener('scroll', redrawDrawings);
window.addEventListener('resize', () => { if (drawOverlay.classList.contains('active')) { positionCanvas(); redrawDrawings(true); } });
// Drawing keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!drawOverlay.classList.contains('active')) return;
  if (e.key === 'Escape') { deselectText(); toggleDrawMode(); hideCursor(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoDraw(); else undoDraw();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedDrawIdx >= 0 && !e.target.closest('input,textarea,select')) {
      e.preventDefault();
      deleteSelectedText();
    }
  }
});
drawCanvas.addEventListener('pointerleave', hideCursor);
document.addEventListener('pointerup', () => { if (isDrawing) endDraw(); });
