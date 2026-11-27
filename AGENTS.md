# Agent 工作规范

## 提交与分支（强制）

- 每次执行 `git commit` 前，必须先向用户展示变更摘要、`git status`、`git diff` 和测试结果，并等待用户明确审阅批准。
- 未经用户明确要求，不得自行提交、修改提交、推送或创建 PR。
- `main` 受分支保护，禁止直接向 `main` 提交或推送。
- 实现新功能或修复 Bug 时，必须从最新 `main` 新建分支，不得在 `main` 上直接修改。
- 分支命名建议：`feat/...`、`fix/...`、`docs/...`、`refactor/...`、`chore/...`。
- 完成后必须通过 Pull Request 合入 `main`，等待 CI 与用户审阅通过。
- 不得强推、跳过 Hooks 或未经确认删除分支。

## 项目结构

- `src/Loveevo.Core`：领域模型、校验、备份与存储抽象。
- `src/Loveevo.App`：Blazor WASM、Atlas 工作台、浏览器存储与 UI。
- `tests/Loveevo.Tests`：单元测试与 bUnit 组件测试。
- `tests/Loveevo.Browser`：Playwright、可访问性与离线测试。
- `.github/workflows/deploy.yml`：PR 检查与 GitHub Pages 部署。

## 常用命令

```bash
dotnet test Loveevo.sln
dotnet run --project src/Loveevo.App/Loveevo.App.csproj --urls http://127.0.0.1:5173
```

浏览器测试：

```bash
cd tests/Loveevo.Browser
npm ci
npx playwright install chromium
npm test -- --grep-invert offline
```

## 开发要求

- 保持数据仅保存在浏览器本机，不引入云端存储或外部遥测。
- 修改 IndexedDB、备份格式或 Atlas 布局时，必须补充迁移、并发与兼容性验证。
- UI 修改需验证桌面端、移动端、键盘操作和 WCAG 2.2 AA 自动检查。
- 提交前至少运行 .NET 测试；涉及 UI、PWA 或工作流时还需运行浏览器测试。
- 依赖升级需检查 NuGet 与 npm 漏洞，不得引入已知高危漏洞。
