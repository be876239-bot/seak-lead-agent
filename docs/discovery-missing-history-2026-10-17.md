# D017 缺少浏览历史时的正常返回（2026-10-17）

基线5b731f0。用户提供真实PAUSE：source=execute、postIndex=4、当前目标capturing/0条，navigation=returning且仍在上一帖，pauseReason=`Cannot find a next page in history.`。

## 已确认根因

串行任务已推进到第5帖，不是正常完成后主动pause。调用链是SerialDiscovery.execute → DiscoveryBrowser.navigate(下一帖) → returnToSearch → browser.tabs.goBack抛出“没有历史记录” → execute catch → pause。当前实现将可正常关闭的笔记弹层返回完全依赖于浏览器Back，有些页面会话没有可用历史。日志不能证明历史缺失由哪种平台路由行为造成，也不需要猜测。

## 最小修改

- 保留正常Back；仅捕获精确的`Cannot find a next page in history.`错误。
- 若已在原搜索URL，只等待确认，不点击、不再Back。
- 否则再次确认当前URL对应原任务上一帖，只发送一次XHS_CLOSE_NOTE。
- content script检查平台提示、当前noteKey、唯一可见#noteContainer和其.note-detail-mask祖先；仅点击该mask直属.close-circle下可见、未禁用的.close。选择器来自历史真实脱敏page-overlay-with-feed.html，不使用通用取消、点赞、评论、收藏或关注控件。
- 关闭后沿用原poll('search')，严格确认原搜索URL和无笔记弹层。仍用正常卡片点击、ready与noteKey校验进入下一帖。无关闭入口、身份不符、平台验证、权限错误、真正错误搜索地址均停止并提示，不强跳URL、不刷新、不无限重试。
- 保留检查点、Continue、用户暂停/停止、每帖500、5帖、10分钟含暂停和原AI/缓存。没有修改serial.ts、adapter.ts、capture.ts或评论/回复去重。

文件：src/discovery/browser.ts；src/xhs/navigation.ts；src/xhs/session.ts（仅消息路由）；src/messaging/protocol.ts；entrypoints/xhs.content.ts；三个integration测试文件。

## 验证

修改前新增精确错误的导航回归失败，错误与用户日志一致；修改后通过。

新增13项：browser 6项（缺少历史正常进入B；权限、取消、验证、错误搜索、缺失控件）；DOM 6项（历史fixture真实关闭结构及缺失/隐藏/禁用/身份/平台保护）；生产集成1项（首帖真实模块500条采集、Mock AI分析、Back无历史、正常关闭、延迟DOM、自动第二帖，无PAUSE，500+1评论和501分析）。旧回归及数量断言保留。

独立工作树最终npm test/Vitest：33文件377项通过；npm run typecheck、npm run lint、npm run build:edge、npm run zip:edge、git diff --check全部PASS。依赖现有Rollup注释警告非阻塞。

主目录测试期间出现非本轮并发改动（评论总数解析/进度展示），一次ESLint读取到尚未使用的导入并失败。没有替其他任务修改文件；隔离后独立验证通过，不把混合目录的结果算成本轮交付。

F新版真实小红书：NOT VERIFIED。本轮用户日志是真实失败证据，历史真实fixture是结构证据，合成生产集成是回归证据，均不能替代新版已登录平台全流程验收。

## Git与包（隔离验证阶段，最终交付见下节）

为保留并发工作，新建工作树D:\AI-Toys\seak-lead-agent\.scratch\history-return，分支codex/history-return-fix，从5b731f0创建。本轮修改已从主目录按专属patch反向移除，其他并发修改保留；没有切换主目录分支、reset、clean或push。

独立树ZIP：D:\AI-Toys\seak-lead-agent\.scratch\history-return\.output\seeklead-agent-0.1.0-edge.zip。
同包复制至用户约定D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip。
SHA256：1f294c38df0bf2a195f5e45faf3a5e7c12b234b9f88e5765b0d1ecc465e64193。

主目录另有并发代码，本轮不覆盖其.output/edge-mv3目录。验收本修复请加载独立树.output/edge-mv3或解压上述ZIP，不要只重新加载主目录旧构建。重载后刷新小红书标签，启动新任务观察无历史时是否正常关闭并自动下一帖；遇平台验证立即停止。并发工作完成前不自动合并到主目录，主目录不能声明干净。

## 最终组合交付

并发工作随后完成为e90eca3，主目录恢复干净。本轮修复dfebad5已通过ad65700正常合并到codex/eric-development，无冲突，保留e90eca3的评论总数显示/分析前检查改动；没有重写或覆盖他人提交。

主目录组合版本重新运行：npm test/Vitest **33文件378/378通过**（独立修复377项，加上并发提交新增1项）；typecheck、lint、build:edge、zip:edge、git diff --check全部通过。最终包是主目录组合版本，取代上节隔离包。

- ZIP：D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip。
- 解压加载目录：D:\AI-Toys\seak-lead-agent\.output\edge-mv3。
- 最终SHA256：d9f63f1bcaf55137f4ee03a913664fa1a415f7b081cfa2d4a4592ef1aae1ac42。
- 新版真实小红书仍NOT VERIFIED，不将自动集成冒充平台验收。

现在可直接重新加载主目录新版edge-mv3并刷新小红书页面；无需使用隔离树。独立树保留作修复证据，未删除任何并发数据。

## 用户验收状态更新（2026-10-18）

用户已确认“开始新任务时安全暂停旧任务、保留历史线索，以及继续上次任务重新定位浏览器窗口”的相关缺陷修复并验收通过。历史线索不得因新任务启动或恢复流程而删除。
