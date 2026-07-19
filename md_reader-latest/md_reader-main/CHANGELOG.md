# Changelog

本文件记录每个版本的主要变更。

## [1.0.6] - 2026-06-24

### 安全修复
- 修复 Markdown 解析器 XSS 漏洞（`javascript:` 协议链接过滤）
- iframe 浏览添加 sandbox 限制
- 属性值换行符转义修复
- PDF 关闭时内存泄漏修复
- URL 参数大小限制（10MB）
- 调试日志数组大小限制

### 功能
- 跨平台文件阅读器：支持 MD/HTML/TXT/PDF/Word/Excel/PPT/CSV/代码/图片
- 数学公式渲染 (KaTeX)
- Mermaid 图表渲染
- PDF 注释工具（高亮/下划线/矩形/文字批注/便签）
- 加密 Office 文档解密
- 30+ 编程语言语法高亮
- 暗色模式
- 会话自动恢复
- 网页 URL 浏览

### 平台支持
- Windows: NSIS + MSI 安装包
- macOS: DMG 安装包
- Linux x64: AppImage + deb
- Linux ARM64: AppImage + deb
- Android: APK
- iOS: xcarchive (需签名)
- Web: PWA (Service Worker 离线)
