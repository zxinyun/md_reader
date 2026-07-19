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
        var savePath = await tauriCmd('plugin:dialog|save', {
          options: { defaultPath: filename }
        });
        if (!savePath) return;
        if (typeof content === 'string') {
          await tauriCmd('plugin:fs|write_text_file', { path: savePath, contents: content });
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
