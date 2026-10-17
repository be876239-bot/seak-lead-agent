# 觅客Agent 测试报告（T28 自动化回归 + T31 静态审查）

**最新D016：33文件/364项通过，新增4项；typecheck/lint/build/Edge ZIP/diff检查通过。[返回搜索审计与真实证据边界](discovery-return-audit-2026-10-17.md)。E普通浏览器导航PARTIAL，F新版真实完整任务NOT VERIFIED。以下为历史记录。**

**最新D015：33文件/360项通过，新增6项；typecheck/lint/build/Edge ZIP/diff检查通过。详情见 [连续任务报告](discovery-continuous-2026-10-17.md)。本轮F真实小红书NOT VERIFIED。以下为历史结果。**

**最新结果：2026-10-17 D014，32 文件 / 354 项通过，新增18项。typecheck/lint/build/Edge ZIP/diff检查通过。多帖暂停/继续审计和证据见 [discovery-resume-2026-10-17.md](discovery-resume-2026-10-17.md)。F真实小红书流程NOT VERIFIED；本轮Edge页面可读取，用户暂无法配合新版扩展侧边栏验收。下面各节为历史阶段记录。**

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

## 6. 2026-10-16 接手修复后的最新验证

环境：Windows，Node v26.7.0，pnpm 10.33.0，WXT 0.21.4。起始基线与功能审计见 `takeover-audit-2026-10-16.md`。

安装真实执行 `npx --yes pnpm@10.33.0 install --frozen-lockfile`。本机默认 pnpm 11.22.0 忽略 pnpm.overrides，尝试执行脚本时还会触发重新安装并因无 TTY 拒绝；没有同意清空 node_modules 或修改系统配置。改用已缓存 pnpm 10 离线执行，以下为最终代码上的实际结果：

| 命令（前缀均为 `npx --offline --yes pnpm@10.33.0`） | 本轮结果 |
|---|---|
| typecheck | exit 0 |
| lint | exit 0 |
| test | **22 文件 / 216 项全部通过** |
| build | exit 0，生产 chrome-mv3 构建 |
| zip | exit 0，Chrome 开发包 347,797 B |
| zip:edge | exit 0，包含 Edge 生产构建，开发包 347,797 B |
| git diff --check | 通过；Git 仅提示 LF/CRLF 转换策略，未批量改行尾 |

新增/扩展验证：实际 HTTP 请求白名单与脱敏；来源和模型输出落库脱敏；取消后迟到结果/过期锁/锁接管禁止提交；重试拒绝画像、配置、正文、旧摘要或锁冲突；无 DOM 后台静态解析及补读；产品静态取消；200/500 响应正文卡住的完整超时；卡片理由、不确定点、人工主页链接及 HTML/非法 URL 防护。关键故障已有先失败再通过记录；Mock/fixture 不计为真实模型效果。

ZIP 均 11 个条目，可用 ZipFile 打开，含 `licenses/linkedom.txt`；无 `.env`、tests、eval、node_modules 条目；仅对包内 JS/JSON/HTML 做 `sk-[A-Za-z0-9]{16,}` 格式扫描，命中为 0。此扫描不是对所有秘密的完备证明。manifest 仍为 MV3，权限 `storage/sidePanel/scripting/activeTab`，content script 仅小红书域；未扩权。

构建有已有 Zod 依赖注释的 Rollup annotation 警告（无构建失败）；依赖安装曾提示忽略 esbuild 生命周期脚本，但实际 prepare/build/zip 成功。LinkeDOM 增加后台包体积，最终总解压尺寸约 1.07 MB，未添加新权限。

**展示验证与真实闭环分开**：本轮内置浏览器打开 localhost 合成 LeadExplanation 预览，观察截图中 320/390/560px 三种卡片宽度，理由、证据、不确定点和主页链接可见，未点小红书链接。组件测试使用 React SSR + DOM，用户真实数据未参与；临时预览已关闭。这只证明合成组件呈现，不能替代 T29 的扩展安装/权限/侧边栏交互。

**尚未验证**：Edge/Chrome 实际加载新包、真实产品页面和搜索方向、真实小红书评论与跳转、真实模型质量、MV3 长队列/休眠恢复、真实用户价值。JEV/数值评分没有实现；不报告准确率。G3/T29/T30/T31 真机项不勾选，ZIP 标为待实测开发包。

## 7. 2026-10-16 增量采集修复验证

本轮起始HEAD `0148c38`，分支codex/eric-development，起始工作区干净。用户新增授权仅为当前笔记内正常滚动触发网页懒加载，见D009与 `incremental-capture-2026-10-16.md`。

实际使用 Node v26.7.0 / pnpm 10.33.0。命令前缀统一 `npx --offline --yes pnpm@10.33.0`：

| 命令 | 实际结果 |
|---|---|
| typecheck | exit 0 |
| lint | exit 0 |
| test | **24 文件 / 235 项全通过**，比上轮新增19项 |
| build | exit 0，Chrome生产构建，总解压尺寸约1.08 MB |
| zip | exit 0，Chrome ZIP 约350.92 kB |
| zip:edge | exit 0，Edge生产构建与ZIP **350,917 B** |
| git diff --check | 通过；仅Git行尾策略提示 |

新增测试：xhs-incremental.test.ts 15项、collection-progress.test.ts 2项、xhs-capture.test.ts 新增2项。初始9项增量复现全部失败（旧代码只读20条、不滚动、不逐轮落库），修复后通过；保留原有会话分页、批次、缓存、锁、AI与脱敏回归。新测试在合成DOM和fake-indexeddb中覆盖用户A–I及延迟、平台遮挡、换帖、未知容器、弱身份重复取样、空评论、取消后迟到写入、消息超时/取消。

合成浏览器：内置浏览器只点击一次开始，生产captureNote/Session用真实scrollBy触发模拟DOM替换；首屏20→40，实际本地IndexedDB40，首屏评论1在DOM=false、在数据库=true；no_new停止，UI明确未确认全部。截图在 `evidence/incremental-capture-synthetic.png`。这是合成浏览器/本地存储证据，不是真实小红书或Edge扩展安装证据。

Edge ZIP可正常读取，11项资源；包内JS/JSON/HTML与edge-mv3构建逐项一致，未包含.env/tests/eval/node_modules，Key格式扫描命中0（非完备秘密证明）。manifest权限与小红书匹配域未改变。构建仍有已有Zod注释annotation警告，未导致失败。

冻结范围核验：git diff检查确认prompts.ts、classification.ts、cache.ts、batching.ts、runner.ts均无本轮修改。未新增JEV、数字评分、模型、平台、支付或云端任务。

**真实验收：NOT VERIFIED。** 新Edge包未在用户真实小红书页面加载；验证码/评论权限、真实滚动容器和懒加载兼容性、MV3休眠/恢复均未验证。不声称采集全部。下一步按增量采集报告的真实验收步骤执行，不手动助载，并检查首屏数据留存、数量增长、去重和取消。

## 8. 2026-10-16 有界串行寻找任务（最新）

基线aa29320；D010授权当前搜索结果→最多5篇单页串行任务。最终27文件/273项通过，typecheck/lint/Edge及Chrome ZIP通过；完整测试矩阵、停止边界与安装包哈希见 `serial-discovery-2026-10-16.md`。

新增38项：搜索DOM/串行任务26、浏览器导航9、生产处理器组合闭环1、恢复评论种子1、外部取消AI迟到写入1。组合测试两篇各20→40且首屏离开DOM，IndexedDB各40、总80、80条模拟Lead；后台中断不自动恢复，手动继续复用原时限/标签/评论/缓存且没有新增模型调用。真实浏览器合成UI实际点击开始→暂停→继续→停止，截图见evidence/discovery-ui-synthetic-*.png；消息、产品和采集使用合成数据，不能当真实小红书证明。

Edge/Chrome ZIP各358190 B、11项，SHA256 d7e875db7e5937ffd87eda7b22a764c5fdb885e2d0da4df72a21a08b778c2122；逐项匹配构建，未包含.env/tests/eval/node_modules/.scratch，Key格式扫描0命中，manifest权限未增加。AI Prompt/分组/缓存键/批次/数据库表结构未改；runner仅新增外部signal桥接既有取消锁，jobs表仅新增可选任务元数据。

**真实小红书：NOT VERIFIED。** Edge标签连接超时，未执行真实任务；用户明确要求先交付代码与验收步骤。未证明账号不会受限制、所有风控提示都可识别或评论已采全。历史T29/T30不勾选。

## 9. 2026-10-16 一级评论+回复（最新，D011）

起始HEAD 53344f2；先只读审计确认adapter/parentKey/AI parent已有支持，主要缺口是没有展开折叠回复、无父ID和父DOM移除时关联不足。修复为白名单控件串行展开→等待→增量落库→再展开，500为一级+回复总数；10秒无响应、100次展开和原有取消/时间/轮次/平台限制均有停止状态。

最终29文件/289项通过，比基线新增16项：xhs-replies 12项、父评论补查2项、分类计数与Lead上下文各1项。typecheck/lint通过。Edge/Chrome ZIP各360072 B、11项，SHA256 a94ec0cb678ce91b9fc172122f46116ed04860e4fda14fa95e2f6b1865b0ed94；逐项与构建一致，无测试/环境文件，Key模式扫描0命中，manifest权限不变。AI Prompt、分组、AI payload、runner和数据库表版本未改，无迁移。

真实小红书NOT VERIFIED：Edge绑定返回Debugger unattached，未执行真实展开/采集；用户明确选择先交付代码与验收步骤。仅合成UI组件渲染并截图，不算真实平台通过。完整审计、A–K映射、操作白名单、数据模型、真实验收步骤与限制见 `replies-capture-2026-10-16.md`。

## 10. 2026-10-16 正常交互切帖（最新，D012）

基线34e2c38；npm test：30文件310项全部通过，typecheck/lint/build与Edge打包通过。真实DOM链接click、原搜索标签Back、导航状态持久化及异常暂停已实现。合成IAB两篇82条（含2回复）保存、首屏移除仍保留、2次点击/2次Back；MockAI不代表质量。Edge断开且用户暂无法连接，真实小红书NOT VERIFIED，风控触发未判定。包哈希、修改文件、测试和验收步骤见 normal-navigation-2026-10-16.md。

## 11. 2026-10-17 少量评论漏采（D013）

基线925ae86，30文件312项通过；新增24项后最终31文件336项通过，typecheck/lint/build/Edge打包/diff检查通过。分批红测共11项复现丢失或错误状态，未改旧数量期望。修改仅评论发现/解析/累计/停止元数据；AI/分组/缓存/DB表不变。新Edge ZIP 363147字节，SHA256 9112af34dbd3a802cdef0e9a9e72762c3c5a58e34adf407e7e4dcd7244facf49，11项逐字节匹配构建且无测试/环境文件。E浏览器与F真实小红书NOT VERIFIED：Edge绑定Debugger unattached，用户选择先交付。完整审计、A–E风险、红绿结果、文件清单、A–F验收层级及弱身份限制见 comment-recall-2026-10-17.md。
