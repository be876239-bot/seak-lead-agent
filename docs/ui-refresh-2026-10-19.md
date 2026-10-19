# D027 — 觅客 Agent UI 界面整理（2026-10-19）

## 目标

在不重做业务流程的前提下，统一侧边栏的视觉层级、表单控件、主操作按钮、任务/线索卡片与键盘焦点样式，提升可读性和操作一致性。

## 改动范围

- 新增 `entrypoints/sidepanel/sidepanel.css`：统一浅色中性色、文字层级、边框/圆角、输入框/下拉框/按钮状态、焦点提示、响应式间距。
- 调整侧边栏头部和五个主导航按钮：明确当前选中项，加入版本标识和语义化导航标签。
- 为“产品”“当前笔记”“线索”“设置”增加明确的页面标题，统一页面纵向间距。
- 统一主要动作按钮的视觉权重：产品画像读取、开始采集分析、寻找客户。
- 统一产品、线索、当前笔记分组、任务状态、设置区块的卡片样式。
- 将关键词步骤提示、已识别产品提示纳入一致的信息提示样式。
- 保留现有交互、业务规则、线索分类、任务队列、历史数据与存储结构；未新增权限、外部依赖或网络请求。

## 代码文件

- `entrypoints/sidepanel/sidepanel.css`（新增）
- `entrypoints/sidepanel/main.tsx`
- `entrypoints/sidepanel/App.tsx`
- `entrypoints/sidepanel/Discovery.tsx`
- `entrypoints/sidepanel/Products.tsx`
- `entrypoints/sidepanel/CurrentNote.tsx`
- `entrypoints/sidepanel/Leads.tsx`
- `entrypoints/sidepanel/Settings.tsx`

## 验证状态

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- 定向 UI 相关单测：4 个测试文件、30 项通过。
- 全量测试（限制 worker 重跑）：39 个测试文件中 36 个通过、3 个失败；482 项中 478 项通过、4 项失败。失败为 `discovery-e2e.test.ts` 中一项模拟任务未在断言期限内完成，以及 `xhs-recall.test.ts`、`xhs-replies.test.ts` 中 3 项 5 秒超时。UI 改动只涉及展示层，但全量测试未全绿，因此不能声称整套测试通过。
- `npm run build:edge`：通过；存在既有 Zod 注释警告和超过 500 kB 的 bundle 提示。
- `npm run zip:edge`：通过，最终 ZIP 381.70 kB（SHA-256：`F47ECC225E3CC92DA2476C739C68105639B15305285D432A95D73D5920776612`）。
- `git diff --check`：通过；Git 提示一个集成测试文件存在 LF→CRLF 行尾转换提醒。
- 真实 Edge 侧边栏视觉验收：待用户重新加载扩展后确认。

## 手动验收建议

1. 在 `edge://extensions` 重新加载 `.output/edge-mv3`。
2. 依次打开“产品、寻找客户、当前笔记、线索、设置”，检查导航选中态、页面标题、文字和控件间距。
3. 检查产品卡片、线索卡片、任务状态、设置卡片的边框和留白是否一致。
4. 检查主按钮是否更容易识别，禁用状态是否清楚；点击/键盘 Tab 导航时应能看到焦点轮廓。
5. 在“寻找客户”页确认关键词复制、搜索确认、1–100 帖子数量输入和任务启动逻辑不变。
6. 在“线索”页确认原线索和人工处理状态仍在；在“设置”页确认 Key、模型设置、保留期和用量展示仍正常。

本轮未创建 Git commit 或 push；所有既有未提交改动均需保留。
