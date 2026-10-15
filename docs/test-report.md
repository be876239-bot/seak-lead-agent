# 觅客Agent 测试报告（T28 自动化回归 + T31 静态审查）

日期：2026-10-16（UTC+8 夜间执行）。执行者：Qoder agent；命令均在项目根目录真实运行，输出原样摘录。

## 1. 环境与产物

| 项 | 值 |
|---|---|
| Node | v24.13.0 |
| pnpm | 10.33.0 |
| WXT / MV3 | wxt 0.21.4，manifest_version 3 |
| 构建目录 | `.output/chrome-mv3/`（Edge 为 `.output/edge-mv3/`） |
| zip | `.output/seeklead-agent-0.1.0-chrome.zip`、`.output/seeklead-agent-0.1.0-edge.zip`（各 277,902 B） |

## 2. 命令与真实结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck`（tsc --noEmit） | 通过，0 错误 |
| `pnpm lint`（eslint .） | 通过，0 错误 0 警告 |
| `pnpm test`（vitest run 全量） | **19 个文件 / 187 项全部通过** |
| `pnpm test:unit` | 12 文件 / 134 项通过 |
| `pnpm test:integration` | 7 文件 / 53 项通过 |
| `pnpm build` / `pnpm build:edge` | 成功（约 5 秒） |
| `pnpm zip` / `pnpm zip:edge` | 成功，产物见上 |

注：`test:integration` 原脚本 `vitest run --dir tests/integration` 与 vitest include 模式冲突返回 0 个文件（发现即修复为 `vitest run tests/integration`），修复后 53 项真实执行。

## 3. 测试矩阵覆盖情况（DEVELOPMENT.md 第 12 节）

标记口径：**自动=有真实通过的自动化测试**；**真机=必须加载扩展/真实页面/真实模型，归 T29–T30，本报告不声称已通过**。

| ID | 状态 | 证据（测试文件） |
|---|---|---|
| A01/A02/A03 | 部分自动 | product-static.test.ts、product-service.test.ts（mock wxt/browser）；真机渲染兜底归 T29 |
| A04 | 部分自动 | url-policy 拒绝私网/凭据；权限拒绝路径在 product-service 测试；真实弹窗归 T29 |
| A05 | 自动（结构） | prompts 数据/指令分离 + bailian.ts 错误消息截断且绝不含 Key（ai-provider.test.ts）+ synthetic.jsonl 含注入样本（synthetic-regression.test.ts）；真实模型行为归 T30 |
| X01/X02/X04/X05 | 自动 | xhs-adapter.test.ts 15 项（6 真实脱敏 fixture）、xhs-session.test.ts 16 项（换帖 PAGE_CHANGED、验证码停止、无根容器 PARSE_FAILED 不整页兜底） |
| X03 | 真机 | 需人工滚动观察虚拟列表移除，归 T29 |
| M01 | 自动 | validate-grouping.test.ts（缺/多/重复 ID、虚假引文拒绝） |
| M02 | 自动（mock） | synthetic-regression.test.ts 32 条 gold 分组一致 |
| M03 | 自动 | ai-provider.test.ts（401/429/超时/取消中文错误、无无限重发）+ analysis-e2e（AI_TIMEOUT→partial 只重试失败批） |
| M04 | 自动 | analysis-e2e：第 1 批成功第 2 批超时→partial；retry 仅发送 11 条 |
| D01 | 自动 | analysis-e2e：重跑 0 次 AI 调用 |
| D02 | 自动 | analysis-e2e：画像 v2 后重新分析（52 条）；batching/identity-cache 覆盖父评论上下文 |
| D03 | 自动（进程内） | lock.test.ts 双管理器互斥 + e2e LOCK_HELD 留痕；真实双面板归 T29 |
| D04 | 自动 | lock.test.ts 启动恢复 + e2e interrupted→retry；UI 展示 interrupted（面板重开轮询）真机归 T29 |
| P01 | 自动（结构） | redact.test.ts、ai-payload DTO 白名单、export.test.ts 断言 JSON 无昵称/Key/sourceBlocks；构建产物 grep 无 `sk-` |
| P02 | 自动 | export.test.ts（BOM、`= + - @` 与前置空白/Tab 失效化、引号换行转义）；React 文本节点渲染不执行 HTML |
| P03 | 自动 | retention.test.ts 5 项（级联无孤立、leadStates 保留、活跃任务拒绝）+ repositories.test.ts deleteProduct 级联 |
| B01 | 真机 | Chrome/Edge 实际加载未执行，归 T29/T31；Qoder 内置浏览器不能加载扩展（decisions.md D002） |

## 4. T31 静态审查（代码/产物层面，实测）

- **manifest**（.output/chrome-mv3/manifest.json 原文核对）：permissions 仅 `storage, sidePanel, scripting, activeTab`；`optional_host_permissions` 为按需授权 `https://*/*`、`http://*/*`（用户点击批准后才生效）；content_scripts 仅匹配 `https://www.xiaohongshu.com/*`；无 `cookies`、`webRequest`、`<all_urls>` 强制权限。
- **CSP/远程脚本**：MV3 默认 CSP；bundle 仅本地 chunks；产物中无远程 script/stylesheet URL。
- **消息安全**：后台敏感命令统一经 `handleBackgroundMessage`：zod 协议校验 + `isTrustedSender`（拒绝带 tabId 的 content script 发送者）；content script 只处理 4 个 XHS_* 类型且校验 `sender.id === runtime.id`。
- **AI 请求体**：只含脱敏白名单 DTO（ai-payload.ts；cNNN/pNNN 临时映射，无昵称/主页/用户 ID/联系方式原文）；Key 仅从 storage.session/local 读取并放入 Authorization 头，不进 IndexedDB、日志、导出。
- **localhost/127.0.0.1 出现位置审查**：仅 url-policy 的私网拒绝名单与 Dexie 库内部判断，非请求目标。
- **产物密钥扫描**：`.output/` 全目录 `sk-[A-Za-z0-9]{16,}` 零命中；`.env` 保持 gitignore。

未完成项（如实记录）：Edge 真实加载冒烟、实际 AI 请求抓包复核、双面板真实并发——全部依赖用户浏览器环境，归 T29/T31 真机部分。

## 5. 效果指标状态

T30 真实评测（100–200 条人工标签）**尚未开始**，无 precision/recall 数据可报。32 条合成集只证明链路与规则回归，不代表真实中文效果。
