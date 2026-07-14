// ===== Editor =====
const editor = $('mdEditor');
const editorTextarea = $('mdEditorTextarea');
let editTimer = null;
let editorTab = 'edit';

async function toggleEditor() {
  if (state.fileType !== 'md') { showToast('仅 Markdown 文件支持编辑'); return; }
  if (editor.style.display !== 'none') {
    state.fileContent = editorTextarea.value;
    editor.style.display = 'none';
    mdContent.style.display = 'block';
    mdContent.innerHTML = mdParser(state.fileContent);
    setupCopyButtons();
    await enhanceMdContent();
    buildMdOutline();
    reapplyZoom();
    actionStrip.style.display = '';
    $('actEdit').textContent = '📝';
    $('actEdit').title = '编辑模式';
    updateEditBtn();
    showToast('已退出编辑');
    return;
  }
  editor.style.display = 'block';
  mdContent.style.display = 'none';
  actionStrip.style.display = 'none';
  $('actEdit').style.display = '';
  $('actEdit').textContent = '✅';
  $('actEdit').title = '退出编辑';
  editorTextarea.value = state.fileContent;
  switchEditorTab('edit');
  editorTextarea.focus();
}

function switchEditorTab(tab) {
  editorTab = tab;
  document.querySelectorAll('.md-editor-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (tab === 'edit') {
    editorTextarea.style.display = '';
    mdContent.style.display = 'none';
    actionStrip.style.display = 'none';
    editorTextarea.focus();
  } else {
    editorTextarea.style.display = 'none';
    mdContent.style.display = 'block';
    actionStrip.style.display = '';
    renderEditorPreview();
  }
}

async function renderEditorPreview() {
  const text = editorTextarea.value;
  mdContent.innerHTML = mdParser(text);
  setupCopyButtons();
  await enhanceMdContent();
  buildMdOutline();
  reapplyZoom();
  $('mdEditorStatus').textContent = `已渲染 (${text.length.toLocaleString()} 字符)`;
}

function debouncedEdit() {
  clearTimeout(editTimer);
  $('mdEditorStatus').textContent = '输入中...';
  editTimer = setTimeout(() => {
    state.fileContent = editorTextarea.value;
    if (editorTab === 'preview') renderEditorPreview();
    else $('mdEditorStatus').textContent = `${editorTextarea.value.length.toLocaleString()} 字符 | Ctrl+S 保存`;
  }, 800);
}

// Editor tab switching
document.querySelectorAll('.md-editor-tab').forEach(tab => {
  tab.addEventListener('click', () => switchEditorTab(tab.dataset.tab));
});

editorTextarea.addEventListener('input', debouncedEdit);
editorTextarea.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    state.fileContent = editorTextarea.value;
    renderEditorPreview();
    showToast('已保存');
  }
  // Tab indent
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editorTextarea.selectionStart;
    const end = editorTextarea.selectionEnd;
    editorTextarea.value = editorTextarea.value.slice(0, start) + '  ' + editorTextarea.value.slice(end);
    editorTextarea.selectionStart = editorTextarea.selectionEnd = start + 2;
  }
});

// ===== Copy buttons for code blocks =====
function setupCopyButtons() {
  document.querySelectorAll('.md-content pre .copy-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const code = this.getAttribute('data-code');
      navigator.clipboard.writeText(code).then(() => {
        const orig = this.textContent;
        this.textContent = '✓ 已复制';
        setTimeout(() => { this.textContent = orig; }, 1500);
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast('已复制到剪贴板');
      });
    });
  });
}
