# Loveevo

Loveevo 是一个私密、本机优先的恋爱关系纪念册。它用时间线记录见面、牵手、拥抱、亲吻及自定义阶段，支持文字回忆、地点、心情和多图相册。

## 技术栈

- Blazor WebAssembly / .NET 10
- Atlas.Blazor 0.4.0 可停靠工作台
- IndexedDB 本机存储
- PWA 离线与安装支持
- Playwright + axe-core 自动化测试

## 主要功能

- 预置与自定义关系阶段
- 多条事件时间线、日期与心情筛选
- 照片压缩、EXIF 移除、排序、封面和灯箱预览
- Atlas 面板拖拽停靠与布局持久化
- 回收站、隐私模式和跨标签页同步
- ZIP 完整备份、校验和事务恢复
- 桌面完整工作台与移动端简化视图
- 明暗主题、中文资源化和 WCAG 2.2 AA 自动检查

## 本地运行

需要 .NET 10 SDK。

```bash
dotnet run --project src/Loveevo.App/Loveevo.App.csproj --urls http://127.0.0.1:5173
```

打开 <http://127.0.0.1:5173>。

## 测试

运行 .NET 单元测试与组件测试：

```bash
dotnet test Loveevo.sln
```

运行浏览器测试（不含离线测试）：

```bash
cd tests/Loveevo.Browser
npm ci
npx playwright install chromium
npm test -- --grep-invert offline
```

完整浏览器、可访问性和离线测试由 GitHub Actions 自动执行。

## 部署

推送至 `main` 后，[工作流](.github/workflows/deploy.yml) 会自动构建、测试并发布到 GitHub Pages 的 `/Loveevo/` 子路径。

首次使用需在仓库 Settings → Pages 中将 Source 设置为 **GitHub Actions**。

## 数据与隐私

所有关系数据仅保存在当前浏览器的 IndexedDB 中，不会上传服务器。清除浏览器站点数据会删除回忆，请定期使用“导出备份”保存 ZIP 文件。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。
