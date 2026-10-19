# SeekLead Agent 新手引导开发基线

- 基线日期：2026-10-19

> 历史快照说明：本文记录适配器重构前的初始基线，不代表当前工作区状态。当前架构边界与最新自动化验收请参阅 docs/onboarding-adapter-contract.md。
- 主工作区：`D:\AI-Toys\seak-lead-agent`
- 当前分支：`branch-20261019`
- 当前 HEAD：`db2bd1c708f15d559b63e494992035aa13c82b4f`
- 本次未创建提交，未推送远端，未切换或修改 `main`。

## 1. 原始基线（HEAD，未包含工作区未提交修改）

为避免覆盖当前工作区，使用独立 worktree：

`D:\AI-Toys\seak-lead-agent-baseline-20261019`

原始 worktree 指向同一 HEAD，源码工作区干净。由于 WXT 生成配置未随 Git 跟踪，首次测试前执行了 `npx wxt prepare`，仅在独立 worktree 生成 `.wxt/tsconfig.json`；未安装新依赖。依赖目录通过本地 junction 复用主工作区现有的 `node_modules`。

| 检查 | 结果 | 备注 |
|---|---|---|
| `npm run typecheck` | PASS（退出码 0） | WXT prepare 后运行 |
| `npm test` | PASS（退出码 0） | 39 个测试文件，482 个测试通过 |
| `npm run lint` | PASS（退出码 0） | 无 ESLint 错误 |
| `npm run build:edge` | PASS（退出码 0） | Edge MV3 构建成功 |

原始 Edge 构建产物约 1.19 MB；sidepanel JS chunk 约 520.87 kB，CSS 约 4.63 kB。构建有第三方 Zod 注释警告和超过 500 kB 的 chunk 警告，记录为原始基线现象。

日志目录：`D:\AI-Toys\seak-baseline-logs\`

## 2. 当前工作区（已有 UI 优化 + 新手引导未提交改动）

| 检查 | 结果 | 备注 |
|---|---|---|
| `npm run typecheck` | PASS（退出码 0） | 包含新手引导代码和新增测试 |
| `npm test` | PASS（退出码 0） | 40 个测试文件，489 个测试通过 |
| `npm run lint` | PASS（退出码 0） | 无 ESLint 错误 |
| `npm run build:edge` | PASS（退出码 0） | Edge MV3 构建成功 |
| `git diff --check` | PASS | 仅显示工作区 LF/CRLF 转换提示，无空白错误 |

当前 Edge 构建产物约 1.21 MB；sidepanel JS chunk 约 530.36 kB，CSS 约 10.79 kB。

**比较边界：** 当前工作区同时包含既有 UI 优化与新手引导，所以产物大小变化不能全部归因于新手引导；此比较只作为当前整体工作区的检查基线。

日志目录：`D:\AI-Toys\seak-current-logs\`

## 3. 当前未提交改动清单

### 已有 UI 优化相关（保留原样，不覆盖）

- `docs/ui-refresh-2026-10-19.md`
- `entrypoints/sidepanel/CurrentNote.tsx`
- `entrypoints/sidepanel/sidepanel.css`
- `src/ui/CollectionProgress.tsx`
- `src/ui/ErrorNotice.tsx`
- 以及以下页面/入口文件中的既有 UI 调整：`App.tsx`、`Discovery.tsx`、`Leads.tsx`、`Products.tsx`、`Settings.tsx`

### 新手引导相关新增/集成

- `src/onboarding/flow.ts`
- `src/onboarding/storage.ts`
- `src/ui/OnboardingGuide.tsx`
- `tests/unit/onboarding.test.ts`
- `entrypoints/sidepanel/App.tsx` 和若干页面中的集成改动

## 4. 当前结论与后续门禁

- 原始基线和当前整体工作区的类型检查、自动化测试、Lint、Edge 构建均通过。
- 新增单元测试覆盖引导状态创建、进度推进、已有配置/产品跳步、暂停恢复、无效存储状态解析与流程完成。
- **尚未完成真实 Edge Side Panel 的人工/浏览器验收**；自动化测试与构建通过不代表用户界面验收完成。
- 后续开发前应保留这份基线和现有工作区改动；任何新增功能先做增量测试，完成后重复四项检查。
- 本次没有提交、推送、清理或覆盖工作区中的既有改动。
