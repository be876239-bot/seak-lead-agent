# 觅客Agent MVP 开发 TODO

2026-10-20 最新（D028，单篇评论采集预算延长）：每100条评论5分钟，最高100分钟/4000轮；未知总数从5分钟起步，仅在持续新增时有界延长。单篇整体主动处理看门狗随采集预算延长，额外预留30分钟用于导航/AI分析，最高130分钟；暂停不计时、旧检查点兼容。typecheck/lint、5个相关测试文件105项通过和Edge build/ZIP通过；真实Edge重新加载验收待完成。详见 `docs/capture-budget-extension-2026-10-20.md`。

2026-10-19 最新（D027，整体 UI 优化）：新增统一侧边栏样式，整理顶部品牌/导航、五个页面标题、表单控件、主按钮、卡片与焦点状态；只改展示层，不改任务/采集/线索存储逻辑。typecheck/lint/Edge build/ZIP/diff check通过；定向4个测试文件30项通过。全量测试仍有3个集成测试文件的4项失败（1项模拟任务未及时完成、3项5秒超时），真实 Edge UI 验收待完成。报告：`docs/ui-refresh-2026-10-19.md`。

2026-10-19 保守浏览节奏：搜索滚动固定等待2.5秒，搜索/评论约1/3屏重叠滚动，帖子间固定停顿3秒且可暂停/停止；不实现随机或反检测行为。真实小红书待验收，见 `docs/conservative-browsing-pace-2026-10-19.md`。

2026-10-19 最新（D026，帖子数量手动输入，用户真实 Edge UI 验收通过）：寻找客户页将固定数量下拉菜单改为数字输入框，默认20，可输入1–100的整数。无效输入显示中文提示并禁用启动；启动函数再次校验，消息协议继续限制1–100。新增输入校验单测；全量38文件/471项通过，typecheck/lint/Edge build/ZIP/diff check均通过。用户已确认默认值、正常范围、越界保护、非法输入保护、实际任务数量五项均通过。报告：`docs/manual-post-count-2026-10-18.md`。

2026-10-18 最新（D025，搜索关键词复制与操作指引，真实 Edge 验收已通过）：产品画像中每条建议搜索词新增复制按钮；寻找客户页可复制当前关键词，并明确提示切回小红书搜索框粘贴、执行搜索。增加启动前搜索结果确认；更换产品/关键词或重新复制后重置确认。新增4项剪贴板单测；全量37文件/456项通过，typecheck/lint/Edge build/ZIP/diff check均通过；用户已确认真实 Edge UI 验收通过。报告：`docs/search-keyword-copy-2026-10-18.md`。

2026-10-18 回复展开超时：已改为非阻塞警告，任务中跳过同一失败父评论的展开入口，其他评论/回复和迟到回复继续保存；警告随检查点保留并触发不完整分析门禁，不冒充采集完整。7项新增回归、452项全量测试通过；用户已确认真实小红书验收通过。报告见 `docs/reply-load-timeout-2026-10-18.md`。

2026-10-18 最新（D023，AI 引文校验修复）：针对真实寻找任务第 8 篇 104 条评论采集已完成、AI 第 7/7 批因 c004 引文不匹配而暂停的问题，强化修复提示，明确逐字引文、同源按序省略、无证据保守降级；修复重试只传安全错误摘要，不把模型生成的引文再次拼入错误指令。不放宽校验、不增加重试次数。新增提示词与集成回归，typecheck/lint 及 48 项定向测试通过；全量 36 个测试文件、444 项通过，Edge build/ZIP/diff check 均通过。用户已确认真实模型/Edge 验收通过。报告：`docs/ai-quote-repair-2026-10-18.md`。

2026-10-17 最新（D021，工程与用户真实验收均已确认完成）：评论采集按显示数量动态分配3–15分钟、200–1000轮；未知数量仅在近期有效新增且接近边界时有界延长。采集累计主动耗时/轮数写入帖子检查点，暂停冻结、恢复不重置；预算耗尽保留结果并跳过分析。单篇30分钟整体保护和无全任务截止时间保持D020。426项自动测试通过，Chrome/Edge已打包；用户确认本轮采集预算与评论完整性验收通过。设计及报告见 `docs/d021-dynamic-capture-budget-2026-10-17.md`。

2026-10-17 最新（D020，取代D019）：寻找客户任务上限可选5/10/20/30/50/100篇，默认20；取消全任务总时限。单篇30分钟主动运行保护，暂停期间冻结，超时自动暂停且检查后可手动继续。旧全局deadline不再生效；保留当前已加载搜索卡片范围、串行执行、单帖500条和平台异常暂停。用户已确认自动切帖真实验收成功；AI线索质量仍未验证。自动测试/typecheck/build结果见 `docs/discovery-limit-extension-2026-10-17.md`。

## 用户反馈统一问题清单（持续维护；本节只记录，不代表本轮实施）

> 此清单合并此前在对话中提出的问题。不要另起一套 UX-01 等编号；新反馈应追加到对应条目或在本清单末尾续号。线索历史不得因任务重置、产品切换或分类调整而被删除。

1. **任务记录与历史线索分离**｜状态：用户真实验收通过（2026-10-18）
   根因：此前只修改了侧边栏显示状态，却没有修改后台互斥检查；现在已修复。用户点击“开始新任务”时，后台会先自动暂停旧任务并安全保存进度；历史任务、评论和线索保留。另已修复“继续上次任务”找不到原浏览器窗口的问题：恢复时不再盲目依赖可能过期的 sourceTabId，而是扫描当前小红书标签页，并用保存的原搜索 URL 与目标笔记身份匹配；无论扩展后台重启后恢复，还是后台仍在运行但原标签页 ID 失效，都能尝试重新定位。唯一匹配或唯一活动匹配时自动恢复并更新 tab ID；没有匹配或存在歧义时会给出中文提示，不会误操作其他页面。

2. **同一产品下按不同获客方向组织线索**｜状态：需求待讨论
   现有线索分类整体效果尚可，不应贸然重做现有分类。缺少的是同一产品的不同方向/场景区分；具体分类类别尚待商讨，先不定死标签。

3. **判断所选帖子质量与相关性**｜状态：待处理
   当前无法可靠判断搜索结果中选中的帖子是否值得分析。后续需要定义相关性/帖子质量信号，减少无关帖子消耗评论采集和 AI 分析时间；不能仅凭标题或任意分数声称准确。

4. **自动切换帖子并连续处理下一篇**｜状态：用户真实验收通过
   用户已确认真实小红书自动切帖成功，正常情况下单帖完成后会自动进入下一篇，无需人工点击“继续”。后续仅在出现回归问题时重新开启验收。

5. **UI 美化与搜索关键词指引**｜状态：代码、自动化测试与真实 Edge UI 验收均通过
   产品画像中的每条建议搜索词提供独立复制按钮；寻找客户页可复制当前关键词，并显示“复制→切回小红书搜索框→粘贴并搜索”的明确步骤。开始任务前必须确认当前小红书页面已显示搜索结果；更换产品/关键词或重新复制会清除确认，避免误用旧确认。剪贴板 API 失败时使用 textarea fallback，若仍失败则给出中文提示。真实 Edge UI 验收标准：复制内容准确；未确认搜索结果时不能启动；确认后可启动；更换产品/关键词/重新复制后确认被重置；历史线索不受影响。详见 `docs/search-keyword-copy-2026-10-18.md`。

6. **帖子数量允许手动输入 1–100 篇**｜状态：代码、自动化验证与用户真实 Edge UI 验收均通过（2026-10-19）
   默认 20 篇，可直接输入 1–100 之间的整数。空值、非整数、低于1或高于100会显示提示并禁用启动。用户于2026-10-19确认默认值、正常范围、越界保护、非法输入保护及实际任务数量五项真实 Edge UI 验收全部通过。数量是处理上限；仍只处理任务开始时已加载的搜索结果卡片，不会自动翻页或加载更多。详见 `docs/manual-post-count-2026-10-18.md`。

7. **优化产品评论分析与线索质量**｜状态：待处理/缺真实评测
   需要用真实评论和人工标注评估误报、漏报及高意向线索质量，再决定是否调整分类规则或分析流程。不能把合成测试通过当作真实准确率，也不应无证据地宣称 JEV 或数字意向评分已实现。

8. **取消单任务 10 分钟总限时**｜状态：代码与自动测试已更新，真实体验待验证
   已取消全任务总截止时间；暂停期间不计时。单篇评论采集预算按每100条5分钟动态分配（最高100分钟/4000轮），整体主动处理看门狗在采集预算外额外预留30分钟用于导航/AI分析（最高130分钟），超时后暂停并保留检查点。后续主要验证真实Edge重新加载、长任务、暂停/恢复和异常处理的真实体验。

9. **利用帖子显示的评论数判断采集完整性**｜状态：用户真实验收通过
   用户已确认评论采集完整性与 D021 动态采集预算验收完成。实现仍以页面显示数量为保守核对信号；页面统计口径可能包含折叠/不可见内容，后续若出现漏采回归再重新开启。详见 `docs/comment-count-completeness-2026-10-17.md`。

10. **自动打开帖子可能触发视频声音**｜状态：仅记录，待方案确认
    自动切换帖子时可能打开含视频的笔记并自动播放声音，对在图书馆、教室、办公室等安静环境中使用的用户不友好。
    **建议方案（优先评估）**：在“寻找客户”任务设置中提供清晰的“任务期间自动静音”开关，默认开启。启动前记录该 Edge 标签原本是否静音，并在第一次自动点击前对整个任务标签启用浏览器级静音；这比只修改网页中的 `<video>` 元素更可靠，不需要暂停视频或跳过视频笔记，也不改变评论采集流程。**静音成功启用后，必须立即向用户给出明显提示**（例如侧边栏状态：“静音保护已开启；任务结束后会恢复原设置”），不能静默改变音频状态。自动切帖和暂停等待期间都保持静音；任务正常完成或用户停止后，恢复任务开始前的静音状态，并向用户提示已恢复。若用户在任务期间手动改变静音状态，应尽量尊重其显式操作，不可盲目覆盖；后台中断/恢复失败时提供可见警告与“恢复原音频状态”兜底。
    **备选方案**：在开始任务前提示用户手动静音小红书标签页；或在内容脚本中对视频元素静音，但网页可能重新创建播放器或恢复声音，可靠性较低。后续验收应覆盖静音开启后的提醒、含视频笔记、连续切帖、暂停/继续、正常完成、用户停止、结束后的恢复通知、异常/后台中断、任务开始前已静音以及用户手动切换静音状态。

11. **未关联回复导致任务失败或上下文丢失**｜状态：用户真实验收通过
    用户已确认：父评论暂时无法关联时，回复应继续保留、明确标注父上下文未知，不应仅因缺失父评论而暂停整个任务；后续如能补全关联，不得重复生成线索。出现回归时再重新验收。

12. **报错提示需要翻译成大白话**｜状态：用户真实 Edge UI 验收通过（2026-10-18）
    已新增统一 ErrorNotice 与错误文案映射，接入寻找客户、产品识别、当前笔记分析；常见错误说明发生原因、当前影响、历史数据保留情况和建议操作，技术详情默认折叠，并对常见 API Key/Bearer Token/Cookie 形式脱敏。用户已确认真实 Edge UI 验收通过；详见 `docs/error-messages-2026-10-18.md`。

13. **AI 分析引文校验失败后修复不充分**｜状态：用户真实模型/Edge 验收通过（2026-10-18）
    真实任务中 104 条评论已采集保存，但最后一批因 `commentId c004` 的引文不是原文连续段而失败。原有修复重发只笼统要求修正格式；现已强化逐字引用、sourceId 对应、同源按序省略与无证据保守降级要求，并只传安全错误摘要。严格校验与单次修复预算保持不变，避免伪造证据和无限消耗额度。用户已确认真实模型/Edge 验收通过。详见 `docs/ai-quote-repair-2026-10-18.md`。

2026-10-17 最新（D016）：812c328真实验收失败，已定位返回搜索检查；修复同URL的DOM过渡误暂停及继续等待，增加本地诊断。新增4项/总364通过，typecheck/lint/build/Edge ZIP通过；真实Edge普通搜索→打开→Back成功，但新版完整寻找任务仍NOT VERIFIED，T29/T30不关闭。见 `docs/discovery-return-audit-2026-10-17.md`。

2026-10-17 最新（D015）：已移除单帖500条后的自动暂停，保留完成检查点与异常/手动恢复；新增6项、总360项通过，typecheck/lint/build/Edge ZIP通过。用户确认上一版暂停/继续人工验收通过，本轮连续多帖流程F仍NOT VERIFIED。见 `docs/discovery-continuous-2026-10-17.md`。

2026-10-17 最新（D014）：完成多帖暂停/继续检查点修复，新增18项，32文件354项测试通过，typecheck/lint/build/Edge ZIP通过。Edge真实页面已可读取，但新版扩展真实流程仍NOT VERIFIED，用户选择先交付；T29/T30不关闭。详见 `docs/discovery-resume-2026-10-17.md`。

2026-10-17 最新（D013）：少量评论漏采修复，24项新增回归，31文件336项全量通过，typecheck/lint/build/Edge ZIP与diff检查通过。短暂节点/列表替换、弱身份误合并、半屏滚动、15秒安静收尾、包装回复和媒体占位详见 `docs/comment-recall-2026-10-17.md`。真实Edge绑定Debugger unattached，用户选择先交付；E浏览器/F真实小红书NOT VERIFIED，不更新T29/T30完成状态。

2026-10-16 最新（D012）：当前搜索标签真实DOM链接点击→等待→评论及回复采集/原AI→正常Back→重新定位下一篇；持久化导航状态、原搜索地址和已完成笔记，异常暂停。30文件/310项测试、typecheck/lint/build/Edge ZIP及合成浏览器两帖82条闭环通过。用户暂无法连接Edge，真实小红书切帖/评论/回复与Lead质量NOT VERIFIED，T29/T30仍未完成。交付与操作步骤见 `docs/normal-navigation-2026-10-16.md`。

2026-10-16 最新（D011）：已实现主动采集中的安全回复展开、延迟/虚拟列表增量累计、parentKey关联修复、一级/回复计数与Lead父评论展示；总500条，不增加DB迁移或AI Prompt/分组变化。测试、包哈希及限制见 `docs/replies-capture-2026-10-16.md`。用户选择先交付，真实小红书未验收，T29/T30保持未完成。

2026-10-16 最新（D010）：已新增用户主动启动的有限串行寻找任务（最多5篇/500条每篇/总10分钟，暂停含在内），正常搜索结果DOM取链接、单任务标签、逐帖采集和原AI分析、异常暂停与中断后手动继续。273项自动测试及最终命令证据见 `docs/serial-discovery-2026-10-16.md`。历史单帖限制由D010在指定范围取代；用户选择先交付代码，真实小红书多帖与模型验收仍未完成，不勾选T29/T30。

2026-10-16 最新增量：按用户新授权实现当前笔记正常滚动懒加载、逐轮落库、取消守卫与实时采集状态；235项测试/typecheck/lint/build通过，新Edge ZIP已生成。合成浏览器20→40且旧DOM移除后IndexedDB保留40；详情见 `docs/incremental-capture-2026-10-16.md`。下方历史“只采集已加载/禁止滚动”约束仅此一项被D009取代；真实小红书仍未验收，不勾选T29/T30。

创建：2026-10-15。配套规范：`DEVELOPMENT.md`。

**当前状态：已有产品识别、当前页采集、批量分类、本地持久化与四页 UI；T29 已有多轮用户反馈和修复记录，但完整验收尚未关闭，T30 没有真实质量指标。2026-10-16 接手审计修复后台 DOMParser 缺失、请求身份映射外传、产品/模型文本脱敏缺口、取消与过期租约迟到提交；本轮证据、未验证项及后续阻塞见 `docs/takeover-audit-2026-10-16.md`，最新运行结果见 `docs/test-report.md`。历史完成勾选保留，不代表 G3 通过。**

本轮后续增量：重试输入一致性、完整响应体超时、静态读取取消、卡片理由/不确定点/主页入口已完成；216 项自动测试与 typecheck/lint/build 通过，Chrome/Edge ZIP 已重建并静态检查。合成卡片内置浏览器预览仅是组件渲染证据，真实闭环和真实模型效果仍未验收。

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

- [x] T15 完成并记录

依赖：T03、T05、T06；不依赖真实小红书。

文件：ai/provider.ts、bailian.ts、mock.ts、prompts.ts。

操作：查官方文档确认 endpoint、账户模型和 JSON/非思考参数；实现 generateProfile/classifyComments；AbortSignal、60 秒超时、错误映射、usage null 语义；mock 显式只在测试/开发模式开启。

验收：HTTP mock 成功/失败用例通过；401/403/429/5xx 可区分；正式配置缺 Key 不静默用 mock；模型返回和请求日志均不含正文或凭据。

### T16 — 产品和意向输出校验

- [x] T16 完成并记录

依赖：T15。

文件：ai/validate-result.ts、schema 单元测试。

操作：strict JSON schema；未知字段拒绝；请求 ID 恰好返回一次；evidence 来源归属和连续子串校验；高意向必须有当前评论引文；格式修复最多一次。

验收：缺 ID、多 ID、重复 ID、跨评论引用、捏造引文、截断 JSON、Markdown 外壳有明确处理；最终失败不写 completed；证据校验针对打码和截断后实际输入。

### T17 — 确定性分组

- [x] T17 完成并记录

依赖：T03。

文件：domain/classification.ts、tests/unit/classification.test.ts。

操作：按 DEVELOPMENT.md 第 10.4 节顺序实现 group-v1；free_only 禁止高意向；unknown 角色不高意向；competitor 标签明确；不引入成交概率。

验收：卖家、无关、不适配、否定需求优先排除；不确定和相邻领域待确认；求资料进入需求；问价在上下文匹配时高意向；人工纠正独立于模型分类。

### T18 — 提示词与模拟回归集

- [x] T18 完成并记录

依赖：T15、T16、T17。

文件：ai/prompts.ts、eval/synthetic.jsonl、eval/README.md。

操作：至少 30 条模拟中文案例，覆盖题库、相邻竞赛、免费、卖家、否定、短语、父评论跨作者、竞品价格、注入文本；每条有产品上下文、笔记、评论和预期标签。

验收：所有样本明确 synthetic；gold 标签可解释；提示词中数据/指令隔离；不把模拟测试成绩当真实中文效果。提示词更改必须递增版本。

## 第五阶段：端到端分析

### T19 — 全局任务锁与取消

- [x] T19 完成并记录

依赖：T04、T15。

文件：analysis/lock.ts、runner.ts。

操作：事务 lease 获取/续租，ownerId+generation；5 秒心跳、60 秒 TTL；冻结任务上下文；取消 AbortController 和后续批次；过期任务启动时标 interrupted。

验收：两个面板只一个获得锁；过期旧 owner 不能提交；关面板不依赖 unload 才能恢复；AI 已计费但未保存的情况说明清楚。

### T20 — 批次规划与缓存

- [x] T20 完成并记录

依赖：T13、T18、T19。

文件：ai/batching.ts、analysis/cache.ts、runner.ts。

操作：每批最多 15 条且文本上限 12,000 字符；单条超长截断并标记；并发 1；先检查完成缓存；构造白名单 DTO 和本地 ID 映射。

验收：无新评论不调用 AI；不会按“没购买关键词”删除短评论；产品/版本/上下文变化正确失效；不把时间戳放缓存 key；模型上下文不超限。

### T21 — 运行状态和部分失败恢复

- [x] T21 完成并记录

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
- [x] mock 下产品→当前页→分析→保存→再次去重闭环通过。（tests/integration/analysis-e2e.test.ts 8 项：真实 fixture 26 条评论 → 15+11 两批 → 26 条分析入库；重跑 0 次 AI 调用）
- [x] 错误、取消、部分成功、并发锁和恢复用例通过。（超时 partial+只重试失败批、CANCELLED 中断可重试、LOCK_HELD 互斥不留 Job、换帖守卫、画像修复一次、running 遗留恢复）
- [x] mock 与生产环境清晰隔离。（MockProvider 仅显式注入；getProvider 工厂缺 Key 报 AI_AUTH 不回退 mock，已单测）

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

- [x] T28 完成并记录

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
| 2026-10-15 | T15 | 完成 | ai/provider.ts（AIProvider 接口 + AIResponse usage null 语义）、ai/bailian.ts（POST {baseUrl}/chat/completions、qwen3.8-flash、response_format json_object、enable_thinking:false、外部 AbortSignal+60s 超时合并、401/403→AI_AUTH、429→AI_RATE_LIMIT、413→AI_PAYLOAD_TOO_LARGE、5xx/网络→AI_TIMEOUT、外部取消→CANCELLED、坏 JSON→AI_INVALID_OUTPUT；错误消息只带 provider message 截断 200 字符，绝不含评论正文或 Key）、ai/mock.ts（显式注入、缺脚本报错不静默回退、failures 队列）、ai/prompts.ts（profile-v1/comment-v1 系统提示词、数据与指令分离、few-shot 标注模拟样例）；tests/unit/ai-provider.test.ts 覆盖 HTTP 成功/失败/取消/截断/日志洁净 | 真实云端批量分类闭环归 T22/T30 |
| 2026-10-15 | T16 | 完成 | ai/validate-result.ts：validateProfileOutput（strict schema、user_edited 拒绝、observed 必带证据、sourceId 归属、引文对打码截断后实际输入做去空白连续子串）+ validateClassificationOutput（顶层 strict results、缺/多/重复 ID 拒绝、证据只允许本条 cNNN:text/parent.sourceId/n001、跨评论引用与捏造引文拒绝、条数一致）；修复消息 buildRepairMessages 最多一次；tests/unit/validate-grouping.test.ts | 修复轮次实际效果依赖真实模型，归 T30 |
| 2026-10-15 | T17 | 完成 | domain/classification.ts group-v1 有序规则：排除（无关/卖家/不适配/否定需求）→待确认（unknown/相邻/不确定）→高意向（direct+明确需求+supported+seeker+付费意图+本人评论证据）→需求→待确认；free_only 与 unknown 角色禁止高意向；competitor 允许高意向但 needsTargetBadge 标注；无成交概率；人工纠正独立（Feedback 表不改 group 判定） | 规则阈值真实效果归 T30 真实评测 |
| 2026-10-15 | T18 | 完成 | eval/synthetic.jsonl 32 条全 synthetic（high_intent 8/need 5/review 11/excluded 8，覆盖题库、相邻竞赛、免费、卖家、否定、短语、父评论跨作者、竞品价格、注入文本）+ eval/README.md 说明来源与限制；生成器 .scratch/build-synthetic.mjs 内置引文子串自检；tests/integration/synthetic-regression.test.ts 5 项：gold 全部通过 validateClassificationOutput、groupDecision 与期望一致、高意向全有自评论证据且零 free_only | 模拟成绩不代表真实中文效果，真实准确率归 T30 |
| 2026-10-15 | T19 | 完成 | src/analysis/lock.ts TaskLockManager：5 秒心跳续租/60 秒租约（LOCK_TTL_MS）、跨面板互斥由 acquireLock 事务+generation 递增、assertOwned 提交前用 renewLock 校验 owner+generation（过期旧 owner 拒绝）、cancel=abort(CANCELLED)+释放锁、租约丢失自动 abort、recoverInterrupted 启动恢复；errors.ts 增 LOCK_HELD；background.ts 启动即标遗留任务 interrupted（不依赖 unload）；tests/integration/lock.test.ts 9 项通过（双面板互斥、崩溃接管、心跳保活、残留心跳不误伤） | 真实双面板并发与"AI 已计费未保存"语义归 T21 runner/T29 |
| 2026-10-15 | T20 | 完成 | ai/batching.ts planCommentBatches：≤15 条/批且评论文本 ≤12,000 字符、父评论文本计入批次开销、单条超限截断标 truncated、不丢弃任何候选（无关键词过滤）；analysis/cache.ts filterUncached 先查缓存（无新评论 0 批=不调 AI）；ai-payload.ts 提取 classificationOverheadChars 与 DTO 计数同源，runner 以 overhead+批字数为预算保证规划条目全部进入；tests/unit/batching.test.ts 8 项通过（含 DTO 一致性、画像版本变化经 cacheKey 成分失效在 e2e 验证） | 真实模型上下文上限核验归 T30 |
| 2026-10-15 | T21 | 完成 | analysis/runner.ts：runCommentsJob（锁→缓存过滤→批次持久化→逐批 采集后打码文本 DTO→classify→validate→repair(1)/retryable(1)→group-v1→commitBatch 事务；并发 1；换帖守卫 PAGE_CHANGED；cancelled/partial/failed/completed/interrupted 状态机）、retryCommentsJob 仅重跑 failed/interrupted 批（e2e 断言第 1 批绝不重跑）、runProfileGeneration（T10 数据层：buildProfileInput→validateProfileOutput→createProduct/replaceProfile 版本递增）；progress 回调供 UI；provider 接口增 RepairTurn（appendRepair 带坏输出、仅一次）；repositories 增 getJob/getNote/getProduct/getComments/batchesForJob/existingCacheKeys/addUsage/analysesForProduct，修正 deleteProduct/analyses 查询走复合索引；tests/integration/analysis-e2e.test.ts 8 项通过 | UI 进度呈现归 T23/T26；真实百炼端到端归 T30；后台消息接线（面板触发 runner）归 T23 |
| 2026-10-15 | T22（数据层） | 部分完成 | Usage 表增 providerRequestId；runner 落真实 model/token（供应商缺失记 null）、durationMs、attemptIndex、请求 ID（若提供）；estimatedCny/priceVerifiedAt 保持 null（配置单价属 UI）；失败/无效输出尝试即时写 status failed/unknown（AI 可能已计费如实记录），重开面板不重复累计=读已存 usage（UI 侧待做）；ai/factory.ts getProvider 缺 Key AI_AUTH 不回退 mock + 单测 2 项 | 单价配置、用量组件与取消计费提示 UI 归 T25/T26；"不重复累计"需 UI 联调验收 |
| 2026-10-16 | T22（用量 UI）+T23–T27（M3 开发） | 部分完成（自动化验证通过） | 后台协调器 src/analysis/jobs.ts：PRODUCT_CREATE/NOTE_ANALYZE/JOB_GET/JOB_CANCEL/JOB_RETRY 注册为敏感命令（isTrustedSender），面板 client.ts sendRequest；runner 两入口改 jobId 先行（created 行先落库、LOCK_HELD 也留痕 failed，e2e 并发断言更新）；锁增 findHandleByJob 供取消；src/xhs/capture.ts 采集编排 STATUS→START→cursor 翻页→STOP（单测 5：翻页汇总/中途报错仍 STOP/blocked/unsupported/标签页不可达）；Products.tsx（贴链接→阶段提示→取消→事实/推断/未知+证据→选中/删除/版本显示、类别未知低完整度提示）；CurrentNote.tsx（"已读取 N 条已加载评论（非全部评论）"、不自动开始 AI、按钮 busy 禁用不重复建任务、重开面板按 storage 记录恢复轮询、旧帖换帖提示、四组结果+证据+意向对象+模型/人工来源+已处理、失败批 JOB_RETRY、限流/遮挡/无产品/非笔记页状态齐全）；Leads.tsx（分组/处理/关键词过滤、纠正弹窗写 Feedback 不改模型原判、safeExternalUrl 原帖链接不自动打开、空结果解释、JSON/CSV 导出当前筛选）；Settings.tsx：Key 区保留+连接测试（用户触发的最小 chat 请求）、保留期 7/30/90 默认 30 存 storage.local、立即清理带确认（取消不改数据、活跃任务先拒绝）、启动+每日首次自动清理（retention.ts 级联无孤立、leadStates 保留、集成测试 5）、用量汇总（token 未回报明确未知不冒充；单价+核验日期齐备才估价）+失败/取消可能已计费提示、清除 Key 与清除业务数据分离入口；ui/logic.ts 纯函数（buildLeadGroups/profileUnknownLabels/jobPhaseLabel/summarizeUsage/estimateCny/safeExternalUrl）单测 9；export csv.ts UTF-8 BOM+公式注入（=+-@ 与前置空白/Tab）+引号换行转义、json.ts schemaVersion+profileVersion 且无 Key/昵称/sourceBlocks（单测 5）；pnpm typecheck/lint/build 全绿，187 项测试通过 | 真实浏览器侧边栏操作流（点击、确认弹窗、下载、双面板互斥 UI 表现）归 T29；真实模型效果归 T30 |
| 2026-10-16 | 用户第四轮反馈：ID 抓取错误＋意向三档＋分组降门槛（D007） | 完成（自动化验证） | ①小红书用户 ID 修复：adapter 主页 href 先剥 `?xsec_token` 等查询/片段再取路径段作 authorLocalKey，profileUrl 转绝对 URL（旧相对链接被 safeExternalUrl 拒绝导致"主页打不开＋ID 带参数尾巴"）。②意向展示并为三档中文：意向本产品/意向该品类/无意向（intentShortCn；intentTarget 存储与导出协议枚举不变，竞品徽章保留）。③分组降门槛 group-v2：高意向去掉"当前评论自身证据"硬条件、solution_seeking 计入付费信号、adjacent/非需求方身份由 review 放宽到 need；uncertainty 与判不了字段仍 review。计费保护：缓存键组成固定 CACHE_RULE_VERSION=group-v1（分组规则不影响模型判断），规则升级不使已付费结果失效；buildLeadGroups 对旧 ruleVersion 行按当前规则免费重算展示，人工纠正优先。文档：DEVELOPMENT.md 10.4 表格重写 v2＋decisions.md 增 D007＋eval/README 记录 5 条 synthetic 重算（s03/s14/s23 need→high，s17/s26 review→need，决策字段未动）。新增/更新单测：查询参数 href 用例、免费重算与纠正优先用例、v2 规则逐条断言。typecheck/lint 通过、194 项全绿，zip 重建 283.27 kB | 真机复测：重新采集同一笔记（完整重试）看 ID/主页正常；旧结果直接打开即新分组；分组质量待 T30 纠正样本量化 |
| 2026-10-16 | 用户需求：当前笔记加"完整重试"按钮 | 完成（自动化验证） | 当前笔记页在存在非活跃任务时显示"完整重试（重读页面＋重跑全部）"按钮：window.confirm 说明费用语义后复用既有 analyze() 流程——重新采集本页已加载评论、新建 jobId 全量过缓存过滤，已分析成功命中缓存不计费、失败/未分析重新提交。与"重试失败/中断批次"（同任务内只重跑 failed 批行）互补：覆盖任务早期失败没有批次行、或评论快照本身需要重读的场景；不改协议与 runner。typecheck/lint 通过、191 项全绿，zip 重建 283.05 kB | 真机复测：失败任务后点完整重试，确认日志显示新批次规划与缓存数 |
| 2026-10-16 | 用户指示修订：昵称不打码（D006） | 完成（自动化验证） | 用户强烈要求导出/界面显示网友昵称原文。session.ts 昵称改为仅规整空白不 redactText；红线不变：昵称/主页/ID/属地仍绝不进 AI DTO（白名单零引用，redact.test DTO 用例继续守卫）、评论/笔记正文/属地仍打码、Key 规则不动。规格与文档同步修订：DEVELOPMENT.md 第 9 节改写昵称条款并注明 2026-10-16 用户指示、docs/decisions.md 增 D006（含"导出文件含原始昵称，本地自担"风险口径与"旧库打码昵称在重新采集时覆盖"说明）、README 导出句改"昵称原文（D006）"。redact.test 的"昵称中的联系方式也打码"用例只测 redactText 工具函数本身，保留不动。typecheck/lint 通过、191 项全绿，zip 重建 282.93 kB | 真机复测：对同一笔记再点一次"读取并分析已加载评论"（全缓存命中不产生费用）即把旧快照昵称覆盖为原文，随后导出核对 |
| 2026-10-16 | T29 第七轮反馈：导出补网友身份字段（昵称/用户ID/IP属地/主页） | 完成（自动化验证） | 用户问新产品是否保留旧评论数据、并要求导出含昵称/小红书 ID/位置。答复与改动：①笔记与评论快照按 noteKey 独立存库，与产品无关——新建/切换/删除产品都不动评论原文（deleteProduct 仅级联删该产品的 analyses/leadStates/feedback），同一笔记换新产品需对新评论逐条 AI 分类（产品上下文变了，属预期费用），原始评论不重抓；数据保留仍受设置页保留期（默认 30 天）约束。②昵称/主页/用户在解析层早已抓取且有 fixture 依据（.author a.name、href），此前落库但导出被过滤、IP 属地解析后被丢——本次补齐：CommentSchema 增 locationText（nullish，旧数据读取兼容，Dexie 表无索引变化不升 DB_SCHEMA_VERSION），session.ts 落库时 redactText 后保留属地；JSON 导出 schemaVersion 1→2（authorNickname/authorUserId/ipLocation/authorProfileUrl，均脱敏且经 safeExternalUrl），CSV 增"网友昵称/小红书用户ID/IP属地/评论者主页"四列；结果卡与线索行显示"昵称 · 属地"。③红线核验：ai-payload.ts 白名单不引用任何身份字段（grep 证实），属地/昵称绝不进 AI DTO（DEVELOPMENT 427 行合规）；昵称/主页本就"仅本地使用"（423 行），导出属本地文件、README 已注明含身份字段。④说明"小红书 ID"口径：导出的是主页链接中的用户唯一 ID（24 位 hex），App 内公开"小红书号"需逐人访问主页，属自动浏览红线不做。导出单测重写（含昵称/北京/用户ID 断言+CSV 表头），typecheck/lint 通过、191 项全绿，zip 重建 282.93 kB | 真机复测：新采集的评论才带属地（旧快照无该字段，导出为空）；导出文件在 Excel 打开核对四列 |
| 2026-10-16 | T29 第六轮反馈（第五轮追加要求）：日志写全底层错误 | 完成（自动化验证） | 用户要求"底层错误、错误代码都写进日志并附信息"。①bailian.ts：所有非 2xx 响应读取错误体，errorDetail() 优先取 JSON error.message（否则取纯文本，压缩空白、≤160 字符），AI_AUTH/AI_RATE_LIMIT/AI_PAYLOAD_TOO_LARGE/AI_TIMEOUT(5xx)/UNKNOWN 的报错一律附 `HTTP <码>：<详情>`；连接失败沿用上一轮已加的 `err.name: err.message`。②runner.ts：新增 safeErrSummary()——校验类（AI_INVALID_OUTPUT）只保留"："前说明段（该段自带 commentId/sourceId，而引文原文=评论正文，红线不进日志），其余错误消息完整外显 ≤140 字符；批次失败/自动重试/修复重发三类日志全部附带原因摘要（此前只有错误码）。③jobs.ts failLog 已有同规则不变。typecheck/lint 通过、191 项全绿（一次机器负载导致的计时波动，重跑即绿），zip 重建 282.70 kB | 真机复测：故意输错 Key/断网各跑一次，确认日志能直接读出 HTTP 401 详情与 net:: 类底层原因 |
| 2026-10-16 | T29 第五轮反馈：AI_TIMEOUT 秒级失败无诊断信息 | 已定位机制并改进（待重测取证） | 用户 66 条评论任务 4 批全部"提交后 0–1 秒 AI_TIMEOUT"。判定非真实超时（真超时须等满 aiTimeoutMs）：bailian.ts 把所有 fetch 抛错（断网/DNS/连接被拒等）兜底归为 AI_TIMEOUT 且**丢弃底层报错原因**，重试还零间隔连打两次，日志完全无法定位。改进：①连接失败保留 `err.name: err.message`（≤120 字符，不含 Key）进 AppError 与日志；②自动重试加 1.5s 退避（RunnerDeps 新增可选 retryDelayMs，集成测试注入 0），日志写明"N 秒后自动重试 1 次"；③批次失败日志附安全错误摘要（AI_INVALID_OUTPUT 仍只记码，防引文外泄）。typecheck/lint 通过、191 项全绿，zip 重建 282.61 kB | 真实根因待用户重跑回贴新日志：若显示 Failed to fetch/net:: 错误则为网络/端点问题（可先在设置跑"连接测试"分流），若仍秒败且详情异常再回代码排查；本次未改动任何请求构造 |
| 2026-10-16 | T29 第四轮反馈：界面英文枚举与分组依据不可见 | 已修复（待重测） | 用户看到"意向对象：category"质疑未本地化，且不清楚高意向/有需求怎么划分。①根因：枚举值（intentTarget/productFit）按协议以英文存库，UI 直接渲染了原始值——不是模型没输出中文（needSummary/reason 等正文本就是模型按中文提示词写的）；修复：src/ui/logic.ts 增 INTENT_TARGET_CN/PRODUCT_FIT_CN 对照表，CurrentNote/Leads 全部改用中文标签，导出与库内值保持英文协议不变。②规范缺口：classification.ts needsTargetBadge（竞品/品类必须标注"并非本产品"，DEVELOPMENT 10.4）此前从未接入 UI——本次在两张卡上都补了黄色标注。③可解释性：当前笔记页结果区加"分组依据"折叠说明（group-v1 五条件/降级路径/纠正入口），分组由本地规则决定、模型只出字段，判错引导用"修改分组/备注"积累纠正样本。typecheck/lint 通过、191 项全绿，zip 重建 282.43 kB | 划分"不准"的具体案例待用户回贴（评论原文+意向对象/匹配显示值），准确率调整须待 T30 用纠正样本量化后进行，不凭感觉改规则 |
| 2026-10-16 | T29 期间增量：批次级日志与慢感知诊断 | 完成（自动化验证） | 用户反馈"18 条分析很慢、日志只显示到已读取 18 条"。诊断：18 条按计划为 2 批（≤15 条/批）串行提交，批次开始/返回之间无任何日志事件（onProgress 仅在批次结束触发），模型单批响应 0.5–2 分钟造成"卡住"观感；速度本身由批大小与串行决定，属预期行为。改进：①runner 增加 log 回调（jobs.ts 接 emitJobLog）：批次规划（N 条需模型/缓存命中不重复计费）、批次提交（条数+估算字符）、完成（耗时秒+token 用量）、缓存命中跳过、失败码、自动重试与修复重发提示；重试路径同样输出计划；画像生成补"模型返回耗时/校验通过/修复重发"。②隐私补漏：failLog 对 AI_INVALID_OUTPUT 只记录"："前的说明前缀，引文原文（可能为评论正文）不再进日志（修复轮内部 errorSummary 不变）。③当前笔记页加静态提示：先手动滚动加载更多再点分析（自动滚动属 DEVELOPMENT.md 红线不做），说明再次分析时已分析条目走缓存。typecheck/lint 通过、191 项全绿，chrome+edge zip 重建 281.67 kB | 日志密度与耗时显示效果归真机复测 |
| 2026-10-16 | T29 期间增量：产品历史记录与同链接复用 | 完成（自动化验证） | 用户需求"分析结果保存下来下次直接用，历史记录近 5 条"。Products.tsx：①画像本就存 IndexedDB，新增底部"历史记录（最近 5 条）"按 updatedAt 倒序，点记录即选为当前产品并展开画像，**不调用模型、零费用**；②输入链接与已有产品的 inputUrl/finalUrl 归一化匹配（剥 hash/search）时显示蓝色提示卡"这个链接已识别过"，提供"直接复用（不调用模型）"与"重新识别（更新同一产品，会调用模型）"两个按钮；后者走 PRODUCT_CREATE 既有 existingProductId 通道，runProfileGeneration replaceProfile 递增 profileVersion，不产生重复产品（协议与 jobs.ts 本就支持，本次仅接入 UI）；③顺带记录上一提交 4952a85：扩展重载后旧标签页 content script 失效是"无法连接笔记页面脚本"主因，提示语改为引导刷新该标签页。typecheck/lint 通过，191 项测试全绿，chrome+edge zip 重建 280.99 kB | 真机复测：复用提示、重新识别版本递增、历史记录点击归用户浏览器操作 |
| 2026-10-16 | T29 第三轮反馈：真实模型引文校验过严 | 已修复（待重测） | 用户识别 https://www.xiaoman.cn/ 报 AI_INVALID_OUTPUT"证据引文不是来源块连续原文：s003"（日志框直接定位）。本地真实复现（一次性脚本已删）：qwen3.8-flash 的 8 处"捏造嫌疑"全是省略号拼接的多段逐字原文（标准引文惯例），非幻觉。修复：isNormalizedSubstring 改为按 …/... 分片、每片需去空白+NFKC 后在来源文本中**按序**连续命中（乱序/含不存在片段仍拒绝）；profile/comment 提示词明确"可用…按序省略、每段逐字"→ 版本递增 profile-v2/comment-v2（旧缓存自动失效，符合规范）；修复轮的报错摘要带上失败引文原文，提高一次修复的成功率。新增单测：省略号分节通过/乱序拒绝/捏造拒绝/空片段拒绝。typecheck/lint/191 项全绿，zip 重建 280,459 字节 | 真实站重跑画像归用户复测；引文近似失败的残余率待 T30 统计 |
| 2026-10-16 | T29 期间增量：Base URL 选择 + 任务日志框 | 完成（自动化验证） | 用户需求两项：①设置页"模型与 Key"加 Base URL 下拉（百炼国内/国际官方端点白名单，credentials.ts isAllowedBaseUrl/resolveBaseUrl，后台与连接测试统一使用，符合 DEVELOPMENT.md 4.2"仅预设域名"）；②任务日志框 src/ui/joblog.ts：后台 PRODUCT_CREATE/NOTE_ANALYZE/JOB_RETRY 各步骤 emitJobLog 广播（开始/来源块统计/提交模型/采集条数/批次进度/结束/错误码），面板 JobLog.tsx 订阅过滤 jobId、上限 200 行、错误红色；启动即失败（未授权/缺 Key）经 emitLocalJobLog 也进框；设置页复选框"显示任务日志框"存 storage.local ui.logPanel **默认关闭**；日志只含步骤/进度/错误码，无评论正文与 Key（消息为非 protocol 类型，后台与 content script 监听自然忽略）。新增单测 3（190 项全绿），typecheck/lint 通过，zip 重建 280,200 字节 | 日志框实时性、渲染表现归 T29 真机复测 |
| 2026-10-16 | T29 第二轮反馈：产品域名授权缺失 | 已修复（待重测） | 用户识别 https://plant.dingzhitui.net/ 报 PERMISSION_DENIED。根因：后台 fetch/渲染前校验 `permissions.contains`，但产品页"读取并生成画像"从未在用户手势内发起 `permissions.request`（设置页只有模型域名授权按钮），任何新产品域名必然被拒。修复：Products.tsx start() 先解析并校验 http(s) origin，在点击手势内 `browser.permissions.request({origins:[origin+'/*']})`，拒绝时明确提示"未授权 …：请重新点击并选择允许"，授权通过才建任务发 PRODUCT_CREATE；后台校验逻辑不变（后台无法弹窗，属 MV3 约束）。typecheck/lint/187 项通过，chrome+edge zip 重建 | 需用户重载扩展后复测：首次识别应弹域名授权窗，允许后画像正常生成 |
| 2026-10-16 | T29 首轮反馈：Key 保存缺陷 | 已修复（待重测） | 用户真机加载后产品页报"未配置 API Key"。根因：saveCredential 开头调用 `storage.session.setAccessLevel('TRUSTED_CONTEXTS')`，真实 Chrome 要求 `{ accessLevel }` 对象参数，字符串直接抛错导致 Key 从未写入；单测 mock 的 session 无此方法被可选链跳过，故 187 项全绿仍未拦截（自动化盲区，正是 T29 价值）。修复：删除该调用（session 默认 TRUSTED_CONTEXTS，本就无 untrusted 上下文读 Key）；load/clear 对 session 区不可用容错回退 local；不支持 session 的浏览器给出明确报错而非静默；Settings 保存/清除按钮 try/catch 显示"保存失败：…"；credentials 单测 mock 改为模拟 Chrome 参数校验防回归。typecheck/lint/187 项通过，chrome+edge zip 重建（278,038 字节） | 需用户在 Edge/Chrome 移除旧扩展、重新加载 .output\edge-mv3 后复测保存 Key→连接测试→产品分析 |
| 2026-10-16 | T33（交付包扫描，待实测） | 进行中 | zip 解压审查通过：chrome/edge 两个 zip 各 277,902 字节、可解压为 manifest.json+background.js+chunks+content-scripts+sidepanel.html+icon 共 10 项；包内扫描无 `sk-` Key、无 .env、无 fixture/脱敏样本个人数据残留；构建产物中不存在 MockProvider（mock 仅测试注入）；`env/cookie` 命中仅为 Dexie 内部代码。源代码（本仓库）、构建目录（.output/chrome-mv3、.output/edge-mv3）、zip、安装说明（README）、测试报告（docs/test-report.md）齐备 | 按 T33 规则本阶段只算"待实测开发包"：正式交付以 T29 真实浏览器验收、T30 真实评测、T31 Edge 实机冒烟完成为准，均需用户浏览器操作 |
| 2026-10-16 | T28 | 完成 | 全量回归真实执行并记录在 docs/test-report.md：pnpm typecheck/lint 通过；pnpm test 187 项全绿（unit 134 + integration 53，见分项命令）；pnpm build/zip 产出 .output/chrome-mv3 与 edge-mv3，seeklead-agent-0.1.0-chrome.zip / -edge.zip 各 277,902 字节；发现并修复 package.json 脚本缺陷（`vitest run --dir tests/integration` 与 vitest include 冲突导致静默 0 个文件——改为路径式 `vitest run tests/integration` 并补 test:unit）；矩阵 A/X/M/D/P 可自动化项与测试映射见报告第三节 | 需真实浏览器/真实模型的矩阵项（真机 UI、双面板互斥表现、真实中文效果）在报告中逐条标注归 T29/T30/T31 |
| 2026-10-16 | T31（静态部分）+T32（初稿） | 部分完成 | T31 静态审查（报告第四节）：构建 manifest 权限仅 storage/sidePanel/scripting/activeTab + optional_host_permissions（按需申请），无远程脚本，CSP 默认；content script 仅接受 browser.runtime.id 发送者的 XHS_* 消息；AI 请求体白名单 DTO（无昵称/主页/用户 ID/原始 URL/token）；.output 产物 grep 无 `sk-` Key、无未打码联系方式；localhost 字样仅为 url-policy 拒绝清单与 Dexie 内部。T32：README.md 按 DEVELOPMENT.md 第 13 节重写——开发状态横幅（T29/T30 未完成显眼标注）、环境版本、安装构建命令（含 build:edge/zip）、chrome://edge:// 加载步骤、五步操作流程、数据存储位置与卸载前导出、已知限制（只分析已加载评论、验证码即停、仅公开 URL、仅 Windows Chrome/Edge）、THIRD_PARTY_NOTICES 指引 | Edge 实机加载冒烟归 T31/T29（需用户浏览器，D002：内置浏览器不能加载扩展）；"另一位开发者仅按 README 能加载"待 T29 实测确认；README 中的构建目录以当前 .output 实际产物为准 |

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
- [x] T15 完成并记录
- [x] T16 完成并记录
- [x] T17 完成并记录
- [x] T18 完成并记录
- [x] T19 完成并记录
- [x] T20 完成并记录
- [x] T21 完成并记录
- [x] T28 完成并记录

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
