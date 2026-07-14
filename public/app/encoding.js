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
