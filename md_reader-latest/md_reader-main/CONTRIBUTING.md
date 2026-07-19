# 贡献指南

感谢你对通用阅读器项目的关注！

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/zxinyun/md_reader/issues) 页面搜索是否已有相同问题
2. 如果没有，创建新 Issue，包含：
   - 操作系统和版本
   - 复现步骤
   - 期望行为 vs 实际行为
   - 相关文件（如能复现的测试文件）

### 提交功能建议

在 Issues 中创建带有 `enhancement` 标签的 Issue，描述你希望的功能和使用场景。

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m "feat: 描述你的改动"`
4. 推送到 Fork：`git push origin feature/your-feature`
5. 创建 Pull Request

### Commit 规范

使用语义化 commit message：

- `feat:` 新功能
- `fix:` 修复 Bug
- `docs:` 文档更新
- `style:` 代码格式（不影响逻辑）
- `refactor:` 重构
- `perf:` 性能优化
- `test:` 测试相关
- `chore:` 构建/工具链

### 开发环境

```bash
# 克隆
git clone https://github.com/zxinyun/md_reader.git
cd md_reader

# 安装依赖
npm install

# 启动开发服务器
npm run dev
# 浏览器打开 http://localhost:3000

# 构建桌面版 (需要 Rust)
npm run tauri:build
```

### 代码规范

- 前端代码在 `public/index.html` 中，保持单文件架构
- 使用 `const`/`let`，不用 `var`（已有代码暂不修改）
- 函数命名使用 camelCase
- CSS 使用 CSS 变量（`var(--primary)` 等）
- 新增第三方库放入 `public/lib/` 并本地化

## 行为准则

- 尊重每一位贡献者
- 以建设性方式提出反馈
- 聚焦于技术讨论
