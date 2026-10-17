# D016 返回搜索的误暂停与运行诊断（2026-10-17）

基线：812c328 / codex/eric-development，初始工作区干净。用户报告真实验收失败，并提供精确暂停原因：**返回后不是原搜索结果，已暂停，不会猜测其他入口**。

## 根因和证据边界

该文案唯一来自 DiscoveryBrowser.poll('search')，不是500条采集上限，也不是侧边栏单帖恢复按钮。812c328删除了500条主动暂停，但没覆盖导航返回的异常路径：本帖已完成、索引已推进，Back后poll失败，serial.execute catch把整个任务暂停。

确认的代码缺陷：Back后URL可能先回到原搜索结果，旧笔记DOM尚未卸载（hasNote=true或isSearch尚未就绪）。原poll把“搜索URL正确但DOM未就绪”也归入“非原搜索结果”，立即抛出同一文案。原reconcile同样一次检查就失败，因此继续仍留在旧笔记/旧弹层。两项新测试在812c328失败，修复后通过。

修复：在严格匹配原搜索URL的范围内，沿用原30秒/30轮预算等待DOM关闭并确认搜索状态；恢复时同步等待同一过程，不再次Back。实际返回到其他关键词、其他页面、无关笔记仍立即暂停，不放宽URL身份规则，不强跳保存URL、不刷新、不重试点击。新增导航检查上下文快照，避免正常导航过程中旧guard使用混合前后状态；旧帖延迟guard错误须重新检查当前页面，新的真实验证仍暂停。

**用户原失败现场没有保存实际URL和DOM状态，因此不能断言原现场一定属于上述时序窗口。** 此文案也可能表示Back确实返回错误地址；该情况必须保留暂停。真实网页一次正常搜索→卡片打开→Back已成功回到同一搜索URL，没有复现旧现场。新版完整扩展流程仍未验证。新增诊断用于区分“正确搜索URL、DOM过渡”与“真正错误历史目的地”，不能把自动测试当成用户现场修复证据。

## 所有暂停来源审计

全项目搜索pause/paused/resume/continue/advance/postComplete/500/MAX_COMMENTS，结果：

| 来源 | 触发条件 | 作用层级 | 处理 |
| --- | --- | --- | --- |
| discovery/jobs DISCOVERY_CONTROL | 用户pause | 整个寻找任务 | 保留 |
| serial定时guard catch | 登录、验证码、风控、权限、页面/产品身份异常 | 整个任务 | 保留；过期帖检查失败须复查当前页 |
| serial.execute catch | capture、AI、导航或其他步骤抛错 | 整个任务 | 保留；记录source=execute及阶段 |
| browser.poll('search') | 返回了错误地址；旧版也误判同URL未就绪DOM | 整个任务（经execute） | 修复后只在原URL内有界等待 |
| browser.ready/guard/reconcile | 页面身份/结构异常、30秒超时、连续3次脚本失效 | 阻塞当前步骤/继续请求 | 保留，不绕过 |
| captureNote及session | 单帖3分钟/200轮，展开无响应10秒/100次上限，平台/结构/通信/存储异常 | 采集停止或抛错，jobs转换为任务暂停 | 保留，不把失败标完成 |
| analysis runner/lock | AI失败/partial、租约或取消等异常 | 分析子任务，jobs传到serial暂停 | 保留；已采集快照复用 |
| repositories.markInterruptedOnRecovery | Background重启时遗留collecting/analyzing | 持久化任务paused | 保留，用户明确继续 |
| SerialDiscovery构造 | 启动前或恢复前初始paused | 未运行的任务 | 保留；正常run发布running |
| CurrentNote单帖分析/取消/重试 | COMMENTS_START/JOB_CANCEL等 | 独立单帖任务 | 不与寻找客户Continue共用 |
| 500总条数 | captureNote返回stopReason=limit；session停止追加 | 单帖正常采集完成 | 从未返回paused；不改 |
| stop/10分钟截止/本地存储失败 | 主动停止、截止或无法可靠落库 | stopped，非paused | 保留，不打开下一篇 |

## Continue和自动推进

侧边栏Discovery.control('continue') → sendRequest('DISCOVERY_CONTROL') → registerDiscoveryHandlers → 已运行实例等待drained → page.reconcile → task.run；后台重启则加载原Job/discovery创建SerialDiscovery和DiscoveryBrowser、校验产品/模型、reconcile后run。不是CurrentNote的单帖重试。

capturing继续当前帖；captured读取明确commentKeys和本地笔记继续原AI；completed由advanceToNextPost跳过已完成处理。已推进index=1且navigation仍指上一帖时，先返回原搜索，再点击第二帖；ready确认URL和noteKey后才采集。最后一帖只收尾。500是单帖一级+回复总数上限，不是任务总上限；5帖和10分钟含暂停不变。

正常自动链路：captureNote→CAPTURE_COMPLETE/captured→检查点落库→ANALYSIS_START→原AI成功→ANALYSIS_COMPLETE→POST_COMPLETE/completed→CHECKPOINT_SAVED→ADVANCE_REQUESTED→POST_INDEX_CHANGED→NAVIGATION_START→NAVIGATION_COMPLETE→NEXT_POST_READY→下一帖CAPTURE_START。不需要Continue。

## 修改文件与诊断

- src/discovery/browser.ts：原搜索URL内的SPA过渡等待；恢复不重复Back；导航上下文检查；只读页面身份观测。
- src/discovery/serial.ts：结构化事件、每次run独立runId、暂停source、过期检查复查及旧signal检查，完成检查点不重复发布。
- src/discovery/jobs.ts：将诊断与状态一起持久化；采集/分析事件；CONTROL请求记录；晚到collection回调检查原索引/取消状态。
- src/domain/schemas.ts：可选trace结构，无新表/DB版本迁移。
- entrypoints/sidepanel/Discovery.tsx：可展开查看本地诊断，未更换Continue的消息。
- 三个discovery集成测试文件：新增4项；既有结果断言保留。

Job.discovery.trace最多200条，连续同帖同run进度合并；有taskId/runId/postIndex/postKey/postUrl/phase/taskState/captureState/analysisState/pauseReason/source/commentCount/checkpoint/navigation。网址仅origin+path，移除查询参数；matchesSearch只保存比较结果，不记录搜索词或安全参数；无评论正文、账号凭据、API Key或网络请求。runId隔离不同执行，旧signal/索引防止旧回调覆盖新帖；原capture sessionId校验、DB事务和AI owner/generation租约未改。

## 测试与验收

新增4项：
1. 原搜索URL已到、笔记DOM晚关闭：旧版同文案失败，修复后等待一次Back完成，再打开第二帖。
2. returning检查点继续，原搜索DOM晚就绪：旧版恢复失败，修复后等待，零额外Back。
3. 旧帖guard和progress延迟到第二帖：index=1且running，当前帖计数不被旧回调覆盖。
4. 生产handlers→真实capture/session→IndexedDB→原AI runner（MockProvider）→500条第一帖→晚就绪搜索DOM→第二帖采集；PAUSE数0、第二帖捕获身份匹配、数据库500+1=501条，分析501条。

第4项最初因新fixture没有滚动容器而停在第二帖，补上fixture正常的有限滚动容器；没有修改业务代码、数量或期望来掩盖失败。原80条两帖fixture、捕获上限、回复和去重断言均保持。

最终命令：npm test / Vitest **33文件364/364通过**；npm run typecheck、npm run lint、npm run build、npm run zip:edge、git diff --check全部PASS。依赖现有Rollup注释位置警告非阻塞。

| 层次 | 状态 |
| --- | --- |
| A 源码审计/修复 | PASS，导航过渡缺陷已复现 |
| B 单元回归 | PASS |
| C fixture | PASS，合成，不代表现网 |
| D 自动集成 | PASS，真实生产模块，合成页面/Mock AI |
| E 浏览器 | PARTIAL，Edge可读取，普通搜索→打开→Back一次成功 |
| F 新版真实寻找任务 | NOT VERIFIED，未通过新版侧边栏完整执行 |

## 交付和下一次真实验收

Edge ZIP：D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip。
SHA256：9c39acb5cd2ff8e97ce8569b9752b388a1ce820c2267f3ce6960060942c31e71。

重新加载.output/edge-mv3并刷新小红书搜索页，从侧边栏启动新任务，不点击Continue观察是否自动第二帖。若暂停，展开本地“任务诊断记录”，检查PAUSE之前的完成、索引和navigation.matchesSearch/hasNote/isSearch。matchesSearch=false表示实际地址不符，保留暂停并由用户正常返回原结果；matchesSearch=true但30秒DOM未就绪则是页面超时，不能伪称成功。平台验证立即停止验收并记PLATFORM_LIMITATION，不绕过。旧失败任务的完成检查点保留，继续不得重新分析已完成帖。
