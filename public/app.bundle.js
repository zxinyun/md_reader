(function () {
  'use strict';

  // ---- Platform detection ----
  const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
  const isCapacitor = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
  const platform = isTauri ? 'tauri' : isCapacitor ? 'capacitor' : 'web';

  const invoke = isTauri ? window.__TAURI_INTERNALS__.invoke : null;

  // ---- Tauri shortcut ----
  async function tauriCmd(cmd, args) {
    return invoke(cmd, args || {});
  }

  // ---- Unified file descriptor ----
  // Web:      { name, size, ext, _file: File }
  // Tauri:    { name, size, ext, path, _path }
  // Capacitor:{ name, size, ext, path, _uri }

  // ---- Web helpers ----
  function webTriggerInput(accept, multiple) {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      if (multiple) input.multiple = true;
      input.onchange = function () {
        resolve(Array.from(input.files).map(toFileDesc));
        input.remove();
      };
      input.click();
    });
  }

  function toFileDesc(file) {
    var name = file.name;
    var dot = name.lastIndexOf('.');
    return {
      name: name,
      size: file.size,
      ext: dot !== -1 ? name.slice(dot + 1).toLowerCase() : '',
      _file: file
    };
  }

  function blobToArrayBuffer(blob) {
    // Prefer native Blob.arrayBuffer() to avoid FileReader issues with browser extensions
    if (blob.arrayBuffer) {
      return blob.arrayBuffer();
    }
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsArrayBuffer(blob);
    });
  }

  function blobToBinaryString(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsBinaryString(blob);
    });
  }

  // ---- FileAPI ----
  window.FileAPI = {
    platform: platform,

    // ---------- Pick file(s) ----------
    async pickFile(accept) {
      if (platform === 'tauri') {
        try {
          var result = await tauriCmd('plugin:dialog|open', {
            options: {
              multiple: false,
              filters: accept ? [{ name: 'All Supported Files', extensions: accept.split(',').filter(function(s) { return s.startsWith('.') && !s.includes('/'); }).map(function(s) { return s.replace(/^\./, ''); }) }] : []
            }
          });
          if (!result) return null;
          var path = Array.isArray(result) ? result[0] : result;
          var name = path.split(/[/\\]/).pop();
          var dot = name.lastIndexOf('.');
          return {
            name: name,
            ext: dot !== -1 ? name.slice(dot + 1).toLowerCase() : '',
            path: path,
            _path: path
          };
        } catch (e) {
          console.error('FileAPI.pickFile failed:', e);
          return null;
        }
      }
      if (platform === 'capacitor') {
        var files = await webTriggerInput(accept);
        return files.length ? files[0] : null;
      }
      var files = await webTriggerInput(accept);
      return files.length ? files[0] : null;
    },

    async pickFiles(accept) {
      if (platform === 'tauri') {
        try {
          var result = await tauriCmd('plugin:dialog|open', {
            options: {
              multiple: true,
              filters: accept ? [{ name: 'All Supported Files', extensions: accept.split(',').filter(function(s) { return s.startsWith('.') && !s.includes('/'); }).map(function(s) { return s.replace(/^\./, ''); }) }] : []
            }
          });
          if (!result) return [];
          var list = [];
          for (var i = 0; i < result.length; i++) {
            var path = result[i];
            var info = await tauriCmd('plugin:fs|stat', { path: path });
            var name = path.split(/[/\\]/).pop();
            var dot = name.lastIndexOf('.');
            list.push({
              name: name, size: info.size,
              ext: dot !== -1 ? name.slice(dot + 1).toLowerCase() : '',
              path: path, _path: path
            });
          }
          return list;
        } catch (e) {
          console.warn('[pickFiles] Tauri dialog failed, falling back to web picker:', e);
        }
      }
      return webTriggerInput(accept, true);
    },

    // ---------- Read file content ----------
    async readAsText(fileDesc) {
      if (!fileDesc) return '';
      if (fileDesc._file) return fileDesc._file.text();
      if (fileDesc._path) {
        var arr = await tauriCmd('plugin:fs|read_text_file', { path: fileDesc._path });
        var bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
        return new TextDecoder().decode(bytes);
      }
      if (fileDesc._uri) {
        /* Capacitor */
        var ret = await window.Capacitor.Plugins.Filesystem.readFile({ path: fileDesc._uri });
        return ret.data;
      }
      return '';
    },

    async readAsArrayBuffer(fileDesc) {
      if (!fileDesc) { console.warn('DIAG readAsArrayBuffer: null fileDesc'); return new ArrayBuffer(0); }
      if (fileDesc._file) { console.log('DIAG readAsArrayBuffer: using _file (web)'); return blobToArrayBuffer(fileDesc._file); }
      if (fileDesc._path) {
        console.log('DIAG readAsArrayBuffer: calling tauri read_file path=' + fileDesc._path);
        try {
          var arr = await tauriCmd('plugin:fs|read_file', { path: fileDesc._path });
          console.log('DIAG readAsArrayBuffer: tauri returned type=' + typeof arr + ' isArray=' + Array.isArray(arr) + ' isArrayBuffer=' + (arr instanceof ArrayBuffer) + ' hasBuffer=' + !!(arr && arr.buffer) + ' length=' + (arr ? (arr.length || arr.byteLength || '?') : '0'));
          if (arr instanceof ArrayBuffer) return arr;
          if (arr && arr.buffer instanceof ArrayBuffer) return arr.buffer;
          if (Array.isArray(arr)) return new Uint8Array(arr).buffer;
          console.warn('DIAG readAsArrayBuffer: unexpected return type, returning empty buffer');
        } catch (e) {
          console.error('DIAG readAsArrayBuffer failed:', e);
        }
        return new ArrayBuffer(0);
      }
      console.log('DIAG readAsArrayBuffer: no _path or _file');
      return new ArrayBuffer(0);
    },

    async readAsBinaryString(fileDesc) {
      if (!fileDesc) return '';
      if (fileDesc._file) return blobToBinaryString(fileDesc._file);
      if (fileDesc._path) {
        var arr = await tauriCmd('plugin:fs|read_file', { path: fileDesc._path });
        var bytes = new Uint8Array(arr);
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return bin;
      }
      return '';
    },

    // ---------- Read by path (Tauri/Capacitor) ----------
    async readTextFile(path) {
      if (platform === 'tauri') {
        var arr = await tauriCmd('plugin:fs|read_text_file', { path: path });
        var bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
        return new TextDecoder().decode(bytes);
      }
      if (platform === 'capacitor') {
        var ret = await window.Capacitor.Plugins.Filesystem.readFile({ path: path });
        return ret.data;
      }
      var resp = await fetch(path);
      return resp.text();
    },

    async readBinaryFile(path) {
      if (platform === 'tauri') {
        var arr = await tauriCmd('plugin:fs|read_file', { path: path });
        return new Uint8Array(arr);
      }
      if (platform === 'capacitor') {
        var ret = await window.Capacitor.Plugins.Filesystem.readFile({ path: path });
        var bin = atob(ret.data);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      var resp = await fetch(path);
      return new Uint8Array(await resp.arrayBuffer());
    },

    // ---------- Save file ----------
    async saveFile(content, filename, mime) {
      if (!content) return;
      mime = mime || 'text/plain';
      if (platform === 'tauri') {
        var ext = (filename.match(/\.(\w+)$/) || [])[1] || '*';
        var savePath = await tauriCmd('plugin:dialog|save', {
          defaultPath: filename,
          filters: [{ name: '文件', extensions: [ext] }]
        });
        if (!savePath) return;
        if (typeof content === 'string') {
          await tauriCmd('plugin:fs|write_text_file', { path: savePath, contents: content });
        } else if (content instanceof Blob) {
          var buf = await content.arrayBuffer();
          await tauriCmd('plugin:fs|write_file', { path: savePath, contents: Array.from(new Uint8Array(buf)) });
        } else {
          await tauriCmd('plugin:fs|write_file', { path: savePath, contents: Array.from(content) });
        }
        console.log('Saved to ' + savePath);
        return savePath;
      }
      var blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },

    // ---------- Directory ----------
    async listDir(path) {
      if (platform === 'tauri') {
        var entries = await tauriCmd('plugin:fs|read_dir', { path: path });
        return entries.map(function (e) { return e.name; });
      }
      return [];
    },

    async exists(path) {
      if (platform === 'tauri') return tauriCmd('plugin:fs|exists', { path: path });
      return false;
    },

    // ---------- Convert dropped File objects ----------
    descFromFile: toFileDesc,

    // ---------- Get file path from descriptor ----------
    getPath(fileDesc) {
      return fileDesc && (fileDesc.path || fileDesc._path || fileDesc._uri || '');
    }
  };

  console.log('FileAPI initialized: platform=' + platform);
})();


const __BUILD_ID__ = '20260619-0500';
const __APP_VERSION__ = '__APP_VERSION__';
const __VERSION__ = '1.1.0-beta';
const __FEATURES__ = { multiFile: true, imageSupport: true, debugPanel: true, ai: true };

// ===== AI Configuration =====
const AI_PROVIDERS = ['openai', 'gemini', 'ollama', 'openrouter', 'custom'];

const AI_PROVIDER_LABELS = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  ollama: 'Ollama (本地)',
  openrouter: 'OpenRouter',
  custom: '自定义'
};

let aiConfig = {
  provider: 'openai',
  providerLabel: '',
  apiKey: '',
  baseUrl: '',
  model: '',
  temperature: 0.3,
  maxTokens: 4096
};

// Provider defaults
const AI_PROVIDER_DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.2:3b' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash' },
  custom: { baseUrl: '', model: '' }
};

function loadAiConfig() {
  try {
    const saved = localStorage.getItem('reader-ai-config');
    if (saved) Object.assign(aiConfig, JSON.parse(saved));
    // Ensure defaults for selected provider
    const def = AI_PROVIDER_DEFAULTS[aiConfig.provider];
    if (def) {
      if (!aiConfig.baseUrl) aiConfig.baseUrl = def.baseUrl;
      if (!aiConfig.model) aiConfig.model = def.model;
    }
  } catch(e) {}
}

function saveAiConfig() {
  try { localStorage.setItem('reader-ai-config', JSON.stringify(aiConfig)); } catch(e) {}
}

loadAiConfig();
// Preload PDF.js module (cached for subsequent imports)
try { import('./lib/pdf.min.mjs').catch(function(){}); } catch(e) {}
var _pdfjsLib = null;
// ===== Global helpers =====
function escapeHtml(text) {
  const map = { '&': '\x26amp;', '<': '\x26lt;', '>': '\x26gt;', '"': '\x26quot;', "'": '\x26#039;' };
  return String(text).replace(/[&<>"']/g, c => map[c]);
}
function escapeAttr(text) {
  return escapeHtml(text).replace(/[\n\r\t]/g, ' ');
}
function dispLen(s) {
  const m = s.match(/[^\x00-\x7F]/g);
  return s.length + (m ? m.length : 0);
}

// ===== App State =====
const state = {
  theme: localStorage.getItem('reader-theme') || 'auto',
  fontSize: parseInt(localStorage.getItem('reader-font-size') || '16'),
  fileContent: null,
  fileName: '',
  fileExt: '',
  fileType: '',
  scrollMode: localStorage.getItem('reader-scroll-mode') || 'default',
  zoomLevel: parseFloat(localStorage.getItem('reader-zoom') || '1'),
  fileMeta: {},
  importedFiles: [], // { name, path, fullPath, content? }
  imageFiles: [],
  imageIndex: 0,
};

// ===== Code file extensions =====
const CODE_EXTS = new Set([
  'js','ts','jsx','tsx','mjs','cjs','vue','svelte','astro',
  'py','rb','php','sh','bash','zsh','pl','lua','r','swift','kt','dart','go','rs','scala',
  'java','c','cpp','h','hpp','cs','fs','hs','clj','erl','ex','exs',
  'css','scss','less','sass','styl',
  'sql','tex','rst','gradle','s','spec',
  'ini','cfg','conf','toml','env','makefile','cmake',
  'bat','cmd','ps1','psm1','psd1',
  'dockerfile','gitignore','editorconfig','htaccess',
  'json','xml','yaml','yml',
  'reg','vbs','wsf','ahk','asm','wasm','zig','nim','cr',
]);

const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','svg','ico','heic','heif','avif','tiff','tif']);

const ACCEPT_EXTS = '.md,.html,.htm,.txt,.log,.pdf,.doc,.docx,.wps,.wpt,.xls,.xlsx,.et,.ett,.ppt,.pptx,.dps,.dpt,.csv,.json,.xml,.yaml,.yml,.js,.ts,.jsx,.tsx,.mjs,.cjs,.vue,.svelte,.astro,.py,.rb,.php,.sh,.bash,.zsh,.css,.scss,.less,.sass,.styl,.java,.c,.cpp,.h,.hpp,.go,.rs,.swift,.kt,.dart,.lua,.r,.pl,.sql,.tex,.rst,.bat,.cmd,.ps1,.psm1,.psd1,.ini,.cfg,.conf,.toml,.env,.gradle,.s,.spec,.dockerfile,.gitignore,.editorconfig,.htaccess,.makefile,.cmake,.reg,.vbs,.wsf,.ahk,.asm,.wasm,.zig,.nim,.cr,.hs,.clj,.erl,.ex,.exs,.fs,.cs,.scala,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.ico,.heic,.heif,.avif,.tiff,.tif,image/*';

// ===== AI Service: multi-provider LLM client =====
// Supports OpenAI-compatible, Gemini, Ollama, OpenRouter

function buildChatMessages(systemPrompt, userContent) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];
}

async function aiChat(messages, options) {
  const cfg = options || aiConfig;
  const provider = cfg.provider;

  if (provider === 'ollama') return ollamaChat(messages, cfg);
  if (provider === 'gemini') return geminiChat(messages, cfg);
  // OpenAI / OpenRouter / Custom (OpenAI-compatible) share the same API format
  return openaiChat(messages, cfg);
}

async function openaiChat(messages, cfg) {
  const url = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.openai.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: cfg.model || AI_PROVIDER_DEFAULTS.openai.model,
    messages,
    temperature: cfg.temperature ?? 0.3,
    max_tokens: cfg.maxTokens || 4096
  };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = '通用阅读器';
  }
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  const res = await tauriFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('API ' + res.status + ': ' + (err || res.statusText));
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function geminiChat(messages, cfg) {
  const key = cfg.apiKey;
  if (!key) throw new Error('请配置 Gemini API Key');
  const model = cfg.model || AI_PROVIDER_DEFAULTS.gemini.model;
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.gemini.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/models/' + model + ':generateContent?key=' + encodeURIComponent(key);

  // Convert chat format to Gemini format
  const contents = [];
  let systemInstruction = null;
  for (const msg of messages) {
    if (msg.role === 'system') { systemInstruction = msg.content; continue; }
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
  }

  const body = { contents };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  body.generationConfig = {
    temperature: cfg.temperature ?? 0.3,
    maxOutputTokens: cfg.maxTokens || 4096
  };

  const res = await tauriFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('Gemini API ' + res.status + ': ' + (err || res.statusText));
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

async function ollamaChat(messages, cfg) {
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.ollama.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/api/chat';
  const body = {
    model: cfg.model || AI_PROVIDER_DEFAULTS.ollama.model,
    messages: messages.map(m => ({ role: m.role === 'system' ? 'system' : m.role, content: m.content })),
    options: {
      temperature: cfg.temperature ?? 0.3,
      num_predict: cfg.maxTokens || 4096
    },
    stream: false
  };
  const res = await tauriFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error('Ollama API ' + res.status + ': ' + (err || res.statusText));
  }
  const data = await res.json();
  return data.message?.content || '';
}

// ===== Summary =====
function buildSummaryPrompt(text, mode) {
  const modes = {
    tlDr: '请用2-3句话简要概括以下内容的核心要点。',
    detailed: '请详细总结以下内容，包含主要论点、论据和结论，分段落组织。',
    keyPoints: '请提取以下内容的关键要点，用简洁的列表形式呈现。',
    structured: '请按以下结构总结：\n1. 核心主题\n2. 主要观点\n3. 论据/数据\n4. 结论\n5. 个人见解/行动建议'
  };
  return (modes[mode] || modes.tlDr) + '\n\n内容如下：\n\n' + text;
}

async function summarizeText(text, mode) {
  const prompt = buildSummaryPrompt(text, mode || 'tlDr');
  const messages = buildChatMessages('你是一个专业的文档分析助手。请用中文回答。', prompt);
  return await aiChat(messages);
}

// ===== Format conversion =====
async function convertContent(text, targetFormat, sourceType) {
  const prompt = '请将以下' + (sourceType || '文档') + '转换为' + targetFormat + '格式。'
    + '保留原内容的完整信息、结构和数据。'
    + '直接输出转换结果，不要包含额外说明。\n\n'
    + text;
  const messages = buildChatMessages(
    '你是一个专业的格式转换助手。严格按目标格式输出，不要添加额外说明。',
    prompt
  );
  return await aiChat(messages);
}

// ===== Fetch available models =====
async function fetchModels(cfg) {
  cfg = cfg || aiConfig;
  const provider = cfg.provider;
  if (provider === 'ollama') return fetchOllamaModels(cfg);
  if (provider === 'gemini') return fetchGeminiModels(cfg);
  return fetchOpenaiModels(cfg); // OpenAI / OpenRouter / Custom
}

async function fetchOpenaiModels(cfg) {
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.openai.baseUrl).replace(/\/+$/, '');
  const candidates = [
    baseUrl + '/models',
    baseUrl + '/v1/models'
  ];
  // If baseUrl ends with a known path segment like /chat/completions, strip it
  if (/\/chat\/completions\/?$/.test(baseUrl)) {
    var stripped = baseUrl.replace(/\/chat\/completions\/?$/, '');
    candidates.push(stripped + '/models');
    candidates.push(stripped + '/v1/models');
  }
  var lastErr = null;
  for (const url of candidates) {
    try {
      const headers = {};
      if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
      const res = await tauriFetch(url, { headers });
      if (!res.ok) { lastErr = new Error('获取模型列表失败 (' + res.status + ')'); continue; }
      const data = await res.json();
      return (data.data || []).map(function(m) { return m.id; }).sort();
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error('无法获取模型列表');
}

async function fetchOllamaModels(cfg) {
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.ollama.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/api/tags';
  const res = await tauriFetch(url);
  if (!res.ok) throw new Error('获取模型列表失败 (' + res.status + ')');
  const data = await res.json();
  return (data.models || []).map(function(m) { return m.name; }).sort();
}

async function fetchGeminiModels(cfg) {
  const key = cfg.apiKey;
  if (!key) throw new Error('请先配置 API Key');
  const baseUrl = (cfg.baseUrl || AI_PROVIDER_DEFAULTS.gemini.baseUrl).replace(/\/+$/, '');
  const url = baseUrl + '/models?key=' + encodeURIComponent(key);
  const res = await tauriFetch(url);
  if (!res.ok) throw new Error('获取模型列表失败 (' + res.status + ')');
  const data = await res.json();
  return (data.models || []).map(function(m) { return m.name.replace(/^models\//, ''); }).sort();
}

// ===== Test connection =====
async function testConnection(cfg) {
  const testMessages = buildChatMessages('你是一个助手。', '请回复"连接成功"四个字。');
  const start = Date.now();
  const result = await aiChat(testMessages, cfg);
  return { ok: true, latency: Date.now() - start, response: result };
}
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

// ===== Encoding detection & decoding =====
async function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  // BOM detection
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE)
    return { text: new TextDecoder('utf-16le').decode(buffer), encoding: 'UTF-16 LE' };
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF)
    return { text: new TextDecoder('utf-16be').decode(buffer), encoding: 'UTF-16 BE' };
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
    return { text: new TextDecoder('utf-8').decode(buffer.slice(3)), encoding: 'UTF-8 (BOM)' };

  // Decode candidates and score by U+FFFD (replacement char) and CJK count
  var ffRe = /\uFFFD/g;
  var cjkRe = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2f00-\u2fdf\u3000-\u303f\uff00-\uffef]/g;

  function qual(text) {
    if (!text) return { ff: Infinity, cjk: -1 };
    return { ff: (text.match(ffRe) || []).length, cjk: (text.match(cjkRe) || []).length };
  }

  var utf8Text = null;
  try { utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (e) {}

  // If UTF-8 passes strict, verify against GBK to catch GBK impostors
  if (utf8Text !== null) {
    var uq = qual(utf8Text);
    if (uq.cjk > 0) {
      // Has CJK characters — cross-check with GBK
      try {
        var gbkText = new TextDecoder('gbk').decode(buffer);
        var gq = qual(gbkText);
        // GBK with 0 U+FFFD and more CJK chars means UTF-8 was wrong
        if (gq.ff === 0 && gq.cjk > uq.cjk)
          return { text: gbkText, encoding: 'GBK' };
        try {
          var big5Text = new TextDecoder('big5').decode(buffer);
          var bq = qual(big5Text);
          if (bq.ff === 0 && bq.cjk > uq.cjk && bq.cjk > gq.cjk)
            return { text: big5Text, encoding: 'Big5' };
        } catch (e) {}
      } catch (e) {}
    }
    return { text: utf8Text, encoding: 'UTF-8' };
  }

  // UTF-8 strict failed — decode GBK, Big5 and score them
  var gbkText = null, big5Text = null;
  try { gbkText = new TextDecoder('gbk').decode(buffer); } catch (e) {}
  try { big5Text = new TextDecoder('big5').decode(buffer); } catch (e) {}
  // Also try UTF-8 non-fatal for comparison
  try { if (!utf8Text) { utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(buffer); } } catch (e) {}

  var candidates = [
    { text: gbkText, enc: 'GBK', q: qual(gbkText) },
    { text: big5Text, enc: 'Big5', q: qual(big5Text) },
    { text: utf8Text, enc: 'UTF-8', q: qual(utf8Text) }
  ];
  candidates.sort(function(a, b) {
    if (a.q.ff !== b.q.ff) return a.q.ff - b.q.ff;
    return b.q.cjk - a.q.cjk;
  });
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i].text !== null)
      return { text: candidates[i].text, encoding: candidates[i].enc };
  }

  return { text: new TextDecoder('utf-8', { fatal: false }).decode(buffer), encoding: 'UTF-8 (fallback)' };
}

// ===== Encryption detection & decryption =====
function isEncryptedOffice(buffer) {
  if (!buffer || !(buffer instanceof ArrayBuffer)) return false;
  const bytes = new Uint8Array(buffer.slice(0, 8));
  const OLE_HEADER = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  return OLE_HEADER.every((v, i) => bytes[i] === v);
}

async function decryptOffice(buffer, password) {
  if (typeof CFB === 'undefined') {
    await loadScript('https://cdn.jsdelivr.net/npm/cfb@1.2.2/dist/cfb.min.js');
  }
  const ole = CFB.read(buffer, { type: 'array' });

  const infoEntry = CFB.find(ole, '/EncryptionInfo');
  const pkgEntry = CFB.find(ole, '/EncryptedPackage');
  if (!infoEntry || !pkgEntry) throw new Error('未找到加密信息');

  const infoBuf = infoEntry.content;
  const pkgBuf = pkgEntry.content;

  const infoView = new DataView(infoBuf.buffer, infoBuf.byteOffset, infoBuf.byteLength);
  const majorVer = infoView.getUint32(0, true);
  const minorVer = infoView.getUint32(4, true);

  let xmlStr;
  if (majorVer === 4 && minorVer === 4) {
    xmlStr = new TextDecoder('utf-8').decode(infoBuf.slice(8));
  } else if (majorVer === 4 && minorVer === 5) {
    const bom = new Uint16Array(infoBuf.slice(8, 10))[0];
    if (bom === 0xFEFF) {
      const chars = new Uint16Array(infoBuf.slice(8), 0, (infoBuf.byteLength - 8) / 2);
      xmlStr = String.fromCharCode(...chars).replace(/\0/g, '');
    } else {
      xmlStr = new TextDecoder('utf-8').decode(infoBuf.slice(8));
    }
  } else {
    throw new Error('不支持的加密版本: ' + majorVer + '.' + minorVer);
  }

  const xml = new DOMParser().parseFromString(xmlStr, 'text/xml');

  function getAttr(el, name) { return el?.getAttribute(name) || ''; }

  // Find keyData (use getElementsByTagName for namespace-agnostic matching)
  const keyData = xml.getElementsByTagName('keyData')[0];
  if (!keyData) throw new Error('未找到加密参数');

  const keyBits = parseInt(getAttr(keyData, 'keyBits')) || 128;
  const hashAlg = getAttr(keyData, 'hashAlgorithm') || 'SHA1';
  const cipherAlg = getAttr(keyData, 'cipherAlgorithm') || 'AES';
  const cipherChain = getAttr(keyData, 'cipherChaining') || 'ChainingModeCBC';

  // Find encryptedKey
  const encKey = xml.getElementsByTagName('encryptedKey')[0];
  if (!encKey) throw new Error('未找到加密密钥信息');

  const salt = base64ToBytes(getAttr(encKey, 'saltValue') || getAttr(encKey, 'salt') || '');
  const spinCount = parseInt(getAttr(encKey, 'spinCount')) || 100000;
  const encVerifier = base64ToBytes(getAttr(encKey, 'encryptedVerifierHashInput') || getAttr(encKey, 'encryptedVerifierHashInput') || '');
  const encVerifierHash = base64ToBytes(getAttr(encKey, 'encryptedVerifierHashValue') || getAttr(encKey, 'encryptedVerifierHashValue') || '');
  const algName = cipherAlg === 'AES' ? 'AES-CBC' : cipherAlg;
  const hashName = hashAlg === 'SHA1' ? 'SHA-1' : hashAlg === 'SHA256' ? 'SHA-256' : hashAlg === 'SHA384' ? 'SHA-384' : hashAlg === 'SHA512' ? 'SHA-512' : 'SHA-1';

  // Derive key
  const keyLen = keyBits / 8;
  const pbkdf2Key = await crypto.subtle.importKey('raw',
    new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({
    name: 'PBKDF2', salt, iterations: spinCount, hash: hashName
  }, pbkdf2Key, { name: algName, length: keyBits }, false, ['decrypt']);

  const zeroIv = new Uint8Array(16);

  // Verify password
  try {
    const decVerifier = await crypto.subtle.decrypt({ name: algName, iv: zeroIv }, key, encVerifier);
    const decVerifierHash = await crypto.subtle.decrypt({ name: algName, iv: zeroIv }, key, encVerifierHash);
    const hashLen = parseInt(getAttr(keyData, 'hashSize')) * 8 || 160;
    const hashBytes = hashLen / 8;
    const computedHash = await crypto.subtle.digest(hashName, decVerifier);
    const computedArr = new Uint8Array(computedHash).slice(0, hashBytes);
    const expectedArr = new Uint8Array(decVerifierHash).slice(0, hashBytes);
    if (computedArr.length !== expectedArr.length ||
        !computedArr.every((v, i) => v === expectedArr[i])) {
      throw new Error('密码错误');
    }
  } catch(e) {
    if (e.message === '密码错误') throw e;
    throw new Error('密码错误');
  }

  // Decrypt EncryptedPackage
  // First 8 bytes of package stream are the total length (unencrypted)
  const pkgData = new Uint8Array(pkgBuf);
  const lenView = new DataView(pkgData.buffer, pkgData.byteOffset, 8);
  const dataLen = Number(lenView.getBigUint64(0, true));
  const encrypted = pkgData.slice(8);
  const decrypted = await crypto.subtle.decrypt({ name: algName, iv: zeroIv }, key, encrypted);

  return decrypted.slice(0, dataLen);
}

function base64ToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function handleEncryptedFile(buffer, fileType) {
  const pwd = await showPasswordDialog();
  if (!pwd) { showToast('已取消'); return; }
  showLoading('正在解密...');
  try {
    const decrypted = await decryptOffice(buffer, pwd);
    if (fileType === 'docx') {
      if (typeof mammoth === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js');
      const result = await mammoth.convertToHtml({ arrayBuffer: decrypted });
      showContent(); mdContent.style.display = 'block'; mdContent.innerHTML = result.value;
    } else if (fileType === 'xlsx') {
      if (typeof XLSX === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      state.fileContent = decrypted;
      renderContent();
      return;
    } else if (fileType === 'pptx') {
      state.fileContent = decrypted;
      renderContent();
      return;
    }
    showToast(`已解密: ${state.fileName}`);
  } catch (e) {
    hideLoading();
    if (e.message.includes('密码错误')) {
      showToast('密码错误');
      return handleEncryptedFile(buffer, fileType);
    }
    showError('解密失败', e.message || '无法解密文档');
  }
}

function showError(title, msg) {
  mdContent.style.display = 'block';
  mdContent.innerHTML = `<div class="empty-state" style="min-height:auto;padding:40px 0">
    <div class="icon" style="font-size:48px">⚠️</div>
    <h2>${escapeHtml(title)}</h2>
    <p style="max-width:300px;line-height:1.6;font-size:13px">${escapeHtml(msg)}</p></div>`;
}

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
// AI Summary
$('actAiSummary').addEventListener('click', () => showAiSummarySheet());

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

// ===== Sheet: AI Settings =====
function showAiSheet() {
  const providers = AI_PROVIDERS.map(p => ({ id: p, label: AI_PROVIDER_LABELS[p] || p }));
  const isCustom = aiConfig.provider === 'custom';
  const def = AI_PROVIDER_DEFAULTS[aiConfig.provider];
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">AI 配置</div>
    <div class="sheet-group">
      <div class="sheet-label">API 类型</div>
      <div class="theme-options">
        ${providers.map(p => `<button class="theme-opt${aiConfig.provider === p.id ? ' selected' : ''}" data-provider="${p.id}">${p.label}</button>`).join('')}
      </div>
    </div>
    <div class="sheet-group" id="aiCustomNameGroup" style="margin-top:12px;display:${isCustom ? 'block' : 'none'}">
      <div class="sheet-label">自定义名称</div>
      <input class="ai-input" id="aiProviderLabel" value="${escapeAttr(aiConfig.providerLabel || '')}" placeholder="例如: DeepSeek / 硅基流动 / 本地 vLLM" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);box-sizing:border-box">
    </div>
    <div class="sheet-group" style="margin-top:12px">
      <div class="sheet-label">API 地址</div>
      <input class="ai-input" id="aiBaseUrl" value="${escapeAttr(aiConfig.baseUrl || def?.baseUrl || '')}" placeholder="${isCustom ? 'https://api.example.com/v1' : '例如 ' + (def?.baseUrl || 'https://api.openai.com/v1')}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);box-sizing:border-box">
    </div>
    <div class="sheet-group" style="margin-top:8px">
      <div class="sheet-label">API Key</div>
      <input class="ai-input" id="aiApiKey" type="password" value="${escapeAttr(aiConfig.apiKey)}" placeholder="sk-..." style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);box-sizing:border-box">
    </div>
    <div class="sheet-group" style="margin-top:8px">
      <div class="sheet-label">模型名称</div>
      <div style="display:flex;gap:6px">
        <input class="ai-input" id="aiModel" value="${escapeAttr(isCustom ? (aiConfig.model || '') : (def?.model || aiConfig.model || ''))}" placeholder="手动输入或获取列表后选择" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);box-sizing:border-box">
        <button id="aiFetchModelsBtn" style="padding:8px 14px;border:none;border-radius:6px;background:var(--primary);color:#fff;cursor:pointer;font-size:13px;white-space:nowrap;flex-shrink:0">获取</button>
      </div>
      <select id="aiModelList" style="margin-top:6px;display:none;width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
        <option value="">选择模型...</option>
      </select>
    </div>
    <div class="sheet-group" style="margin-top:8px">
      <div class="sheet-label">温度 (0-2, 默认 0.3)</div>
      <input class="ai-input" id="aiTemp" type="number" min="0" max="2" step="0.1" value="${aiConfig.temperature ?? 0.3}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);box-sizing:border-box">
    </div>
    <div class="sheet-group" style="margin-top:8px">
      <div class="sheet-label">最大 Token 数</div>
      <input class="ai-input" id="aiMaxTokens" type="number" min="256" max="128000" step="256" value="${aiConfig.maxTokens || 4096}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);box-sizing:border-box">
    </div>
    <div class="sheet-group" style="margin-top:12px;display:flex;gap:8px">
      <button id="aiTestBtn" style="flex:1;padding:10px;border:none;border-radius:6px;background:var(--accent);color:#fff;cursor:pointer;font-size:14px;font-weight:600">测试连接</button>
      <button id="aiSaveBtn" style="flex:1;padding:10px;border:none;border-radius:6px;background:var(--primary-light);color:var(--primary);cursor:pointer;font-size:14px;font-weight:600">保存配置</button>
    </div>
    <div id="aiStatus" style="margin-top:8px;font-size:12px;color:var(--text-secondary);text-align:center"></div>
  `;
  openSheet(html);
  // Provider selector
  sheet.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      sheet.querySelectorAll('.theme-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const p = btn.dataset.provider;
      const isCustom = p === 'custom';
      // Show/hide custom name field
      const nameGroup = document.getElementById('aiCustomNameGroup');
      if (nameGroup) nameGroup.style.display = isCustom ? 'block' : 'none';
      // Update placeholders
      const baseUrlInput = document.getElementById('aiBaseUrl');
      const modelInput = document.getElementById('aiModel');
      if (baseUrlInput) baseUrlInput.placeholder = isCustom ? 'https://api.example.com/v1' : '例如 ' + (AI_PROVIDER_DEFAULTS[p]?.baseUrl || 'https://api.openai.com/v1');
      if (modelInput) modelInput.placeholder = isCustom ? '例如: deepseek-chat / Qwen/Qwen2.5-7B' : '例如 ' + (AI_PROVIDER_DEFAULTS[p]?.model || 'gpt-4o-mini');
      // Reset userEdited flag and fill provider defaults on switch
      const d = AI_PROVIDER_DEFAULTS[p];
      if (baseUrlInput) { baseUrlInput.dataset.userEdited = ''; if (d) baseUrlInput.value = d.baseUrl || ''; }
      if (modelInput) { modelInput.dataset.userEdited = ''; if (d) modelInput.value = d.model || ''; }
      // Hide previous model list
      var prevList = document.getElementById('aiModelList');
      if (prevList) prevList.style.display = 'none';
    });
  });
  // Mark inputs as user-edited
  document.querySelectorAll('.ai-input').forEach(inp => {
    inp.addEventListener('input', function() { this.dataset.userEdited = '1'; });
  });
  // Manual fetch models button → populate <select> dropdown
  document.getElementById('aiFetchModelsBtn').addEventListener('click', function() {
    const selectEl = document.getElementById('aiModelList');
    const modelInput = document.getElementById('aiModel');
    const statusEl = document.getElementById('aiStatus');
    const cfg = collectAiConfig();
    if (!cfg.baseUrl) { selectEl.style.display = 'none'; return; }
    // Require API key for providers that need one (skip Ollama)
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
      if (statusEl) { statusEl.textContent = '⚠️ 请先填写 API Key'; statusEl.style.color = '#e67e22'; }
      selectEl.style.display = 'none';
      return;
    }
    selectEl.style.display = 'block';
    selectEl.innerHTML = '<option value="">⏳ 获取中...</option>';
    selectEl.disabled = true;
    fetchModels(cfg).then(function(models) {
      selectEl.disabled = false;
      if (!models || models.length === 0) {
        selectEl.innerHTML = '<option value="">暂无可用模型</option>';
        return;
      }
      var currentModel = modelInput.value;
      selectEl.innerHTML = '<option value="">选择模型 (' + models.length + ' 个)</option>' +
        models.map(function(m) {
          var sel = m === currentModel ? ' selected' : '';
          return '<option value="' + escapeAttr(m) + '"' + sel + '>' + escapeHtml(m) + '</option>';
        }).join('');
    }).catch(function(e) {
      selectEl.disabled = false;
      selectEl.innerHTML = '<option value="">⚠️ 获取失败: ' + escapeHtml(e.message || e) + '</option>';
    });
  });
  // Model select change → fill input
  document.getElementById('aiModelList').addEventListener('change', function() {
    var val = this.value;
    if (val) {
      document.getElementById('aiModel').value = val;
      document.getElementById('aiModel').dataset.userEdited = '1';
    }
  });
  // Test connection
  document.getElementById('aiTestBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('aiStatus');
    statusEl.textContent = '测试中...';
    statusEl.style.color = 'var(--text-secondary)';
    const testCfg = collectAiConfig();
    try {
      const result = await testConnection(testCfg);
      statusEl.textContent = '✅ 连接成功 (' + result.latency + 'ms): ' + (result.response || '').slice(0, 50);
      statusEl.style.color = '#27ae60';
    } catch(e) {
      statusEl.textContent = '❌ 连接失败: ' + (e.message || e);
      statusEl.style.color = '#e74c3c';
    }
  });
  // Save config
  document.getElementById('aiSaveBtn').addEventListener('click', () => {
    const newCfg = collectAiConfig();
    Object.assign(aiConfig, newCfg);
    saveAiConfig();
    showToast('AI 配置已保存');
    closeSheet();
  });
}

function collectAiConfig() {
  const selectedProvider = sheet.querySelector('.theme-opt.selected');
  const provider = selectedProvider ? selectedProvider.dataset.provider : aiConfig.provider;
  return {
    provider: provider,
    providerLabel: document.getElementById('aiProviderLabel')?.value || '',
    apiKey: document.getElementById('aiApiKey')?.value || '',
    baseUrl: document.getElementById('aiBaseUrl')?.value || '',
    model: document.getElementById('aiModel')?.value || '',
    temperature: parseFloat(document.getElementById('aiTemp')?.value) || 0.3,
    maxTokens: parseInt(document.getElementById('aiMaxTokens')?.value) || 4096
  };
}

// ===== AI Summary Sheet =====
function showAiSummarySheet() {
  const modes = [
    { id: 'tlDr', label: '简要概括' },
    { id: 'detailed', label: '详细总结' },
    { id: 'keyPoints', label: '关键要点' },
    { id: 'structured', label: '结构化分析' }
  ];
  const html = `
    <div class="sheet-handle"></div>
    <div class="sheet-title">🤖 AI 总结</div>
    <div class="sheet-group">
      <div class="sheet-label">总结模式</div>
      <div class="theme-options">
        ${modes.map(m => `<button class="theme-opt${m.id === 'tlDr' ? ' selected' : ''}" data-mode="${m.id}">${m.label}</button>`).join('')}
      </div>
    </div>
    <div class="sheet-group" style="margin-top:12px">
      <div class="sheet-label">正在使用: ${aiConfig.provider === 'custom' && aiConfig.providerLabel ? aiConfig.providerLabel : AI_PROVIDER_LABELS[aiConfig.provider] || aiConfig.provider} / ${aiConfig.model || AI_PROVIDER_DEFAULTS[aiConfig.provider]?.model || '未配置'}</div>
    </div>
    <div class="sheet-group" style="margin-top:12px;display:flex;gap:8px">
      <button id="aiSummaryGo" style="flex:1;padding:10px;border:none;border-radius:6px;background:var(--accent);color:#fff;cursor:pointer;font-size:14px;font-weight:600">开始总结</button>
      <button id="aiSummaryClose" style="flex:1;padding:10px;border:none;border-radius:6px;background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer;font-size:14px">取消</button>
    </div>
    <div id="aiSummaryResult" style="margin-top:12px;padding:12px;background:var(--bg);border-radius:var(--radius-sm);font-size:14px;line-height:1.6;white-space:pre-wrap;max-height:50vh;overflow-y:auto;display:none"></div>
    <div id="aiSummaryActions" style="margin-top:8px;display:none;gap:8px;justify-content:flex-end">
      <button id="aiSummaryCopy" style="padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px">📋 复制</button>
      <button id="aiSummarySave" style="padding:6px 14px;border:none;border-radius:6px;background:var(--primary);color:#fff;cursor:pointer;font-size:13px">💾 保存</button>
    </div>
    <div id="aiSummaryStatus" style="margin-top:8px;font-size:12px;color:var(--text-secondary);text-align:center"></div>
  `;
  openSheet(html);
  // Mode selector
  sheet.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      sheet.querySelectorAll('.theme-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  // Close
  document.getElementById('aiSummaryClose').addEventListener('click', closeSheet);
  // Copy summary
  document.getElementById('aiSummaryCopy').addEventListener('click', function() {
    var txt = document.getElementById('aiSummaryResult').textContent;
    if (!txt) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function() { showToast('已复制到剪贴板'); }).catch(function(){});
    } else {
      var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      showToast('已复制到剪贴板');
    }
  });
  // Save summary as file
  document.getElementById('aiSummarySave').addEventListener('click', function() {
    var txt = document.getElementById('aiSummaryResult').textContent;
    if (!txt) return;
    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'AI总结_' + new Date().toISOString().slice(0,10) + '.txt'; a.click();
    URL.revokeObjectURL(url);
    showToast('已保存文件');
  });
  // Run
  document.getElementById('aiSummaryGo').addEventListener('click', async () => {
    const resultEl = document.getElementById('aiSummaryResult');
    const statusEl = document.getElementById('aiSummaryStatus');
    const mode = sheet.querySelector('.theme-opt.selected')?.dataset?.mode || 'tlDr';
    // Get content
    let text = '';
    if (state.fileType === 'img') {
      statusEl.textContent = '⚠️ 图片内容无法通过 AI 总结，请使用支持视觉的模型';
      statusEl.style.color = '#e67e22';
      return;
    }
    if (state.fileType === 'pdf') {
      if (typeof _pdfTextCache !== 'undefined' && _pdfTextCache) {
        text = _pdfTextCache.slice(0, 8000);
      } else if (typeof extractPdfText === 'function') {
        statusEl.textContent = '⏳ 正在提取PDF文本...';
        statusEl.style.color = 'var(--text-secondary)';
        try {
          var pdfText = await extractPdfText(state.fileContent);
          text = pdfText.slice(0, 8000);
        } catch(e) { text = ''; }
      }
    } else if (state.fileType === 'xlsx') {
      text = document.querySelector('.csv-table-wrap')?.textContent || document.querySelector('.g-sheet')?.textContent || '';
    } else {
      const mdBody = document.getElementById('mdContent');
      text = (mdBody?.innerText || '');
      if (text === '') {
        try { text = htmlFrame?.contentWindow?.document?.body?.innerText || htmlFrame?.contentDocument?.body?.innerText || ''; } catch(e) { text = ''; }
      }
    }
    text = text.trim().slice(0, 8000); // Limit length
    if (!text) { statusEl.textContent = '⚠️ 没有可总结的内容'; statusEl.style.color = '#e67e22'; return; }
    statusEl.textContent = '⏳ AI 思考中...';
    statusEl.style.color = 'var(--text-secondary)';
    resultEl.style.display = 'none';
    try {
      const summary = await summarizeText(text, mode);
      resultEl.textContent = summary;
      resultEl.style.display = 'block';
      // Show copy & save buttons
      var actionsEl = document.getElementById('aiSummaryActions');
      if (actionsEl) { actionsEl.style.display = 'flex'; }
      statusEl.textContent = '✅ 总结完成';
      statusEl.style.color = '#27ae60';
    } catch(e) {
      var errMsg = e.message || String(e);
      if (errMsg.includes('image') || errMsg.includes('vision') || errMsg.includes('multimodal')) {
        errMsg = '当前模型不支持图片/视觉输入，请切换支持 vision 的模型';
      }
      statusEl.textContent = '❌ ' + errMsg;
      statusEl.style.color = '#e74c3c';
    }
  });
}

// ===== Toolbar actions =====
$('tbTheme').addEventListener('click', showThemeSheet);
$('tbFont').addEventListener('click', showFontSheet);
$('tbStats').addEventListener('click', () => showStats());
$('tbAi').addEventListener('click', showAiSheet);

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
  _pdfTextCache = null; // reset cache
  showLoading('正在加载 PDF...');
  // Background: extract text for AI summary (use a copy of buf to avoid detaching the original)
  extractPdfText(buf.slice(0)).then(function(t) { _pdfTextCache = t; }).catch(function(){});
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

// ===== PDF text extraction for AI summary =====
var _pdfTextCache = null;
var _pdfTextPromise = null;

async function extractPdfText(buf) {
  if (_pdfTextCache !== null) return _pdfTextCache;
  if (_pdfTextPromise) return _pdfTextPromise;
  if (!buf || !buf.byteLength) return '';
  _pdfTextPromise = (async function() {
    try {
      var baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
      if (!_pdfjsLib) {
        _pdfjsLib = await import(baseUrl + 'lib/pdf.min.mjs');
        _pdfjsLib.GlobalWorkerOptions.workerSrc = baseUrl + 'lib/pdf.worker.min.mjs';
      }
      var loadingTask = _pdfjsLib.getDocument({ data: new Uint8Array(buf) });
      var pdf = await loadingTask.promise;
      var texts = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var tc = await page.getTextContent();
        texts.push(tc.items.map(function(item) { return item.str; }).join(' '));
      }
      _pdfTextCache = texts.join('\n\n').trim();
      return _pdfTextCache;
    } catch(e) {
      console.warn('PDF text extraction failed:', e);
      _pdfTextCache = '';
      return '';
    }
  })();
  return _pdfTextPromise;
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
    // PDF: use pdf.js to render all pages individually, print page by page
    if (state.fileType === 'pdf' && state.fileContent && state.fileContent.byteLength) {
      showToast('正在生成打印内容...');
      try {
        // Load pdf.js (use global if available, otherwise dynamic import)
        var _pdfPrint = null;
        if (typeof _pdfjsLib !== 'undefined' && _pdfjsLib) {
          _pdfPrint = _pdfjsLib;
        } else {
          var _baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
          _pdfPrint = await import(_baseUrl + 'lib/pdf.min.mjs');
          _pdfPrint.GlobalWorkerOptions.workerSrc = _baseUrl + 'lib/pdf.worker.min.mjs';
        }
        var _buf = state.fileContent.slice(0);
        var _doc = await _pdfPrint.getDocument({ data: new Uint8Array(_buf) }).promise;
        var _totalPages = _doc.numPages;
        var _dpr = Math.min(window.devicePixelRatio || 1, 2);
        var _pagesHtml = '';
        var _pageWidth = 595;
        for (var _pi = 1; _pi <= _totalPages; _pi++) {
          var _page = await _doc.getPage(_pi);
          var _vp = _page.getViewport({ scale: 1 });
          var _scale = 595 / _vp.width * _dpr;
          var _vpHi = _page.getViewport({ scale: _scale });
          if (_pi === 1) _pageWidth = _vpHi.width;
          var _c = document.createElement('canvas');
          _c.width = _vpHi.width;
          _c.height = _vpHi.height;
          var _ctx = _c.getContext('2d');
          _ctx.fillStyle = '#fff';
          _ctx.fillRect(0, 0, _vpHi.width, _vpHi.height);
          await _page.render({ canvasContext: _ctx, viewport: _vpHi }).promise;
          _pagesHtml += '<img src="' + _c.toDataURL('image/png') + '" style="width:100%;height:auto;display:block;page-break-after:always" />';
        }
        var _printIframe = document.createElement('iframe');
        _printIframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:100%;height:100%;border:none;';
        document.body.appendChild(_printIframe);
        var _iDoc = _printIframe.contentDocument || _printIframe.contentWindow.document;
        _iDoc.open();
        _iDoc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=' + _pageWidth + '"><title>' + escapeHtml(state.fileName) + '</title><style>@page{margin:0}body{margin:0;padding:0;background:#fff}img{page-break-after:always;max-width:100%;height:auto;display:block;margin:0;padding:0}</style></head><body>' + _pagesHtml + '</body></html>');
        _iDoc.close();
        _printIframe.onload = function() {
          setTimeout(function() {
            try { _printIframe.contentWindow.print(); } catch(e) { showToast('打印失败'); }
            setTimeout(function() { document.body.removeChild(_printIframe); }, 1000);
          }, 800);
        };
        showToast('请在打印对话框中选择"另存为 PDF"');
        return;
      } catch(e) {
        showToast('PDF 打印生成失败: ' + (e.message || ''));
        return;
      }
    }
    // Images: print current view directly (no UI chrome to worry about)
    if (state.fileType === 'img') {
      try { window.print(); } catch(e) { showToast('打印失败'); }
      showToast('请在打印对话框中选择"另存为 PDF"');
      return;
    }
    // Export as PDF via hidden iframe + print (for text-based content)
    var content = '';
    if (state.fileType === 'html' && htmlFrame.style.display !== 'none') {
      try {
        var doc = htmlFrame.contentDocument || htmlFrame.contentWindow.document;
        content = doc.body ? doc.body.innerHTML : '';
      } catch(e) { content = target.innerHTML; }
    } else {
      content = target.innerHTML;
    }
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
          try {
            const blob = await getContentAsDocx();
            const finalName = (state.fileName || 'untitled').replace(/\.[^.]+$/, '') + '.docx';
            await FileAPI.saveFile(blob, finalName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            showToast(`已保存为 ${finalName}`);
          } catch(e) { showToast('DOCX 生成失败: ' + (e.message || '')); }
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

