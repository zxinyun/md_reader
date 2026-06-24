# Tauri v2 + Capacitor 全平台打包技能

## 适用场景

将 Web 应用打包为 Tauri v2 桌面应用（Windows/macOS/Linux）+ Capacitor 移动应用（Android/iOS），通过 GitHub Actions 实现一键全平台构建和 Release。

---

## 架构概览

```
Web 前端 (HTML/CSS/JS)
├── Tauri v2 → 桌面端
│   ├── Windows: NSIS (.exe) + MSI (.msi)
│   ├── macOS: DMG
│   ├── Linux x64: AppImage + deb
│   └── Linux ARM64: AppImage + deb
└── Capacitor v8 → 移动端
    ├── Android: APK (debug 签名)
    └── iOS: xcarchive (未签名)

本地构建脚本: build.ps1 (Windows PowerShell 5.1+)
CI/CD: .github/workflows/build.yml (GitHub Actions)
```

---

## 一、项目配置（必须做对的基础）

### 1.1 tauri.conf.json

```json
{
  "productName": "你的应用名",
  "version": "1.0.0",
  "identifier": "com.your.app",
  "build": {
    "frontendDist": "../public",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": ""
  },
  "app": {
    "windows": [{
      "title": "你的应用名",
      "width": 1200,
      "height": 800,
      "dragDropEnabled": false
    }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi", "appimage", "deb", "dmg"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
    "windows": {
      "nsis": {
        "displayLanguageSelector": false,
        "installerIcon": "icons/icon.ico"
      },
      "wix": {
        "language": "zh-CN"
      }
    }
  }
}
```

**关键点：**
- `nsis` 和 `wix` 配置必须同时存在，不能互相替代
- `dragDropEnabled: false`（Tauri IPC 拖拽事件不可靠，用 HTML5 原生事件）
- `csp: null`（允许内联脚本和外部资源）
- `targets` 中同时包含 `nsis` 和 `msi`

### 1.2 Capacitor 配置

```json
{
  "appId": "com.your.app",
  "webDir": "public",
  "server": { "androidScheme": "https" }
}
```

**关键点：**
- `@capacitor/ios` 和 `@capacitor/android` **不要写入 `package.json`**，在 CI 中按需安装
- 避免 `npm ci` 因 lock 文件不同步失败

### 1.3 Tauri 构建缓存与增量编译

**强制前端文件变化时触发重新编译：**

Rust 增量编译不会自动检测 `../public/` 中 HTML/CSS/JS 的更改。需要在 `build.rs` 声明依赖，并在 `lib.rs` 嵌入 frontend 引用：

```rust
// build.rs
fn main() {
    println!("cargo:rerun-if-changed=../public/");
    tauri_build::build()
}

// lib.rs
const _FRONTEND_TRACKER: &[u8] = include_bytes!("../../public/index.html");
pub fn run() {
    let _ = _FRONTEND_TRACKER;  // 强制引用，防止 dead_code 优化
    tauri::Builder::default()
        // ...
        .run(tauri::generate_context!())
}
```

**原因：** 没有这两步时，只改 `index.html` 不会触发 Cargo 重新运行 `tauri::generate_context!()`，构建产物仍然是旧的 HTML。

### 1.4 .gitignore 必须包含

```
src-tauri/.cargo/config.toml
node_modules/
target/
```

**原因：** `.cargo/config.toml` 中的镜像源（如 rsproxy.cn）只适用于国内网络，GitHub Actions runner 在海外会超时。

---

## 二、GitHub Actions 完整 workflow

### 2.1 触发条件

```yaml
on:
  push:
    branches: [main, master]
    tags: ['v*']
  pull_request:
    branches: [main, master]
  workflow_dispatch:
    inputs:
      version:
        description: '版本号 (留空则使用 tag 名)'
        required: false
        type: string
```

### 2.2 版本号管理（单一事实来源）

```yaml
- name: Resolve version
  id: ver
  shell: bash
  run: |
    if [ "${{ github.event_name }}" = "workflow_dispatch" ] && [ -n "${{ inputs.version }}" ]; then
      echo "version=${{ inputs.version }}" >> $GITHUB_OUTPUT
    elif [ -n "${GITHUB_REF#refs/tags/v}" ] && [ "${GITHUB_REF#refs/tags/v}" != "${GITHUB_REF}" ]; then
      echo "version=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT
    else
      echo "version=0.0.0" >> $GITHUB_OUTPUT  # 注意：必须是纯数字，不能用 0.0.0-dev！
    fi

- name: Sync version to config files
  shell: bash
  run: |
    VERSION="${{ steps.ver.outputs.version }}"
    node -e "
      const fs = require('fs');
      const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
      tauri.version = '$VERSION';
      fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauri, null, 2) + '\n');
      const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
      pkg.version = '$VERSION';
      fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
      let cargo = fs.readFileSync('src-tauri/Cargo.toml','utf8');
      cargo = cargo.replace(/^version = \".*\"/m, 'version = \"$VERSION\"');
      fs.writeFileSync('src-tauri/Cargo.toml', cargo);
      // index.html — replace __APP_VERSION__ placeholder
      let html = fs.readFileSync('public/index.html', 'utf8');
      html = html.replace(/__APP_VERSION__/g, '$VERSION');
      fs.writeFileSync('public/index.html', html);
      // android/app/build.gradle — 同步 versionName + 自动计算 versionCode（跳过 0.0.0 回退，避免 versionCode=0）
      if ('$VERSION' !== '0.0.0') {
        let gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
        gradle = gradle.replace(/versionName \".*\"/, 'versionName \"$VERSION\"');
        const parts = '$VERSION'.split('.').map(Number);
        const vc = parts[0]*1000000 + (parts[1]||0)*1000 + (parts[2]||0);
        gradle = gradle.replace(/versionCode \d+/, 'versionCode ' + vc);
        fs.writeFileSync('android/app/build.gradle', gradle);
      }
    "
```

**需要同步版本的文件：**
- `src-tauri/tauri.conf.json` — Tauri 打包版本
- `package.json` — npm 包版本
- `src-tauri/Cargo.toml` — Rust crate 版本
- `public/index.html` — 应用内 About 对话框和 BUILD ID
- `android/app/build.gradle` — APK versionName + versionCode

**index.html 中的版本占位符：**
```javascript
const __APP_VERSION__ = '__APP_VERSION__';  // CI 替换为实际版本号
```
About 对话框和启动日志使用此变量显示版本。

**引用占位符时必须加防卫判断，防止占位符文本直接暴露给用户：**
```javascript
typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ !== '__APP_VERSION__' ? __APP_VERSION__ : 'dev'
```

**踩坑记录：**
- 版本回退值必须是 `0.0.0`（纯数字），不能是 `0.0.0-dev`，否则 WiX/MSI 构建失败
- WiX 要求版本号预发布标识必须是纯数字且 ≤ 65535
- 所有显示版本号的地方都必须从同一来源派生，避免版本不一致
- Cargo.toml 的版本号必须与 tauri.conf.json 同步，否则 tauri build 会警告不一致

### 2.3 桌面端构建（Tauri）

```yaml
build:
  strategy:
    fail-fast: false
    matrix:
      include:
        - platform: ubuntu-22.04
          args: ''
          artifact-name: linux-amd64-bundles
          artifact-path: |
            src-tauri/target/release/bundle/appimage/*.AppImage
            src-tauri/target/release/bundle/deb/*.deb
        - platform: ubuntu-24.04-arm
          args: '--target aarch64-unknown-linux-gnu'
          artifact-name: linux-arm64-bundles
          artifact-path: |
            src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/appimage/*.AppImage
            src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/deb/*.deb
        - platform: macos-latest
          args: '--target x86_64-apple-darwin'
          artifact-name: macos-bundle
          artifact-path: |
            src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg
        - platform: windows-latest
          args: ''
          artifact-name: windows-bundles
          artifact-path: |
            src-tauri/target/release/bundle/nsis/*.exe
            src-tauri/target/release/bundle/msi/*.msi
  runs-on: ${{ matrix.platform }}
  timeout-minutes: 60
  steps:
    - uses: actions/checkout@v4
    # ... 版本号同步 ...
    - uses: actions/setup-node@v4
      with: { node-version: lts/*, cache: npm }
    - uses: dtolnay/rust-toolchain@stable
      with:
        targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
    - name: Install Linux system deps
      if: runner.os == 'Linux'
      run: |
        sudo apt-get update
        sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
    - uses: swatinem/rust-cache@v2
      with: { workspaces: './src-tauri -> target' }
    - run: npm ci
    - run: npm run tauri:build -- ${{ matrix.args }}
    - uses: actions/upload-artifact@v4
      with: { name: '${{ matrix.artifact-name }}', path: '${{ matrix.artifact-path }}' }
```

**关键点：**
- `fail-fast: false`：一个平台失败不影响其他平台
- Linux ARM64 需要单独的 runner（`ubuntu-24.04-arm`）
- macOS 需要安装 `aarch64-apple-darwin` target（用于交叉编译）
- `npm ci` 要求 `package.json` 和 `package-lock.json` 严格同步

### 2.4 Android 构建（Capacitor）

```yaml
android:
  runs-on: ubuntu-latest
  timeout-minutes: 60
  steps:
    - uses: actions/checkout@v4
    # ... 版本号同步 ...
    - uses: actions/setup-node@v4
      with: { node-version: lts/*, cache: npm }
    - uses: actions/setup-java@v4
      with: { distribution: 'zulu', java-version: 21 }  # Capacitor v8 要求 Java 21+
    - uses: android-actions/setup-android@v3
    - run: npm ci
    - name: Setup debug keystore
      uses: actions/cache@v4
      with:
        path: ~/.android/debug.keystore
        key: android-debug-keystore  # 固定 key 保证签名一致
    - name: Generate debug keystore (if not cached)
      run: |
        if [ ! -f "$HOME/.android/debug.keystore" ]; then
          mkdir -p $HOME/.android
          keytool -genkeypair -v -keystore $HOME/.android/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
        fi
    - run: npx cap sync android
    - name: Build Android APK
      run: |
        cd android
        chmod +x gradlew  # Windows 克隆不保留执行权限
        ./gradlew assembleDebug  # 用 debug 签名，避免签名问题
    - name: Rename APK
      run: |
        VERSION="${{ steps.ver.outputs.version }}"
        mv android/app/build/outputs/apk/debug/app-debug.apk "android/app/build/outputs/apk/debug/你的应用_${VERSION}.apk"
    - uses: actions/upload-artifact@v4
      with: { name: android-apk, path: 'android/app/build/outputs/apk/debug/*.apk' }
```

**踩坑记录：**
- Java 21+（Capacitor v8 / Gradle 8.14+ 要求，Java 17 会报 `invalid source release: 21`）
- `chmod +x gradlew`（Git 在 Windows 克隆不保留 Unix 权限位）
- debug keystore 必须用 `actions/cache` 缓存（否则每次签名不同，无法覆盖安装）
- 用 `assembleDebug` 而非 `assembleRelease`（避免签名配置复杂度）

### 2.5 iOS 构建（Capacitor）

```yaml
ios:
  runs-on: macos-latest
  timeout-minutes: 60
  steps:
    - uses: actions/checkout@v4
    # ... 版本号同步 ...
    - uses: actions/setup-node@v4
      with: { node-version: lts/*, cache: npm }
    - run: npm ci
    - run: npm install @capacitor/ios  # CI 内联安装，不写入 package.json
    - run: |
        npx cap add ios
        npx cap sync ios
    - name: Build iOS
      run: |
        cd ios/App
        xcodebuild -project App.xcodeproj \  # Capacitor v8 用 .xcodeproj，非 .xcworkspace
          -scheme App \
          -configuration Release \
          -sdk iphoneos \
          -archivePath $PWD/build/App.xcarchive \
          CODE_SIGNING_REQUIRED=NO \
          CODE_SIGNING_ALLOWED=NO \
          archive
    - name: Package iOS app
      run: |
        VERSION="${{ steps.ver.outputs.version }}"
        cd ios/App/build
        zip -r "你的应用_${VERSION}_ios.zip" App.xcarchive  # xcarchive 是目录，必须 zip
    - uses: actions/upload-artifact@v4
      with: { name: ios-app, path: 'ios/App/build/*.zip' }
```

**踩坑记录：**
- Capacitor v8 iOS 不再使用 CocoaPods，直接用 `.xcodeproj`
- `.xcarchive` 是目录（Xcode archive bundle），必须 zip 后上传
- `CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO` 生成未签名归档，需要 Apple Developer 账号签名后安装

### 2.6 Release 统一发布

```yaml
release:
  if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')
  needs: [build, android, ios]  # 等待所有构建完成
  runs-on: ubuntu-latest
  permissions: { contents: write }
  steps:
    - uses: actions/checkout@v4
    - name: Get version
      run: |
        if [ "${{ github.event_name }}" = "workflow_dispatch" ] && [ -n "${{ inputs.version }}" ]; then
          echo "APP_VERSION=${{ inputs.version }}" >> $GITHUB_ENV
        else
          echo "APP_VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_ENV
        fi
    - uses: actions/download-artifact@v4
    - name: Delete old release if exists
      continue-on-error: true
      run: gh release delete v${{ env.APP_VERSION }} --yes
      env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}', GH_REPO: '${{ github.repository }}' }
    - name: Create Release
      uses: softprops/action-gh-release@v2
      with:
        tag_name: 'v${{ env.APP_VERSION }}'
        name: '你的应用 v${{ env.APP_VERSION }}'
        body: |
          ## 你的应用 v${{ env.APP_VERSION }}
          ### 桌面版（Tauri）
          - **linux-amd64-bundles**: x86_64 AppImage + deb
          - **linux-arm64-bundles**: ARM64 AppImage + deb
          - **macos-bundle**: macOS DMG
          - **windows-bundles**: Windows NSIS + MSI
          ### 移动版（Capacitor）
          - **android-apk**: Android APK
          - **ios-app**: iOS 归档（需签名）
        draft: ${{ github.event_name == 'workflow_dispatch' }}
        files: |
          linux-amd64-bundles/**/*
          linux-arm64-bundles/**/*
          macos-bundle/**/*
          windows-bundles/**/*
          android-apk/**/*
          ios-app/**/*.zip
```

---

## 三、常见问题速查表

### 3.1 构建失败

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `invalid source release: 21` | Java 版本不够 | 用 Java 21+（`java-version: 21`） |
| `./gradlew: Permission denied` | 缺少执行权限 | `chmod +x gradlew` |
| `No Podfile found` | Capacitor v8 不用 CocoaPods | 用 `-project App.xcodeproj` |
| `optional pre-release identifier must be numeric-only` | 版本号含非数字预发布标识 | 回退版本用 `0.0.0` 不用 `0.0.0-dev` |
| `Missing '(' after 'if'` | Windows PowerShell 语法 | 所有步骤加 `shell: bash` |
| `npm ci` lock 不同步 | package.json 和 lock 文件不一致 | CI 用 `npm install` 或内联安装依赖 |
| `light.exe` WiX 崩溃 | Tauri 下载的 WiX 不兼容 | 保留 `wix` 配置，不要删除 |
| Rust `target/` 目录过大 (10GB+) | 反复构建积累大量增量缓存 | `cargo clean` 或 `cargo clean -p <crate>` |

### 3.2 运行时问题

| 现象 | 原因 | 解决方案 |
|-----|------|---------|
| PDF 打开空白 | Android WebView 不支持 iframe+blob | 用 pdf.js 渲染到 canvas |
| PDF 文字模糊 | 未乘以 devicePixelRatio | `scale *= window.devicePixelRatio` |
| 双指缩放无反应 | viewport `user-scalable=no` | 动态修改 viewport + 手动 touch 事件 |
| APK 签名不一致 | CI 每次生成新 keystore | `actions/cache` 缓存 debug.keystore |
| 拖拽文件不触发事件 | Tauri IPC 拖拽事件不可靠 | 用 HTML5 原生 drag/drop 事件 |
| fs 权限报错 | permission identifier 写错 | 查 `permissions/autogenerated/commands/` |
| `fr.readAsArrayBuffer is not a function` | 浏览器扩展（如 Immersive Translate）覆盖 `FileReader.prototype.readAsArrayBuffer` | 用 `Blob.arrayBuffer()` 代替 FileReader，详见 五.5 |
| PPT "完整渲染" 按钮无反应 | `innerHTML` + `getElementById` 在 DOM 替换后丢失引用；`onclick` 被扩展拦截 | 用 `document.createElement` 保存变量引用 + `addEventListener` |
| PPT 完整渲染后其他文档打不开 | `PptxViewJS.loadFile()` 可能 detach 原始 ArrayBuffer；异步渲染覆盖新文档内容 | `arrayBuffer.slice(0)` 传入副本；操作序列计数器 `_opSeq` 检测过期操作 |
| 异步操作结果被后续操作覆盖 | 多个快速操作共享状态未做隔离 | 引入 `_opSeq` 序列计数器，每次操作增量，yield 点检查 `activeOp.seq !== mySeq` 时 return |

### 3.3 Release 问题

| 现象 | 原因 | 解决方案 |
|-----|------|---------|
| 工作流未触发 | 旧 tag 不产生 push 事件 | 打新 tag 或手动触发 |
| 两个 workflow 冲突 | 各自创建 Release | 合并到一个 workflow，用 `needs` 串联 |
| iOS 上传了几十个文件 | xcarchive 是目录没 zip | 构建后 `zip -r` 压缩再上传 |
| Release 缺少产物 | artifact glob 不匹配 | 确认路径精确到文件 |

---

## 四、发版流程

```bash
# 1. 确认代码已提交
git add . && git commit -m "功能: xxx"

# 2. 推送到 main
git push

# 3. 打 tag 触发全平台构建
git tag v1.0.0
git push origin v1.0.0

# 4. 等待 GitHub Actions 构建完成（约 30-60 分钟）
# 5. 在 Releases 页面查看产物
```

**发版命令速记：**
```bash
# 删除旧 tag（如需要）
git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0

# 批量删除所有本地 tag
git tag -d $(git tag -l)

# 批量删除所有远程 tag
git push origin --delete $(git tag -l)
```

---

## 五、移动端 PDF 查看器实现模式

### 5.1 架构

```
Desktop: iframe + blob URL（浏览器内置 PDF 查看器）
Mobile:  pdf.js + canvas（逐页渲染）
```

### 5.2 关键代码模式

```javascript
// 动态加载 pdf.js
var baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
const pdfjsLib = await import(baseUrl + 'lib/pdf.min.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = baseUrl + 'lib/pdf.worker.min.mjs';

// 渲染 scale 考虑 devicePixelRatio
var scale = Math.min(window.innerWidth / 600, 2.5) * (window.devicePixelRatio || 1);

// 双指缩放：CSS transform 实时预览 + canvas 重渲染
wrapper.addEventListener('touchstart', function(e) {
  if (e.touches.length === 2) {
    e.preventDefault();  // 必须在 wrapper 级别，scrollContainer 会被滚动消费
    // ... 记录初始距离
  }
}, { passive: false });

wrapper.addEventListener('touchmove', function(e) {
  if (e.touches.length === 2 && pinchState) {
    e.preventDefault();
    pagesContainer.style.transform = 'scale(' + ratio + ')';  // 零延迟预览
  }
}, { passive: false });

wrapper.addEventListener('touchend', function(e) {
  if (e.touches.length < 2 && pinchState) {
    pagesContainer.style.transform = '';
    currentScale = pinchPending;
    renderAllPages();  // 松手后重新渲染 canvas
  }
});
```

### 5.3 标注架构

```
PDF canvas（只读渲染层）
  └── Annotation canvas（半透明标注层，绝对定位）
       └── HTML div（便签 marker，支持事件和 tooltip）
```

- 双 canvas 分离：缩放时 PDF 重绘，标注坐标不变
- 便签用 HTML div 而非 canvas（支持 click 事件和 tooltip）

### 5.4 viewport 动态管理

```javascript
// PDF 打开时
var origContent = viewport.content;
viewport.content = 'width=device-width, initial-scale=1.0, minimum-scale=0.5, maximum-scale=5.0, user-scalable=yes';

// PDF 关闭时
viewport.content = origContent;
```

### 5.5 通用文件读取兼容 (Blob.arrayBuffer() vs FileReader)

**现象：** `TypeError: fr.readAsArrayBuffer is not a function`

**Root Cause：** 某些浏览器扩展（如 Immersive Translate）在 `file://` 协议下初始化失败时，会覆盖 `FileReader.prototype.readAsArrayBuffer`，导致所有依赖 FileReader 的文件读取崩溃。

**解决方案：** 优先使用 `Blob.arrayBuffer()`（现代浏览器原生 Promise API），FileReader 作为旧浏览器回退：

```javascript
function blobToArrayBuffer(blob) {
  // 优先使用原生 Blob.arrayBuffer() 绕过 FileReader
  if (blob.arrayBuffer) {
    return blob.arrayBuffer();
  }
  // 旧浏览器回退
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = reject;
    r.readAsArrayBuffer(blob);
  });
}
```

**readFileBlob 函数统一转发到 FileAPI 方法，不再手动创建 FileReader：**
```javascript
async function readFileBlob(file, binary) {
  if (binary) return await FileAPI.readAsArrayBuffer(file);
  try {
    return await FileAPI.readAsText(file);
  } catch(e) {
    var arr = await FileAPI.readAsArrayBuffer(file);
    return decodeText(arr);
  }
}
```

### 5.6 DOM 事件绑定与异步操作安全

**按钮无反应的根因：**

| 错误实践 | 正确做法 |
|---------|---------|
| `innerHTML` + `getElementById`（DOM 替换后 ID 重复/丢失） | `document.createElement` 保存变量引用 |
| `onclick = handler`（扩展可拦截属性赋值） | `addEventListener('click', handler)` |
| 共享变量无操作隔离（异步覆盖新内容） | 序列计数器 `_opSeq` + yield 点检测 |

**序列计数器模式（防止异步操作结果被后续操作覆盖）：**
```javascript
var _opSeq = 0;  // 全局计数器
var activeOp = {};  // 当前操作状态

function openImportedFile(idx) {
  activeOp.aborted = true;  // 终止旧渲染
  activeOp.seq = ++_opSeq;  // 更新序列号
  // ... 启动新渲染
}

// 渲染函数捕获序列号，yield 点检查
async function renderPptxFull(arrayBuffer) {
  var mySeq = ++_opSeq;  // 捕获当前序列
  activeOp.seq = mySeq;
  // ... 在每个 await 之后检查
  if (activeOp.seq !== mySeq) return;  // 已被后续操作取代
  await new Promise(r => setTimeout(r, 0));  // yield
  if (activeOp.seq !== mySeq) return;
  // ... 继续渲染
}
```

**ArrayBuffer 保护（防止库内部 detach 原始 buffer）：**
```javascript
// PptxViewJS.loadFile() 可能 detach 传入的 ArrayBuffer
// 传入副本保护原始 buffer
viewer.loadFile(arrayBuffer.slice(0));
```

---

## 六、CI 检查清单（每次发版前确认）

### 环境配置
- [ ] `src-tauri/.cargo/config.toml` 在 `.gitignore` 中（不提交镜像源）
- [ ] `package-lock.json` 与 `package.json` 同步（本地跑 `npm install` 确认）
- [ ] `capacitor.config.json` 的 `webDir` 指向正确的前端目录

### Tauri 配置
- [ ] `tauri.conf.json` 中 `nsis` 和 `wix` 配置同时存在
- [ ] `targets` 包含所有需要的打包格式
- [ ] `bundle.icon` 包含所有需要的图标尺寸
- [ ] `build.rs` 有 `cargo:rerun-if-changed=../public/`
- [ ] `lib.rs` 有 `_FRONTEND_TRACKER` 强制重新编译

### CI Workflow
- [ ] 所有 shell 步骤都声明了 `shell: bash`（Windows 兼容）
- [ ] Android 用 Java 21+
- [ ] `gradlew` 构建前有 `chmod +x`
- [ ] debug keystore 用 `actions/cache` 缓存
- [ ] iOS 用 `-project App.xcodeproj`（非 `-workspace`）
- [ ] iOS xcarchive 上传前 zip 压缩
- [ ] 版本回退值是 `0.0.0`（纯数字）
- [ ] Release job 用 `needs: [build, android, ios]` 等待所有构建
- [ ] 版本同步覆盖所有配置文件（tauri.conf.json / package.json / Cargo.toml / index.html）
- [ ] 版本占位符有防卫判断（`__APP_VERSION__ !== '__APP_VERSION__'`）

### 代码兼容性
- [ ] DOM 事件绑定用 `addEventListener` 而非 `onclick`
- [ ] 文件读取避免依赖 `FileReader`，优先 `Blob.arrayBuffer()`
- [ ] 异步操作使用序列计数器 (`_opSeq`) 防止覆盖
- [ ] ArrayBuffer 传给第三方库时用 `.slice(0)` 副本
- [ ] 按钮创建用 `document.createElement` + 变量引用，不用 innerHTML + getElementById

### 移动端功能
- [ ] PDF 用 pdf.js 渲染（不用 iframe）
- [ ] 渲染 scale 乘以 `devicePixelRatio`
- [ ] 双指缩放：动态 viewport + wrapper 级 touch 事件（PDF）
- [ ] 双指缩放：contentArea 级 touch 事件（通用内容）
- [ ] 工具栏两行布局（移动端不会溢出）
- [ ] 标注工具可折叠
- [ ] 自动恢复上次会话（无确认弹窗）
- [ ] 版本号在 About 对话框中动态显示

---

## 七、调试技巧

### 7.1 本地调试 Tauri

```bash
# 开发模式（热重载）
npm run tauri:dev

# 构建测试
npm run tauri:build
```

### 7.2 本地调试 Capacitor Android

```bash
npx cap sync android
cd android && ./gradlew assembleDebug
# APK 在 android/app/build/outputs/apk/debug/
```

### 7.3 本地调试 Capacitor iOS

```bash
npx cap sync ios
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator
```

### 7.4 CI 日志查看

```bash
# 查看最近的 workflow run
gh run list --limit 5

# 查看特定 run 的日志
gh run view <run-id> --log
```

### 7.5 本地多平台构建（build.ps1）

项目根目录的 `build.ps1` 支持多目标构建，自动检测工具路径：

```powershell
.\build.ps1 -Help             # 显示帮助
.\build.ps1                   # 构建桌面端 (tauri, debug)
.\build.ps1 tauri -Release    # 构建桌面端 (release)
.\build.ps1 android           # 构建 Android APK
.\build.ps1 ios               # 构建 iOS (仅 macOS)
.\build.ps1 all               # 依次构建所有平台
```

**自动检测的工具路径（按优先级）：**
1. `$CARGO_HOME\bin`
2. `$USERPROFILE\.cargo\bin`
3. `$LOCALAPPDATA\Programs\Rust\bin`
4. `C:\Program Files\Rust\bin`
5. NSIS: `${env:ProgramFiles(x86)}\NSIS`

**踩坑记录：**
- Rust target 目录 11GB+ 是正常的（debug + release 双层缓存），`cargo clean` 可清理
- `build.ps1` 只在 Windows 上运行（PowerShell 5.1+）
- CI 用 `build.yml`（GitHub Actions），**不要**手动在 CI 中调用 `build.ps1`

### 7.6 参考历史问题文档

完整的问题分析记录见项目根目录的 `LESSONS.md`，包含 31 条踩坑记录，涵盖：

| 编号 | 问题 | 分类 |
|------|------|------|
| 1-2 | Tauri v2 权限 identifier 命名规则 + dialog:default 覆盖不全 | 配置 |
| 3 | Tauri 拖拽事件不可靠（Windows） | 桌面端 |
| 4 | `const` 导致运行时赋值失败 | JavaScript |
| 5 | 异步操作竞态（Service Worker + Session Restore） | 前端 |
| 6 | 清空/重置遗漏状态字段 | 前端 |
| 7-9 | 导航适配所有文件类型 + 图片导航空缓冲区 | 前端 |
| 10-17 | CI/CD 构建问题集合 | CI/CD |
| 18-19 | Android WebView PDF + 分辨率 | 移动端 |
| 20 | APK 签名一致性 | CI/CD |
| 21-22 | 版本号管理 + Shell 兼容性 | CI/CD |
| 23 | PDF 查看器交互功能 | 前端 |
| 24-25 | WiX 版本号 + wix 配置不能删除 | CI/CD |
| 26-29 | Android 双指缩放 + Canvas 渲染 | 移动端 |
| 30 | 自动恢复会话去掉确认弹窗 | 移动端 |
| 31 | 版本号同步覆盖所有配置文件 | CI/CD |

---

## 八、平台差异速查

| 特性 | Windows | macOS | Linux | Android | iOS |
|------|---------|-------|-------|---------|-----|
| 打包格式 | NSIS + MSI | DMG | AppImage + deb | APK | xcarchive |
| PDF 渲染 | iframe | iframe | iframe | pdf.js | pdf.js |
| PPT 完整渲染 | Canvas (pptxviewjs) | Canvas (pptxviewjs) | Canvas (pptxviewjs) | Canvas (pptxviewjs) | Canvas (pptxviewjs) |
| 拖拽 | HTML5 | HTML5 | HTML5 | N/A | N/A |
| 文件选择 | 原生对话框 | 原生对话框 | 原生对话框 | Web input | Web input |
| 文件读取 | FileAPI (read_file) | FileAPI (read_file) | FileAPI (read_file) | Blob.arrayBuffer() | Blob.arrayBuffer() |
| 双指缩放 | N/A | N/A | N/A | 手动实现 | 手动实现 |
| 签名 | 代码签名 | Apple ID | 无 | debug keystore | 需 Apple Developer |
