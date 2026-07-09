# 通用阅读器 / Universal Reader

一个支持 **15+ 种文件格式** 的跨平台万能阅读器。纯前端架构，零后端依赖，离线可用。

[![Build](https://github.com/zxinyun/md_reader/actions/workflows/build.yml/badge.svg)](https://github.com/zxinyun/md_reader/actions/workflows/build.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Release](https://img.shields.io/github/v/release/zxinyun/md_reader)](https://github.com/zxinyun/md_reader/releases)

---

## 功能亮点

### 全格式一站式阅读

| 类别 | 支持格式 |
|------|----------|
| 文档 | Markdown, HTML, TXT, PDF |
| Office | Word (.docx), Excel (.xlsx/.xls), PowerPoint (.pptx), CSV |
| 数据 | JSON, XML, YAML |
| 代码 | 30+ 编程语言语法高亮 |
| 图片 | PNG, JPG, GIF, BMP, SVG, WebP |

### 核心特性

- **数学公式** — KaTeX 渲染，支持 LaTeX 语法
- **Mermaid 图表** — 流程图、时序图、甘特图等
- **PDF 注释** — 高亮、下划线、矩形框、文字批注、便签
- **加密 Office** — 支持密码保护的 Word/Excel/PPT 输入密码后预览
- **代码高亮** — 30+ 语言，明暗双主题
- **文件导出** — Markdown/HTML 导出、Word 导出、PDF 截图
- **会话恢复** — 自动记住上次打开的文件和滚动位置
- **暗色模式** — 跟随系统或手动切换
- **网页浏览** — 内置 URL 浏览器，直接阅读在线内容

### 跨平台覆盖

| 平台 | 技术方案 | 状态 |
|------|----------|------|
| Windows | Tauri (NSIS + MSI) | ✅ |
| macOS | Tauri (DMG) | ✅ |
| Linux x64 | Tauri (AppImage + deb) | ✅ |
| Linux ARM64 | Tauri (AppImage + deb) | ✅ |
| Android | Capacitor (APK) | ✅ |
| iOS | Capacitor (xcarchive) | ✅ |
| Web | PWA (Service Worker) | ✅ |

## 下载安装

前往 [Releases](https://github.com/zxinyun/md_reader/releases) 下载对应平台的安装包。

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `*.exe` (NSIS) 或 `*.msi` | 推荐 NSIS |
| macOS | `*.dmg` | 拖入 Applications |
| Linux x64 | `*.AppImage` 或 `*.deb` | 适用于银河麒麟/深度UOS |
| Linux ARM64 | `*.AppImage` 或 `*.deb` | 适用于 ARM64 国产系统 |
| Android | `*.apk` | 直接安装 |
| iOS | `*.zip` | 需签名后安装 |

## 快速开始

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/zxinyun/md_reader.git
cd md_reader

# 安装依赖
npm install

# 启动本地服务 (http://localhost:3000)
npm run dev
```

### 构建桌面应用 (Tauri)

```bash
# 前提：安装 Rust (https://rustup.rs)
npm run tauri:build
```

产物位于 `src-tauri/target/release/bundle/`。

### 构建 Android 应用 (Capacitor)

```bash
# 前提：安装 Android Studio + JDK 21
npx cap sync android
cd android && ./gradlew assembleDebug
```

产物位于 `android/app/build/outputs/apk/debug/`。

### 构建 iOS 应用 (Capacitor)

```bash
# 前提：安装 Xcode
npm install @capacitor/ios
npx cap add ios && npx cap sync ios
# 用 Xcode 打开 ios/App/App.xcodeproj 进行签名和归档
```

## 技术架构

```
┌─────────────────────────────────────────────┐
│              公共前端 (public/)              │
│  index.html (单文件 SPA) + file-api.js      │
│  ┌─────────┐ ┌────────┐ ┌──────────────┐   │
│  │MD Parser│ │PDF View│ │Office Viewer │   │
│  └─────────┘ └────────┘ └──────────────┘   │
│  ┌─────────┐ ┌────────┐ ┌──────────────┐   │
│  │KaTeX    │ │Mermaid │ │Highlight.js  │   │
│  └─────────┘ └────────┘ └──────────────┘   │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   ┌─────────┐ ┌────────┐ ┌──────┐
   │  Tauri  │ │Capacitor│ │ PWA  │
   │ Desktop │ │ Mobile  │ │ Web  │
   └─────────┘ └────────┘ └──────┘
```

- **前端**：纯 Vanilla JS，无框架，无打包工具，零构建步骤
- **桌面**：Tauri v2 (Rust) — 轻量、安全、原生性能
- **移动**：Capacitor v8 — WebView 包装，原生 API 访问
- **PWA**：Service Worker 离线缓存，可安装到桌面

## 常见疑问

### 6k 行单 HTML 文件？为什么不拆分？

确实，`index.html` 目前是 ~6400 行的单文件 SPA，这看起来不太体面。解释一下这么做的原因：

1. **零构建步骤** — 纯 Vanilla JS，无框架无打包器。web 版 `npx serve public/` 即可运行，无需 webpack/vite。这套前端同时在 Tauri（桌面）、Capacitor（移动）、PWA 三个环境下跑，零构建让跨平台 CI 极其简单。
2. **完全离线** — 所有 20+ 个第三方库本地化（`public/lib/`），不依赖任何 CDN，内网/离线环境开箱即用。
3. **平台无关** — 单文件通过 `FileAPI.platform` 检测当前运行环境，同一份代码在桌面/移动/Web 上行为不同（如 PDF 桌面用 iframe，移动用 pdf.js）。

**这不是一个 6k 行就为了 Hello World 的项目**，这里面的代码覆盖了：
- 15+ 种文件格式的统一加载/渲染/切换
- 跨 7 平台的文件系统抽象层（Tauri/Capacitor/Web）
- PDF 注释工具（高亮/下划线/矩形/文字批注/便签）
- 加密 Office 文档输入密码后预览
- KaTeX 公式 + Mermaid 图表的双向转换
- URL 浏览器的受限沙箱隔离
- 会话自动恢复

**承认缺点**：单文件确实到了该拆的临界点。后续会逐步拆为 `app.js` / `pdf-viewer.js` / `office-viewer.js` 等模块，同时保持零构建的特性。

### 不就是把一堆前端库拼起来吗？

是的，没有重写 pdf.js / marked / KaTeX，这是有意为之：

| 什么值得复用 | 什么才值得自己写 |
|------------|----------------|
| PDF 渲染引擎 | 跨平台的平台抽象层 |
| Markdown 解析器 | 15+ 格式的统一浏览体验 |
| 数学公式引擎 | 本地化 + 离线缓存策略 |
| 语法高亮库 | PDF 标注系统 |
| Office 解析库 | 加密文档的透明预览 |

这个项目的价值在于 **集成和体验**，而不是第 N+1 个 marked 或 pdf.js。用一个应用、一个操作方式，通吃 15+ 种格式，7 个平台都能跑，安装包不到 10MB。这才是核心。

## 项目结构

```
md_reader/
├── public/                  # 前端静态文件
│   ├── index.html           # 主应用 (~6400 行单文件 SPA)
│   ├── file-api.js          # 平台抽象层 (Tauri/Capacitor/Web)
│   ├── sw.js                # Service Worker
│   ├── manifest.json        # PWA 配置
│   └── lib/                 # 第三方库 (全部本地化)
├── src-tauri/               # Tauri 桌面端
│   ├── src/                 # Rust 源码
│   ├── tauri.conf.json      # Tauri 配置
│   └── icons/               # 全平台应用图标
├── android/                 # Capacitor Android 端
├── .github/workflows/       # CI/CD 自动构建
│   └── build.yml            # 9 平台包自动发布
├── package.json
└── capacitor.config.json
```

## 版本发布

```bash
# 1. 修改代码并提交
git add . && git commit -m "feat: xxx"

# 2. 打 tag 触发自动构建
git tag v1.0.7
git push origin main --tags

# 3. GitHub Actions 自动构建 9 个平台包并创建 Release
```

也可在 Actions 页面手动触发 `workflow_dispatch`，填写版本号后生成草稿 Release。

## 为什么选择通用阅读器？

| 对比维度 | 通用阅读器 | Typora | VS Code | WPS |
|----------|-----------|--------|---------|-----|
| 格式数量 | 15+ | MD only | 需插件 | Office only |
| 离线使用 | ✅ 完全离线 | ✅ | ✅ | ❌ 部分 |
| 安装包大小 | ~10MB | ~80MB | ~300MB | ~200MB |
| 移动端 | ✅ Android/iOS | ❌ | ❌ | ✅ |
| 免费开源 | ✅ GPL v3 | ❌ 付费 | ✅ MIT | ❌ 付费 |
| PDF 注释 | ✅ | ❌ | ❌ | ✅ |
| 加密 Office 预览 | ✅ | ❌ | ❌ | ✅ |

## 贡献

欢迎提交 Issue 和 Pull Request！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献指南。

## 许可证

本项目积极参与并认可 [LINUX DO](https://linux.do) 社区。

本项目基于 [GNU General Public License v3.0](LICENSE) 开源。
