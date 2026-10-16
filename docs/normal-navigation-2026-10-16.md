# 正常浏览器交互式切帖交付（D012）

2026-10-16；D:\AI-Toys\seak-lead-agent；起始分支codex/eric-development、HEAD 34e2c38，起始工作区干净。本轮仅本地提交，不发布。

## 验证结论

| 项目 | 状态 | 证据边界 |
| --- | --- | --- |
| 代码实现 | PASS | DOM点击、Back、持久化状态与暂停恢复 |
| 自动测试 | PASS | npm test：30文件310项；基线29文件289项，净增21项 |
| typecheck / lint | PASS | npm run typecheck；npm run lint，退出0 |
| Build | PASS | npm run build；npm run zip:edge，退出0 |
| 合成浏览器 | PASS | 本机IAB，真实DOM/滚动/history/IndexedDB；站点和AI为替身 |
| 真实小红书自动切帖 | NOT VERIFIED | Edge连接不可用，用户选择先交付 |
| 真实评论采集 | NOT VERIFIED | 未运行新版真实任务 |
| 真实回复采集 | NOT VERIFIED | 未运行新版真实展开 |
| 是否触发风控 | 未判定 | 新版真实任务未执行，不能填写NO |
| Lead判断质量 | NOT VERIFIED | 合成闭环使用MockProvider |

本轮采用保守的只读、单页串行、有限任务、人工可暂停、遇已识别验证即停止的设计；尚未证明平台不会采取任何账号限制措施。

## 根因与方案

原DiscoveryBrowser从搜索DOM获取最多5个链接，创建about:blank任务标签，再tabs.update目标URL。未点击真实卡片，也不返回搜索页。用户报告旧路径出现“当前笔记暂时无法浏览，请打开小红书App扫码查看”；具体平台原因未证实，不能称为已确认的“AI检测”。

新版复用原搜索标签：按稳定笔记ID重查section.note-item a[href]（优先cover）→核验页面/链接/平台提示→正常scrollIntoView→复查节点/ID→anchor.click()→等待目标笔记DOM→原采集/分析→tabs.goBack一次→核验原搜索URL且详情关闭→重新定位下一张卡片。候选队列不依赖旧DOM引用或卡片顺序。

网站自身点击处理器可参与正常入口导航，链接属性不改写。这比直接URL跳转更符合页面入口流程，但不能证明现网一定接受程序化点击。click()不是硬件鼠标输入，不伪装isTrusted，不写location/history、不改target、不创建任务标签。点击无效30秒、连续3次脚本/结构失败、错误历史目标、缺失卡片或权限异常均暂停，无强跳/刷新/补点。正常文档卸载临时不可用允许有界等待，其他平台错误立即暂停；加载期间仍执行守卫。

新增笔记不可浏览、扫码查看、非法消息、404/笔记不存在提示识别，排除正文/评论中的引用。不能覆盖未来所有平台DOM。

## 修改文件与模型

- src/xhs/navigation.ts新增真实入口定位/点击及搜索上下文核验。
- src/discovery/browser.ts实现同一标签、Back、等待、继续时核对页面。
- src/discovery/jobs.ts、serial.ts保存导航/完成列表，末篇正常返回；返回失败恢复时不重复分析已完成笔记。
- src/domain/schemas.ts、src/storage/repositories.ts在原jobs.discovery增加可选navigation（mode/sourceUrl/phase/expectedNoteKey）及completedNoteKeys，原子更新导航子字段；没有新表或DB迁移。
- src/messaging/protocol.ts、entrypoints/xhs.content.ts、src/xhs/session.ts增加XHS_SEARCH_STATE/XHS_CLICK_NOTE并沿用发送方校验，候选发现返回sourceUrl。
- src/xhs/discovery-dom.ts增加平台提示和可见详情判断。
- entrypoints/sidepanel/Discovery.tsx说明使用当前搜索标签，显示已完成篇数。
- tests/integration/xhs-navigation.test.ts新增；discovery-browser.test.ts、discovery.test.ts、discovery-e2e.test.ts更新。
- README、DEVELOPMENT、TODO、decisions、test-report、本报告与截图同步边界。

旧直接URL任务无法可靠映射浏览历史，需停止后从搜索页新建；评论/Lead保留。评论仍使用既有commentKey/parentKey，旧一级评论可读。AI Prompt、group-v2、AI payload、runner、DB表版本、lockfile、权限配置均无差异。

## 回复与任务边界

审计确认D011已实现正常回复展开及AI父评论上下文，本轮沿用。当前DOM→提取→去重→增量落库→展开/滚动→等待→再提取，回复离开DOM不删除本地。总500包含一级+回复；命中后不再展开或切页。最多5帖、10分钟含暂停。回复仍限明确的.reply-container .show-more白名单文案、10秒无响应、单帖100次展开。无法确认父子关系时不猜文本；未知精确reply-to仅保留DOM根评论。

## 测试与合成浏览器

- xhs-navigation 12项：实际anchor点击、属性保留、稳定ID重查/重渲染、缺失/其他窗口入口拒绝、搜索上下文、平台提示与正文引用。沿用历史脱敏fixture结构，匿名ID仅在测试中替换。
- discovery-browser 16项（原9项）：A点击→Back→B点击→Back、禁止create/update、等待、验证暂停、3次失败/30秒上限、错误目标/Back、继续复用当前帖或原搜索、端口卸载、取消、权限、加载期间守卫。
- discovery 28项（净增2项）：新增末篇返回失败保留索引、继续仅返回；500后不再导航。原暂停/停止/超时测试保留。
- discovery-e2e原1项更新：生产处理器/session/capture/repository配fake-indexeddb，两帖各20→40且首屏DOM移除，保存80条不串帖；点击/Back重渲染、后台恢复、缓存复用、停止优先及迟到返回不继续点击。
- 原回复去重、父子上下文、虚拟列表、取消禁写、验证、500与10分钟上限测试继续运行。未降低断言。

npm test最终30文件310项通过，9.45秒；typecheck/lint/build/Edge打包通过。Rollup仅有Zod依赖注释标记的非阻塞警告。

localhost:5276专用合成壳复用生产DiscoveryBrowser、SerialDiscovery、XhsSessionManager、captureNote、Repositories及分析runner，扩展tabs桥接/站点路由为替身。站点实际DOM链接点击执行本地SPA导航，返回用原生history.back。域名映射仅测试壳存在，正式域名校验未放宽；不是Edge扩展实测。

每篇首屏20一级评论；点击展开后延迟150ms出现1回复，正常滚动后延迟替换为21–40（首屏DOM消失）。最终completed/index2/comments82，DOM点击2/Back2；本地IndexedDB82条（80一级、2回复）、82条Mock分析、两个首屏评论均保留。另一次暂停时index0/41条，继续后完成且deadline不变。暂停截图静态统计仅第一篇，firstScreensPreserved=false表示“两篇均保留”条件尚未满足；不表示第一篇丢失。最终截图统计定时读取本地库。

- [完成截图](evidence/normal-navigation-synthetic-completed.png)
- [暂停截图](evidence/normal-navigation-synthetic-paused.png)

以上不能证明现网DOM、扩展隔离世界点击、小红书路由兼容或AI判断质量。

## Edge包

路径：D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip；362323字节。

SHA256：c07b66bde14166e583e2bbb9e6966d853a0e897409c69d59fb1c3d2e13e5acbb。

11项逐字节匹配edge-mv3构建；无.env/tests/eval/node_modules/.scratch，Key格式扫描0命中（不是全面无秘密证明）。权限仍storage/sidePanel/scripting/activeTab，未增加。本轮Chrome目录已build，但旧Chrome ZIP未更新，请用新Edge包。

## 下一步真实验收

1. Edge重新加载D:\AI-Toys\seak-lead-agent\.output\edge-mv3，刷新小红书页，停止旧URL任务。用户本地配置Key，不发给Codex/ChatGPT。
2. 已登录网页正常搜索画像建议方向，关闭详情、留在结果页，候选中选有明确回复的笔记；主动开始寻找客户。
3. 不手动助载，观察第1篇点击/等待、一级/回复增长、首屏移除仍存本地、分析，随后正常返回并进入第2篇。默认5篇，可第2篇后主动停止以缩小范围。
4. 中途暂停，确认不再切帖/展开；继续位置正确且时间不重置。停止后不应再点击/写入，停止不强行返回搜索页。
5. 遇扫码/不可浏览/验证码/登录或安全提示，立即暂停，不自动重试；记录阶段、当前帖、任务状态与页面提示，不记录凭据。用户手动处理后才继续，不故意制造或绕过验证。
6. 核对真实Lead原文、父评论、回复及理由，单独评估模型质量。没出现验证不能证明账号安全。

## 限制

Edge不可连接且用户选择先交付，真实自动切帖、评论/回复、暂停恢复和Lead质量均NOT VERIFIED。当前选择器来自历史fixture；现网变化、_blank入口、卡片被虚拟移除、网站忽略程序化点击或不产生Back历史均可能暂停，没有强制URL兜底。只处理已加载最多5篇，不保证相关或采全；超出等待窗口、权限限制可能中断。原标签关闭/ID失效需新任务，持久化metadata不重建浏览器历史。未增加社交互动、私有API、凭据访问、反检测、JEV或数字评分。
