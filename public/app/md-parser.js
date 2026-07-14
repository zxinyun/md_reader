// ===== Markdown Parser (standalone) =====
const mdParser = (() => {
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, c => map[c]);
}

  function inlineCode(text) {
    return text.replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function sanitizeUrl(url) {
    const s = url.trim().toLowerCase();
    if (s.startsWith('#') || s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return url;
    if (/^(https?|ftp|mailto|data):/i.test(s)) return url;
    return '';
  }
  function parseInline(text) {
    // Extract math formulas BEFORE escaping, protect them from escapeHtml
    const mathBlocks = [];
    let t = text.replace(/\$\$(.+?)\$\$/gs, function(m, formula) {
      const idx = mathBlocks.length;
      mathBlocks.push({ tex: formula.trim(), display: true });
      return '\x00MATH' + idx + '\x00';
    }).replace(/\$([^$\n]+?)\$/g, function(m, formula) {
      const idx = mathBlocks.length;
      mathBlocks.push({ tex: formula.trim(), display: false });
      return '\x00MATH' + idx + '\x00';
    });
    t = escapeHtml(t);
    // Images
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      const raw = src.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
      const safe = sanitizeUrl(raw);
      return safe ? `<img src="${src}" alt="${alt}" loading="lazy">` : alt;
    });
    // Links
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
      const raw = href.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
      const safe = sanitizeUrl(raw);
      return safe ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    // Bold+Italic
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Strikethrough
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // Inline code
    t = inlineCode(t);
    // Hard line breaks within paragraphs (newline → <br>)
    t = t.replace(/\n/g, '<br>');
    // Restore math blocks
    t = t.replace(/\x00MATH(\d+)\x00/g, function(m, idx) {
      var block = mathBlocks[parseInt(idx)];
      if (!block) return '';
      var tag = block.display ? 'div' : 'span';
      var cls = block.display ? 'katex-display' : 'katex-inline';
      return '<' + tag + ' class="' + cls + '" data-tex="' + block.tex.replace(/"/g, '&quot;') + '">' + block.tex + '</' + tag + '>';
    });
    return t;
  }

  function parseTable(lines, i) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (!sep || !/^[|:\- ]+$/.test(sep.trim())) return null;
    const rows = [];
    const align = sep.split('|').filter(s => s.trim()).map(s => {
      if (s.startsWith(':') && s.endsWith(':')) return 'center';
      if (s.endsWith(':')) return 'right';
      return 'left';
    });
    const hCells = header.split('|').filter(s => s.trim()).map(s => s.trim());
    rows.push('<thead><tr>' + hCells.map((c, j) => `<th style="text-align:${align[j] || 'left'}">${parseInline(c)}</th>`).join('') + '</tr></thead>');
    let j = i + 2;
    while (j < lines.length && lines[j].includes('|')) {
      const cells = lines[j].split('|').filter(s => s.trim()).map(s => s.trim());
      if (cells.length) rows.push('<tr>' + cells.map((c, k) => `<td style="text-align:${align[k] || 'left'}">${parseInline(c) || '&nbsp;'}</td>`).join('') + '</tr>');
      j++;
    }
    return { html: '<div class="csv-table-wrap"><table>' + rows.join('') + '</table></div>', nextLine: j };
  }

  function parseCodeBlock(lines, i) {
    const lang = lines[i].slice(3).trim();
    const codeLines = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('```')) {
      codeLines.push(lines[j]);
      j++;
    }
    const code = codeLines.join('\n');
    const escaped = escapeHtml(code);
    const langClass = lang ? ` class="language-${lang}"` : '';
    const caption = lang ? `<span style="position:absolute;top:6px;left:10px;font-size:11px;color:var(--text-secondary)">${lang}</span>` : '';
    return {
      html: `<pre>${caption}<button class="copy-btn" data-code="${escapeHtml(code)}">复制</button><code${langClass}>${escaped}</code></pre>`,
      nextLine: j + 1
    };
  }

  return function parse(md) {
    const lines = md.split('\n');
    const result = [];
    let inParagraph = null;

    function flushParagraph() {
      if (inParagraph !== null) {
        result.push(`<p>${parseInline(inParagraph.join('\n'))}</p>`);
        inParagraph = null;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Empty line
      if (!trimmed) { flushParagraph(); continue; }

      // Code block
      if (trimmed.startsWith('```')) {
        flushParagraph();
        const block = parseCodeBlock(lines, i);
        result.push(block.html);
        i = block.nextLine - 1;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('> ')) {
        flushParagraph();
        const quotes = [];
        while (i < lines.length && lines[i].trim().startsWith('> ')) {
          quotes.push(lines[i].trim().slice(2));
          i++;
        }
        i--;
        result.push(`<blockquote>${quotes.map(q => `<p>${parseInline(q)}</p>`).join('')}</blockquote>`);
        continue;
      }

      // Headings
      const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        flushParagraph();
        const level = hMatch[1].length;
        result.push(`<h${level}>${parseInline(hMatch[2])}</h${level}>`);
        continue;
      }

      // Table
      if (trimmed.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && /^[|:\- ]+$/.test(lines[i + 1].trim())) {
        flushParagraph();
        const table = parseTable(lines, i);
        if (table) { result.push(table.html); i = table.nextLine - 1; continue; }
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph();
        result.push('<hr>');
        continue;
      }

      // Unordered list
      if (trimmed.match(/^[-*+]\s+/)) {
        flushParagraph();
        const items = [];
        while (i < lines.length) {
          const t = lines[i].trim();
          const liMatch = t.match(/^[-*+]\s+(.+)$/);
          if (!liMatch) break;
          items.push(`<li>${parseInline(liMatch[1])}</li>`);
          i++;
        }
        i--;
        result.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      // Ordered list
      if (trimmed.match(/^\d+\.\s+/)) {
        flushParagraph();
        const items = [];
        while (i < lines.length) {
          const t = lines[i].trim();
          const liMatch = t.match(/^\d+\.\s+(.+)$/);
          if (!liMatch) break;
          items.push(`<li>${parseInline(liMatch[1])}</li>`);
          i++;
        }
        i--;
        result.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      // Paragraph
      if (inParagraph === null) inParagraph = [];
      inParagraph.push(trimmed);
    }
    flushParagraph();
    return result.join('\n');
  };
})();
