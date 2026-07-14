
const __BUILD_ID__ = '20260619-0500';
const __APP_VERSION__ = '__APP_VERSION__';
const __VERSION__ = '1.0.9';
const __FEATURES__ = { multiFile: true, imageSupport: true, debugPanel: true };
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
