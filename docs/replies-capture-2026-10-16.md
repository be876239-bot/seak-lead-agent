# 小红书回复增量采集修复与验收记录

2026-10-16；起始分支codex/eric-development，HEAD 53344f2，工作区干净。用户本轮授权D011，允许主动采集期间正常展开回复，其他互动/私有API/凭据读取/验证绕过仍禁止。

## 1. 根因与只读审计

修改前已检查以下11项，没有直接添加全页文本兜底：

| 检查项 | 当前代码事实及结论 |
|---|---|
| DOM adapter | `.parent-comment`里的根评论和`.reply-container .comment-item-sub`已有解析；不是完全没有回复解析器 |
| 唯一ID | `comment-<platformId>`提取平台ID，强键为noteKey+平台ID；无ID时沿用作者/文本/时间/父键/保守序号的弱策略 |
| 作者 | `.author a.name`，公开作者主页剥离查询参数后留本地；未改作者提取及现有隐私规则 |
| 文本 | 仍只读取当前笔记评论项的`.content .note-text`，不退化为全页文本 |
| 懒加载 | 原advance只滚动列表，从不触发已有`.show-more`回复控件；折叠回复不会进入DOM，这是主要漏采原因 |
| 虚拟列表 | 原Observer立即提取到会话缓冲，分页取样逐轮落库；但父DOM不存在时adapter跳过整个父容器，后续回复可能漏掉 |
| reply字段 | ParsedComment已有isSub/parentElementId/replyCount，持久化Comment已有parentKey；缺失父平台ID时只查elementKey会失去关联 |
| IndexedDB | Dexie v1，comments按commentKey存储并有noteKey索引；parentKey已有，无需迁移或新表 |
| AI输入 | ClassificationItem已有parent，buildClassificationInput和最终网络白名单均支持“帖子+父评论+当前回复” |
| Lead关联 | Analysis.commentKey→Comment；UI原先没有来源类型和父评论展示，全局列表仅取被分析评论，父评论未分析时上下文缺席 |
| 历史fixture | 真实脱敏expanded有10根/18子、collapsed有10根/8子；show-more有真实文案。旧测试验证已加载子评论，但没有展开→延迟→再展开闭环 |

先写复现：新回复组最初9项中6项失败，确认不点击、漏回复、关系缺口和无响应误报停止；UI新增2项最初失败。之后额外复现了父DOM被虚拟移除但原回复容器保留时，后续展开只发生一次的问题，再修复。没有用修改fixture断言或放宽测试获取通过。

## 2. 修改文件

- `src/xhs/adapter.ts`：保留已有字段解析；补充瞬态父Element/父容器引用，支持父DOM移除后的子评论解析；严格识别回复加载控件。
- `src/xhs/session.ts`：先增量提取，串行展开一组并等待；缓冲中累计、强ID去重；真实DOM关系与会话已确认的容器关系解析parentKey；关系不明则停止，不当一级评论。
- `src/xhs/capture.ts`：继承分页/落库/取消/500上限，增加一级/回复计数及回复加载状态；回复请求等待期间不把“没有新一级评论”判成全部无新内容。
- `src/domain/limits.ts`：每帖最多100次回复展开、10秒无新增超时、增量稳定等待1秒；继续继承原500总数、3分钟/200轮及任务10分钟等边界。
- `src/domain/schemas.ts`、`src/messaging/protocol.ts`：仅增加可选进度/快照字段，旧消息和旧任务兼容。
- `src/ui/CollectionProgress.tsx`、`src/ui/LeadExplanation.tsx`、`src/ui/logic.ts`、`src/ui/store.ts`：分类计数、来源类型、真实父评论上下文；只读补查未参与分析的父评论，并防止跨笔记拼接。
- `entrypoints/sidepanel/CurrentNote.tsx`、`Leads.tsx`、`Discovery.tsx`、`src/discovery/jobs.ts`：单帖/寻找任务进度与Lead上下文接线；寻找页面仅在当前帖计数一致时展示本帖分类。
- 新增`tests/fixtures/xhs/nested-replies.html`、`tests/integration/xhs-replies.test.ts`、`tests/unit/lead-parent-query.test.ts`；扩展collection-progress、lead-explanation测试。
- 更新README、DEVELOPMENT、TODO、决策与测试报告；合成UI截图`docs/evidence/replies-ui-synthetic.png`。

## 3. 数据模型变化

**评论持久化结构和数据库版本不变，旧一级评论无需迁移。**

- `commentKey`继续唯一关联原评论/回复；`parentKey=null`表达一级评论，非空表达回复并指向根评论的真实本地键。类型由parentKey推导，不新增强制type字段。
- 新增的parentElement/parentContainer仅用于解析内存，绝不写数据库、消息或AI请求。根DOM离开但同一容器仍在时，只沿用本会话此前确认的结构关系。
- 捕获进度可选增加topLevelCount、replyCount、loadingReplies；旧任务缺分类计数时不伪造零回复。
- AI schema/Prompt/最终白名单无需改动，沿用parent.text；不发送身份、平台ID或无关父评论，不改变预算、分组、缓存或批次架构。

## 4. 新增测试

本轮新增16项；原273项全部保留。

| 要求 | 自动测试证据 |
|---|---|
| A 两个一级评论 | 快照返回2条，未主动autoLoad不点击任何控件 |
| B 一级+两回复 | 展开/再展开逐批累计；同作者同文本但不同稳定回复ID分别保留 |
| C 回复消失 | A1移出DOM后数据库仍有A1；父DOM被移除、原容器保留后仍能采集A2 |
| D/F 重扫/重渲染不重复 | A2反复替换DOM、重新扫描，最终每个稳定ID只有一条 |
| E 父子不串 | A→A1/A2、B→B1，强制检查parentKey；无父平台ID也保留结构父关系 |
| G 总500 | 498一级+2回复=500，不点下一组，不再展开 |
| H 取消 | 首次展开前取消；展开等待中取消，迟到回复不入库、下一组不点击 |
| I 验证 | 展开出现安全验证后立刻中止，B不点击，不绕过 |
| J AI上下文 | 最终网络请求中当前回复含正确parent.text，不包含另一父评论、作者或平台身份 |
| K 旧数据 | 原CommentSchema/旧一级评论直接读取，无需迁移 |
| 延迟和失败 | 回复延迟8次采样才出现仍继续等待；10秒无响应只点击一次并明确失败 |
| 操作白名单 | 容器外、互动区域、隐藏、禁用、带href导航及非展开文案均不点击 |
| UI与上下文 | 分类计数/正在加载回复、父评论与用户回复、缺失上下文提示、HTML转义；未分析父评论补查及跨笔记隔离 |

## 5. 全量结果与安装包

最终：**29文件 / 289项通过**。typecheck、lint、git diff --check通过；Windows Git仅提示既有LF/CRLF策略。测试采用合成DOM、历史脱敏fixture、fake-indexeddb及既有MockProvider，不是线上模型或平台验收。

Edge和Chrome生产构建与ZIP通过，各11项资源、**360,072 B**。两包SHA256均为：

`a94ec0cb678ce91b9fc172122f46116ed04860e4fda14fa95e2f6b1865b0ed94`

各包逐项与对应构建目录字节一致，无.env/.scratch/tests/eval/node_modules；Key格式扫描0命中（非完备秘密证明）。manifest仍只有storage/sidePanel/scripting/activeTab，没有新增Cookie、tabs或其他凭据权限。现有Zod annotation警告未导致失败。

核验无修改：AI Prompt、AI payload构造、分组规则、分析runner、数据库表/版本、lockfile与manifest配置。

## 6. 真实浏览器验收与步骤

**真实小红书：NOT VERIFIED，尚未通过。** 本轮Edge可列出用户笔记页，但绑定返回`Debugger unattached`，未执行真实展开或采集；这是工具连接问题，不能说成平台风控。用户随后明确选择“暂不具备条件，先交付代码和验收步骤”。

仅另做合成UI：在IAB渲染实际CollectionProgress/LeadExplanation组件，显示137总数、82一级/55回复与父评论。数据为合成示例，截图不代表真实采集。临时页已关闭、服务已停止。

后续监督验收：

1. 在`edge://extensions`重新加载指向`D:\AI-Toys\seak-lead-agent\.output\edge-mv3`的SeekLead；刷新笔记。不要卸载或清空已有数据，Key只在设置里自行填写，不发送到聊天。
2. 选择一篇评论较少、明确有“展开X条回复”的公开笔记，保持正常登录。首轮只用“当前笔记”单帖功能，不启动5篇寻找任务。
3. 记录初始一级/回复数量，点击“开始采集评论（完成后分析）”；不要手动帮助展开或疯狂滚动。观察插件是否只点回复加载控件，进入“正在加载回复”，回复数量增加。
4. 观察一次“展开更多回复”，确认前批已读取回复即使退出DOM，仍出现在本地结果中；多个父评论分别展开时，检查Lead来源的父评论不会串。根评论与回复总数不能超过500。
5. 做一次取消：出现一组回复后取消，确认不继续展开/滚动或写入迟到回复，先前保存结果仍在。另一次可让小规模任务自然结束，检查现有AI流程能生成带父评论上下文的Lead。
6. 若自然出现登录/验证码/安全验证/平台异常，确认自动操作停止；人工正常处理，不制造或绕过验证。未自然遇到的场景记“未遇到/未真实验证”。
7. 记录笔记、初始/最终分类计数、停止原因与是否取消，证据先脱敏。平台限制、插件结构不兼容和浏览器工具故障分别记录。不得写“已采集全部”或“账号绝对安全”。

## 7. 新Edge ZIP

`D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip`

Chrome同步重打包：`.output/seeklead-agent-0.1.0-chrome.zip`。

## 8. 当前限制

- 未完成真实小红书端到端验收，无法证明当前线上DOM/点击响应/验证码识别完全兼容；真实模型质量也未由本轮证明。
- 仅识别历史fixture证实的回复容器/控件结构及明确文案；未知控件不扩大点击范围，不做全页文本兜底。10秒无响应或100次展开会停止，这些是产品护栏，不是官方安全阈值。
- parentKey表达根评论关系。平台未展示可验证的精确reply-to时，不猜回复对象；父评论是图片/空文本、已过期或未采到时，UI明确提示文字不可用，无法提供缺失的AI父文本。
- 父DOM与原容器都消失，且重新出现的回复没有任何可验证父关系时，采集会停止，不伪造关系。
- 无稳定平台ID时沿用原弱身份策略；极端的无作者/无时间或完全相同弱字段，无法保证与稳定ID同等的跨DOM重建去重效果。弱身份不作为绝对唯一性承诺。
- 旧记录缺失的父关系不会凭文本追溯补造，必要时需重新正常采集。
- 回复等待期间不以“无新一级评论”结束，但网络延迟/平台权限/虚拟列表未展示内容及各上限仍可能造成不完整；不承诺全量，不绕过平台限制或执行社交互动。
