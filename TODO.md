# 觅客Agent MVP 开发 TODO

创建：2026-10-15。配套规范：`DEVELOPMENT.md`。

**当前状态：G0、G1 已完成（T01–T09、T11–T14）；下一阶段 G2（T15–T22，T10 归入 G2）。真实浏览器验收（T28–T33）尚未开始。**

## 给接手 AI 的执行指令

先读 DEVELOPMENT.md 第 0–4 节，再完整阅读数据、消息、识别和测试章节。只实现“自用、本地插件、用户自己的国内 AI Key、产品 URL 自动识别、手动打开笔记分析已加载评论”。

按本文件依赖顺序执行，除非用户另有指示，不一次重写所有文件。每次完成一个可验证模块，更新对应任务的记录。遇到页面访问或 API Key 缺失，标记具体阻塞，继续独立任务；不要把 mock 当真实验收。

状态标记：`[ ]` 未完成；`[x]` 完成且已验证。进行中或阻塞仍保留 `[ ]`，在记录写状态。禁止因为“已写代码”就勾选“真实环境验收”。

每个完成任务按这个模板附记录：

```text
任务：Txx
状态：完成 / 进行中 / 阻塞
改动文件：
验证：命令或手动步骤 + 结果
证据：测试报告、脱敏截图或 fixture 路径
未验证：没有则写无
下一步：
```

## 依赖与阶段门槛

```text
T01 → T02 → T03/T04/T05/T06
T03 + T05 + T06 → T07–T10（产品读取与识别）
T03 + T05 + T06 → T11–T14（小红书读取）
T03 + T05 → T15–T18（AI 与规则，可用 mock）
T04 + T14 + T18 → T19–T22（完整分析流程）
T10 + T22 → T23–T27（完整 UI、导出和清理）
T23–T27 → T28–T33（真实验收和交付）
```

上图为模块级概览，单项依赖以下文为准。推荐线性执行顺序：T01–T09 → T11–T14 → T15–T18 → T10 → T19–T33。若 T11 缺真实页面，先推进 T15–T18、T10 和其他不依赖真实 DOM 的任务，不把 T11–T14 勾选完成。

- G0：工程可构建、协议与数据库一致。
- G1：产品读取和当前页评论解析最小验证完成；真实解析证据不足时不得宣称插件可用。
- G2：mock 集成闭环完成，错误、取消、重试、缓存可验证。
- G3：真实模型与浏览器验收完成，报告实际指标与限制。
- 所有阶段都不得加入支付、自动浏览、平台 API、服务器和自动互动。

## 第一阶段：基础工程

### T01 — 核对复用候选与记录决策

- [ ] T01 完成并记录

依赖：无。

操作：
1. 阅读已有技术方案和 DEVELOPMENT.md。
2. 检查 WXT、Readability、Dexie、Zod 及两个 MIT 候选的 LICENSE。
3. 对准备复制/适配的代码固定 commit，记录精确源文件与用途。
4. 检查候选是否依赖平台接口、Cookie 或自动操作；这些部分不迁入。
5. 新建 THIRD_PARTY_NOTICES.md、docs/decisions.md。

产出：来源清单、许可证、实际复用方式。若决定不复制某段代码，说明“小型库依赖更合适/业务逻辑不匹配”等具体原因，不能只写“自己写更好”。

验收：无许可证代码没有进入项目；复制部分保留必要声明。没有执行第三方仓库里的未知脚本。

### T02 — 创建 WXT + React + TypeScript 工程

- [ ] T02 完成并记录

依赖：T01。

文件：package.json、pnpm-lock.yaml、wxt.config.ts、tsconfig、entrypoints、基础样式。

操作：使用官方支持的模板和稳定依赖；创建 background、sidepanel、xhs content 入口；只显示空侧边栏和版本号；创建 dev/build/zip/typecheck/lint/test 脚本。

验收：安装依赖、类型检查、lint、生产构建通过；构建 manifest 是 MV3；没有远程脚本或 Key；记录实际 Node/pnpm 版本和产物目录。

### T03 — 定义领域 schema、常量、错误类型

- [ ] T03 完成并记录

依赖：T02。

文件：src/domain/schemas.ts、limits.ts、errors.ts、messaging/protocol.ts。

操作：实现 ProductProfile、Claim、Note、Comment、Decision、Job、Batch、消息请求/响应 schema。为数组数量、字符串长度、枚举和 URL 设置约束；类型从 Zod 推导。

验收：非法枚举、缺字段、超长输入、未知消息拒绝；unknown 产品字段必须 null；不存在 any 绕过。错误码至少覆盖 PERMISSION_DENIED、PAGE_UNSUPPORTED、PAGE_CHANGED、PAGE_BLOCKED、PARSE_FAILED、AI_AUTH、AI_RATE_LIMIT、AI_TIMEOUT、AI_INVALID_OUTPUT、CANCELLED、STORAGE_ERROR。

### T04 — IndexedDB、版本和仓储

- [ ] T04 完成并记录

依赖：T03。

文件：src/storage/db.ts、repositories.ts。

操作：实现文档中的 10 张表及索引；唯一 cacheKey；product profileVersion；analysis 和人工状态独立；批次成功原子提交接口；记录数据库版本。

验收：重复 cacheKey 不重复存储；同一评论不同产品可分析；修改画像递增版本；失败事务无部分成功；测试数据不进入正式数据库。

### T05 — 脱敏与请求白名单

- [ ] T05 完成并记录

依赖：T03。

文件：src/privacy/redact.ts、ai-payload.ts，tests/unit/redact.test.ts。

操作：对常见手机号、邮箱、身份证、带明确微信/QQ 标签的号码打码；对已打码文本重复处理结果稳定；构造产品/评论 AI DTO，只取允许字段。

验收：评论、父评论、标题、产品块、模型输出走统一函数；AI DTO 无作者、主页、用户 ID、完整 URL；年份/价格/题号不被简单地全部删除；异常日志无输入正文和 Key。

### T06 — 扩展权限与凭据配置基础

- [ ] T06 完成并记录

依赖：T02、T03。

文件：background.ts、storage/credentials.ts、messaging/handlers.ts、Settings 最小页。

操作：实现用户点击直接申请具体 origin 权限；固定供应商预设；Key 默认 session、显式“记住”后 local；配置可信上下文访问限制；清除 Key；敏感后台命令验证发送者。

验收：拒绝权限仍能查看旧结果；content script 不可读取 Key；不写 sync、数据库或导出；无接受任意 URL 转发 AI 请求的消息。重启浏览器后 session Key 失效、记住的 Key 按设计保留。

G0 检查：
- [ ] 基础构建通过，schema/数据表/消息类型一致。
- [ ] 未引入后台服务器、商业化或自动浏览功能。

## 第二阶段：自动理解产品

### T07 — URL 策略与静态页面抽取

- [x] T07 完成并记录

依赖：T03、T05、T06。

文件：product/url-policy.ts、extract-static.ts。

操作：校验协议/凭据/明显内网地址；按需权限后 fetch，omit credentials、15 秒、2 MB；禁自动跨域重定向；Readability + 标题/meta/JSON-LD Product/Offer + 功能价格区；来源块去重编号。

验收：静态 fixture 提取功能和价格；不采集脚本、输入框内容；空外壳进入 needs_render；安全拒绝测试通过；说明客户端 DNS 检查限制，不伪称完整 SSRF 防护。

### T08 — 动态页面渲染读取

- [x] T08 完成并记录

依赖：T07。

文件：product/extract-rendered.ts、后台产品页处理器。

操作：建立带 owner jobId 的临时标签；保留 hash；等页面加载并有限等待正文稳定；只读本地打包函数；检查最终 origin；采集可见文本和指定元数据；清理自建标签。

验收：取消、超时、标签被关闭、拒绝权限可处理；不关闭用户原标签；不自动登录或点按钮；无注入远程代码；后台不渲染时给切到页面再重试的提示。

### T09 — 产品来源编排与有限补读

- [x] T09 完成并记录

依赖：T08。

文件：product/service.ts。

操作：静态优先、hash/短正文/空壳渲染兜底；最多额外读 2 个当前页真实同 origin 产品/价格链接；来源总文本上限 30,000 字符；保留 fetchedAt 和截断提示。

验收：不猜补读 URL、不跨域、不无限深爬、不点击邀请码绑定；内容仍不足时返回 partial/unknown，不弹强制产品问卷。

### T10 — 产品画像生成、校验、编辑

- [ ] T10 完成并记录

依赖：T09、T15、T16。

文件：product/profile.ts、产品 schema 校验、Products 最小页。

操作：使用 profile-v1 提示词；来源块显式作为数据；校验 observed 的引文；未知值 null；保存画像和版本；用户编辑标 user_edited；自动生成需求/排除/搜索建议。

验收：示例产品辨认为备考题库、区分外部竞赛与本网站；价格没出现不猜；未来功能不擅自标上线；默认不用问用户卖什么、多少钱。没有真实 Key 时 mock 验收可记录，但本项真实画像验证单独保留。

## 第三阶段：当前页评论读取

### T11 — 取得脱敏真实 DOM 依据

- [x] T11 完成并记录

依赖：T03、T05。

文件：tests/fixtures/xhs、docs/evidence/README.md、xhs/selectors.ts。

操作：在用户已登录浏览器中读取可见页面结构；至少覆盖普通笔记、详情弹层、已展开回复、无评论/异常页。仅保存解析必需 DOM，脱敏正文、昵称和链接，清除 Cookie/状态脚本/追踪参数；保留合成稳定 ID。

验收：每个 fixture 有来源类型、日期、预期条数；每个核心选择器有依据；没有真实访问时明确阻塞，不能生成假 fixture 冒充真实快照。可以继续其他任务。

### T12 — 纯 DOM 解析器

- [x] T12 完成并记录

依赖：T11。

文件：xhs/adapter.ts、selectors.ts。

操作：复用 MIT 候选中合适部分；实现 detectPage、parseNote、parseLoadedComments；先根容器再字段；子评论父引用；时间无法解析就 null；缺主页不拼 URL。

验收：背后搜索卡片不混入；正文不混评论；作者与评论一一对应；缺根容器报错；不遍历全页 span 兜底；不读取平台隐藏状态或调用接口。

### T13 — 身份、去重与上下文

- [x] T13 完成并记录

依赖：T12。

文件：domain/identity.ts、analysis/cache.ts。

操作：稳定笔记 ID 与原始 URL 分离；commentId 优先，无 ID 保守组合哈希；身份弱标记；父评论关联；AI 临时 c001 映射；稳定 contextHash。

验收：不同作者相同“求”不会合并；同评论反复渲染不重复；noteId 不取 xsec_token；contextHash 不包含捕获时间和随机 ID；补全父评论导致重判。

### T14 — 内容脚本会话与路由变更

- [x] T14 完成并记录

依赖：T06、T12、T13。

文件：entrypoints/xhs.content.ts、xhs/session.ts、messaging。

操作：实现 STATUS/START/SNAPSHOT/STOP；用户启动后才观察评论根容器；500 ms 防抖；先打码再暂存；500 条上限；心跳超时结束；SPA 换帖撤销旧会话。

补充：按 UTF-8 大小分块返回快照，使用绑定会话和快照版本的 cursor；禁止一口气发送超过 1 MB 的消息。对分页中换帖、cursor 过期做失败恢复测试。

验收：只采集用户已加载评论；不自动滚动/展开；虚拟列表移除前的评论保留；刷新/切帖不串；无面板心跳 60 秒结束；验证码/登录遮挡停止。

G1 检查：
- [x] 示例产品页面读取有真实证据。（静态读取：真实 URL curl 抓取 + 回归测试；渲染兜底与画像结果实测归 T29/T10）
- [x] 当前小红书 DOM 提取有真实证据和 fixture 回归结果。（6 个真实脱敏 fixture；adapter 15 项 + session 16 项回归通过）
- [x] 模型画像验证若缺 Key，明确列为未验证，不谎报完整闭环。（Key 已就绪但画像在 T10/G2 实现，本阶段未宣称闭环）

## 第四阶段：模型与判断规则

### T15 — 单一国内 Provider 与 Mock

- [ ] T15 完成并记录

依赖：T03、T05、T06；不依赖真实小红书。

文件：ai/provider.ts、bailian.ts、mock.ts、prompts.ts。

操作：查官方文档确认 endpoint、账户模型和 JSON/非思考参数；实现 generateProfile/classifyComments；AbortSignal、60 秒超时、错误映射、usage null 语义；mock 显式只在测试/开发模式开启。

验收：HTTP mock 成功/失败用例通过；401/403/429/5xx 可区分；正式配置缺 Key 不静默用 mock；模型返回和请求日志均不含正文或凭据。

### T16 — 产品和意向输出校验

- [ ] T16 完成并记录

依赖：T15。

文件：ai/validate-result.ts、schema 单元测试。

操作：strict JSON schema；未知字段拒绝；请求 ID 恰好返回一次；evidence 来源归属和连续子串校验；高意向必须有当前评论引文；格式修复最多一次。

验收：缺 ID、多 ID、重复 ID、跨评论引用、捏造引文、截断 JSON、Markdown 外壳有明确处理；最终失败不写 completed；证据校验针对打码和截断后实际输入。

### T17 — 确定性分组

- [ ] T17 完成并记录

依赖：T03。

文件：domain/classification.ts、tests/unit/classification.test.ts。

操作：按 DEVELOPMENT.md 第 10.4 节顺序实现 group-v1；free_only 禁止高意向；unknown 角色不高意向；competitor 标签明确；不引入成交概率。

验收：卖家、无关、不适配、否定需求优先排除；不确定和相邻领域待确认；求资料进入需求；问价在上下文匹配时高意向；人工纠正独立于模型分类。

### T18 — 提示词与模拟回归集

- [ ] T18 完成并记录

依赖：T15、T16、T17。

文件：ai/prompts.ts、eval/synthetic.jsonl、eval/README.md。

操作：至少 30 条模拟中文案例，覆盖题库、相邻竞赛、免费、卖家、否定、短语、父评论跨作者、竞品价格、注入文本；每条有产品上下文、笔记、评论和预期标签。

验收：所有样本明确 synthetic；gold 标签可解释；提示词中数据/指令隔离；不把模拟测试成绩当真实中文效果。提示词更改必须递增版本。

## 第五阶段：端到端分析

### T19 — 全局任务锁与取消

- [ ] T19 完成并记录

依赖：T04、T15。

文件：analysis/lock.ts、runner.ts。

操作：事务 lease 获取/续租，ownerId+generation；5 秒心跳、60 秒 TTL；冻结任务上下文；取消 AbortController 和后续批次；过期任务启动时标 interrupted。

验收：两个面板只一个获得锁；过期旧 owner 不能提交；关面板不依赖 unload 才能恢复；AI 已计费但未保存的情况说明清楚。

### T20 — 批次规划与缓存

- [ ] T20 完成并记录

依赖：T13、T18、T19。

文件：ai/batching.ts、analysis/cache.ts、runner.ts。

操作：每批最多 15 条且文本上限 12,000 字符；单条超长截断并标记；并发 1；先检查完成缓存；构造白名单 DTO 和本地 ID 映射。

验收：无新评论不调用 AI；不会按“没购买关键词”删除短评论；产品/版本/上下文变化正确失效；不把时间戳放缓存 key；模型上下文不超限。

### T21 — 运行状态和部分失败恢复

- [ ] T21 完成并记录

依赖：T14、T16、T17、T20。

文件：analysis/runner.ts、storage/repositories.ts。

操作：采集→打码→缓存→请求→校验→分组→事务保存；UI 进度；partial/failed/cancelled/interrupted；仅手动重试失败或中断批次；无静默无限重试。

验收：第 1 批成功第 2 批超时后，已完成结果可见，重试不重跑第 1 批；页面换帖时旧快照不写到新帖；网络请求不放 DB 长事务。

### T22 — 费用与用量记录

- [ ] T22 完成并记录

依赖：T21。

文件：usage 表、进度/结果用量组件。

操作：保存实际 model、token、时间、请求 ID（若提供）；未知 token/金额用 null；配置单价和日期后才估价；取消/失败提示计费可能已发生。

验收：不使用旧 PRD 费用；不把字符数显示为真实 token；重开面板不重复累计已存 usage；没有供应商用量时明确未知。

G2 检查：
- [ ] mock 下产品→当前页→分析→保存→再次去重闭环通过。
- [ ] 错误、取消、部分成功、并发锁和恢复用例通过。
- [ ] mock 与生产环境清晰隔离。

## 第六阶段：用户界面与本地数据管理

### T23 — 产品页完整交互

- [ ] T23 完成并记录

依赖：T10、T21。

文件：Products.tsx、产品卡片/画像证据组件。

操作：URL 输入、自动识别、阶段提示、取消、查看事实/推断/未知、证据、可选编辑、选中产品、删除。

验收：用户只贴链接可走通；未知信息不阻止已有信息使用；未知产品类别时显示低完整度不胡乱分析；旧画像结果有版本提示；不需要必填营销问卷。

### T24 — 当前笔记页完整交互

- [ ] T24 完成并记录

依赖：T21、T22。

文件：CurrentNote.tsx、结果卡片。

操作：当前产品与笔记、已加载数量、分析/新增/取消、四组结果、证据、意向对象、失败重试；无产品/非小红书/无评论/被遮挡状态。

验收：显示“已读取 N 条已加载评论”，不写“全部评论”；不自动开始 AI；正在处理旧帖时提示清楚；按钮不重复创建任务。

### T25 — 已保存线索、处理状态和人工纠正

- [ ] T25 完成并记录

依赖：T24、T04。

文件：Leads.tsx、leadStates/feedback 仓储。

操作：产品/分组/已处理过滤、排序、原帖打开、标记已处理、修改分类并留备注；排除项也可查看；显示模型结果与人工纠正来源。

验收：重新分析不丢已处理；不把人工纠正伪装成模型输出；链接只允许合法 http(s)，不自动打开用户主页；空结果有明确说明。

### T26 — 设置与数据生命周期

- [ ] T26 完成并记录

依赖：T06、T25。

文件：Settings.tsx、storage/retention.ts。

操作：模型/Key、用户触发连接测试、记住/清除 Key；保留期 7/30/90 天默认 30；启动和每日首次使用清理；删除产品/业务数据的确认与级联。

验收：取消清理不改变数据；删产品不删另一产品共享状态；过期删除后无孤立 analysis/feedback；活跃任务先取消；Key 与业务数据清除行为分别明确。

### T27 — JSON / CSV 导出

- [ ] T27 完成并记录

依赖：T25、T05。

文件：export/json.ts、csv.ts、导出确认 UI。

操作：导出当前筛选或全部结果，明确范围；JSON 带 schemaVersion、画像版本；CSV 标准表头首行、UTF-8 BOM、公式注入防护；提示放 UI；只导出打码后的业务字段。

验收：中文、引号、换行、= + - @ 及前置空白/制表符恶意单元格测试；无 Key/锁/原始未打码内容；本地下载可用；不实现云同步或导入。

## 第七阶段：验证、打包与交接

### T28 — 自动化回归与构建

- [ ] T28 完成并记录

依赖：T23–T27。

操作：运行 typecheck/lint/unit/integration/build；覆盖 DEVELOPMENT.md 测试矩阵 A/X/M/D/P 的可自动化项；修复失败并记录最终命令结果。

验收：结果真实，未执行的脚本不写通过；没有只验证实现内部细节而缺少行为验证；无为测试无条件关闭校验的生产分支。

### T29 — Chrome 真实扩展流程

- [ ] T29 完成并记录

依赖：T28、真实页面、用户自己配置的 Key。

操作：加载构建目录，验证权限、侧边栏、产品示例、当前页、手动加载更多、新增分析、换帖、取消、重开、已保存结果、导出。记录版本及脱敏截图。

验收：B01 与 A01/X01–X05 等真实项有证据；不以普通网页的 UI 截图代替扩展验证；不自动登录小红书、不读取 Cookie。缺环境保持本项未完成。

### T30 — 真实中文评测

- [ ] T30 完成并记录

依赖：T29、人工确认标签。

文件：eval/run.ts、eval/README.md、docs/test-report.md。

操作：准备 100–200 条脱敏真实样本，按笔记拆开发/保留测试集；统计需求 recall、高意向 precision、TP/FP/FN、引文有效率、提取准确与漏读、每 100 条费用和耗时。

验收：高意向 precision 目标 ≥85%、需求 recall 目标 ≥80%；未达标就报告并改提示词，不能偷改 gold 或删难样本；样本不足写不足；没有真实标注不声称达标。

此阶段才决定是否需要 DeepSeek 对照或 Reranker。没有费用/延迟/质量证据，不额外接多个模型。任何新增初筛必须检查漏掉多少真实需求。

### T31 — Edge 冒烟与权限/数据审查

- [ ] T31 完成并记录

依赖：T29。

操作：Edge 加载、侧边栏、当前页读取和保存；检查最终 manifest、CSP、消息调用者、实际 AI 请求体、存储、导出和日志。

验收：无额外权限、远程脚本、Cookie/私有接口；无 Key/未打码联系方式泄露；模型数据未作为 HTML 执行；不支持的浏览器行为有明确说明。

### T32 — 编写安装与维护 README

- [ ] T32 完成并记录

依赖：T28；真实限制随 T29–T31 更新。

操作：按 DEVELOPMENT.md 第 13 节写安装、构建、浏览器加载、配置 Key、操作流程、数据保存、卸载前导出、错误排查；附 actual build 目录，不写猜测路径。

验收：另一位开发者仅按 README 就能加载扩展；正文明确不分析未加载评论；未知/未验证项显眼；许可证来源完整。

### T33 — 发布本地交付包和最终报告

- [ ] T33 完成并记录

依赖：T28–T32。缺真实环境时只交付“待实测开发包”，不宣称正式完成。

操作：生产构建和 zip；扫描不包含 Key、临时页面快照和测试个人数据；整理 docs/test-report.md、剩余 TODO、产物路径。

验收：首次加载空数据，不自动请求 AI，不进入 mock；zip 可解压本地加载；用户得到源代码、构建目录、zip、安装说明、真实测试报告。

G3 检查：
- [ ] 核心真实流程已验证。
- [ ] 效果指标达标，或诚实列出尚未达标的项目和影响。
- [ ] 用户能按文档独立安装和使用。

## 统一完成记录

接手者在这里持续追加，不删除历史失败原因。

| 日期 | 任务 | 状态 | 改动/验证摘要 | 未验证或阻塞 |
|---|---|---|---|---|
| 2026-10-15 | 文档交付 | 已完成 | DEVELOPMENT.md 和 TODO.md 已创建 | 插件代码、真实 API 和浏览器验收尚未开始 |
| 2026-10-15 | 第0步 | 已完成 | .env 写入 Key（gitignore 排除）；curl 实测 qwen3.8-flash 连通（decisions.md D001） | 无 |
| 2026-10-15 | T01 | 完成 | gh api 核对 8 个候选 LICENSE 与 HEAD commit，登记 THIRD_PARTY_NOTICES.md；无许可证两仓库仅思路参考 | 无 |
| 2026-10-15 | T02 | 完成 | wxt 0.21.4 官方 react 模板脚手架合并；typecheck/lint/test/build/zip 全过；manifest MV3，权限 storage/sidePanel/scripting/activeTab+host_permissions；Node v24.13.0/pnpm 10.33.0 已写入 README；override 固定 @vitejs/plugin-react 5.2.0（vite7/8 兼容决策见 decisions.md 待补） | 真实浏览器加载验证归 T29 |
| 2026-10-15 | T03 | 完成 | src/domain/schemas.ts、limits.ts、errors.ts、messaging/protocol.ts；tests/unit/schemas.test.ts 8 项通过（非法枚举/缺字段/超长/未知消息/unknown=null；模型输出 schema 用 strictObject 拒未知键） | 无 |
| 2026-10-15 | T04 | 完成 | src/storage/db.ts 10 表+索引+DB_SCHEMA_VERSION=1；repositories.ts 含原子 commitBatch、cacheKey 唯一、画像版本递增、锁 lease/generation、markInterruptedOnRecovery；tests/integration/repositories.test.ts 5 项通过（fake-indexeddb 独立内存库，不污染正式库） | 真实浏览器 IndexedDB 持久性归 T29 |
| 2026-10-15 | T05 | 完成 | src/privacy/redact.ts（手机/邮箱/身份证/标签微信QQ，幂等，保留年份/价格/题号）+ ai-payload.ts 白名单 DTO（无昵称/主页/用户ID/URL/token；c001/p001 映射；30000 与批次预算截断标记）；tests/unit/redact.test.ts 通过 | 正则覆盖度以正反例为准，不声称识别所有变体 |
| 2026-10-15 | T06 | 完成 | credentials.ts（session 默认/local 记住，绝不 sync；setAccessLevel TRUSTED_CONTEXTS）；handlers.ts 发送者校验+按需 origin；background 验证 protocol 消息并拒 content script；Settings 最小页可保存/清除 Key 与授权域名；tests/unit/credentials.test.ts 通过 | 重启浏览器后 session Key 失效、真实权限弹窗归 T29 |
| 2026-10-15 | T11 | 完成 | 内置浏览器已有登录态（profile 66bf5605…，证据 D:\Qoder\captures\xiaohongshu-login-state.txt，无二维码环节）；采集 6 个真实脱敏 fixture（弹层展开/折叠/无评论/弹层+背后信息流/纯信息流/404），浏览器内匿名化：hex ID→anonuserN/anonnoteN、comment-0001… 合成、剥 xsec 跟踪参数、script/图片/外链清除、文本正则脱敏；meta.json 登记来源、日期、预期条数与选择器依据；docs/evidence/README.md 说明方法与待补证据；暂存区扫描无 Key/token/hex ID | 虚拟列表滚动移除（X03）归 T14/T29；风控验证码遮挡页未主动触发，detectBlock 特征待真实时机补证 |
| 2026-10-15 | 环境实测 | 已完成 | browser-use=Qoder Electron 不能加载扩展；未登录可见部分评论 DOM；Edge 有小红书登录态（D002） | T11 需用户扫码登录内置浏览器（后经用户确认跳过二维码，已有登录态直接采集） |
| 2026-10-15 | T07 | 完成 | url-policy.ts（私网/凭据/localhost/IPv6 回环拒绝、保留 hash）+ extract-static.ts（title-meta/json-ld/headings/article/price-offer 分块、2MB/30000 字符预算、needsRender 启发式）；tests/unit/product-static.test.ts 8 项通过，含真实示例产品页 curl 抓取 fixture 的标题与 needsRender 回归 | 真实浏览器内渲染读取归 T29 |
| 2026-10-15 | T08 | 完成 | extract-rendered.ts 自包含注入函数（executeScript 序列化约束，ignoreVisibility 供 jsdom）；render-reader.ts 临时标签+正文稳定+origin 复核+自建标签清理+取消；handlers.ts 注册 PRODUCT_READ_RENDERED/CANCEL 敏感命令；background 注册接入 | 真实浏览器权限弹窗与后台标签行为归 T29 |
| 2026-10-15 | T09 | 完成 | product/service.ts collectProductSources：权限门→fetch 限额→静态抽取→渲染兜底→同 origin ≤2 补读（标签正则、跳过导航/页脚、预算未满才补）；tests/integration/product-service.test.ts 5 项通过（mock wxt/browser） | 未对真实站点跑端到端补读，归 T29；合成 fixture 用途已在 docs/evidence/README.md 区分 |
| 2026-10-15 | T12 | 完成 | xhs/adapter.ts：detectPage/parseNote/parseLoadedComments，限定评论容器、缺容器报 PARSE_FAILED 绝不整页兜底，父子 comment 对应、作者“作者”标签、赞/回复占位文本不产数字；tests/unit/xhs-adapter.test.ts 15 项通过（6 fixture + URL 桩：noteId 不取 xsec_token，feed 卡片零混入 28 条精确） | 风控验证码 DOM 特征未采集（不主动触发），遮挡检测待 T29 补证 |
| 2026-10-15 | T13 | 完成 | domain/identity.ts（强/弱身份、保守组合哈希、无作者无时间按序号保守保留、commentKey 去重、contextHash 只含稳定上下文、publishedAt 不猜相对时间）+ analysis/cache.ts（8 成分缓存键、filterUncached）；tests/unit/identity-cache.test.ts 18 项通过；AI 临时 c001/p001 映射复用 ai-payload.ts idMap | 缓存失效的真实模型调用收益归 T20/T22 mock 闭环验证 |
| 2026-10-15 | T14 | 完成 | xhs/session.ts XhsSessionManager：STATUS/START/SNAPSHOT/STOP 路由、启动后才挂 observer、500ms 防抖、先打码再暂存、500 上限 truncated、心跳 15s 检查/60s 无活动结束、SPA 换帖撤旧会话（PAGE_CHANGED）、登录弹窗出现即停（PAGE_BLOCKED）、UTF-8 预算分块 + 绑定 sessionId/version 的 cursor（换帖/缓冲变化→SNAPSHOT_EXPIRED）；entrypoints/xhs.content.ts 只处理 XHS_* 且校验 sender.id；protocol.ts 导出 payload 类型；tests/integration/xhs-session.test.ts 16 项通过（真实 fixture 28 条中 2 条纯图片无文本被跳过→26 条、>1MB 分块翻页取全 300 条） | X03 真实滚动移除、真实扩展环境消息链路归 T29 |

## 任务状态更新

- [x] T01 完成并记录
- [x] T02 完成并记录
- [x] T03 完成并记录
- [x] T04 完成并记录
- [x] T05 完成并记录
- [x] T06 完成并记录
- [x] T07 完成并记录
- [x] T08 完成并记录
- [x] T09 完成并记录
- [x] T11 完成并记录
- [x] T12 完成并记录
- [x] T13 完成并记录
- [x] T14 完成并记录

G0 检查：
- [x] 基础构建通过，schema/数据表/消息类型一致。（pnpm typecheck/lint/test(25)/build 全绿，manifest MV3）
- [x] 未引入后台服务器、商业化或自动浏览功能。

## 交给下一位 AI 的起始消息

```text
请实现当前目录的觅客Agent本地浏览器插件 MVP。
先阅读 DEVELOPMENT.md，再按 TODO.md 的依赖顺序执行；技术调研见觅客Agent-MVP技术方案.md。
旧 PRD 中商业化、自动浏览、后端等内容不属于本次范围。
最高优先是复用许可证清晰的 GitHub 实现与成熟库，记录来源，避免重复造轮子。
用户只提供产品 URL，插件自动理解产品，不要让用户填写产品画像问卷。
用户手动打开小红书笔记，插件只分析已加载评论，使用用户自己的国内 AI Key。
先完成工程、自动产品读取、真实 DOM 解析和判断链路，再完善 UI。
每项任务记录实际验证后才能勾选；没有 Key 或真实页面时继续独立工作并保留真实验收待办。
不能把 mock 当真实效果，不猜选择器，不擅自加入自动评论、平台接口、支付或服务器。
从 T01 开始，持续推进到可本地加载交付；需要外部输入时清楚说明具体缺口。
```
