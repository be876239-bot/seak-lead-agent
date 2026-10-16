# 多帖任务完成边界与继续恢复（2026-10-17）

基线：`codex/eric-development` / `d9a87a1`，初始工作区干净。本轮只修任务编排及其持久化/显示；评论解析、懒加载、回复展开、身份去重、AI Prompt、分组和缓存代码无变更。

## 审计与根因

链路：侧边栏 `DISCOVERY_START/CONTROL` → background 注册的 discovery/jobs → SerialDiscovery → DiscoveryBrowser 正常点击/ready → captureNote → saveCaptureDelta → 原 runCommentsJob → 返回搜索/下一帖。侧边栏通过 JOB_GET 读取持久化 Job；后台中断通过 markInterruptedOnRecovery 标为暂停，不自动恢复。

1. 旧 runner 只有任务 status/index，无法表达“采集已完成，分析尚未完成”。继续总会重入 process，再调用 captureNote；分析/页面检查导致暂停后会重新采集已完成的评论。
2. process 成功后，旧代码先 await guard，再 index++。guard 失败或此处暂停时，完成结果已保存，但索引仍指向上一帖，恢复会重复处理。新回归实际观测旧行为为 A、A、B，而期望 A、B。
3. 旧 500 条分支是结束整个任务而非完成当前帖后的可继续边界。按本轮用户要求调整为：本帖分析完成后，有下一帖则暂停；只有用户继续才导航。最后一帖则收尾完成。
4. 旧进度回调使用可变 task.index，迟到的上一帖回调可能写入下一帖计数。恢复期间较小进度也会降低 currentLeads，重启后重复累计。新增索引/完成阶段守卫及计数高水位。

以上为源码与自动回归确认的缺陷。没有取得用户原失败任务的暂停原因/运行日志，不能声称逐条证实了该真实会话的直接触发原因。数量与网页相等本身不作为完成证明；time_limit/round_limit、验证码和登录异常仍保留未完成状态。

## 修改与状态语义

| 文件 | 修改 |
| --- | --- |
| src/discovery/serial.ts | 持久化 post 阶段、完成后再推进索引、500 条帖间暂停、暂停/停止/截止时间守卫、迟到进度隔离 |
| src/discovery/jobs.ts | captureNote 正常返回并保存后提交 captured 检查点；继续使用本地指定 commentKeys 分析；分析成功提交 completed 检查点；同步完成数和 completedNoteKeys |
| src/domain/schemas.ts | 可选 discovery.post：stage + 最多500个 commentKeys；无新增表或迁移 |
| entrypoints/sidepanel/Discovery.tsx | 显示实际完成数及“继续下一篇/继续分析/最后收尾”；按钮仍只发送既有 CONTROL 消息 |
| tests/integration/discovery-boundary.test.ts | 14项定向状态机回归 |
| tests/integration/discovery-e2e.test.ts | 新增4种真实生产模块的合成恢复流程，保留原80条评论/80条分析断言 |
| tests/integration/discovery.test.ts | 将旧500条“整个任务完成”状态断言更新为本轮授权的“边界暂停”；数量及单次不继续导航断言不变 |

`discovery.post.stage`：
- capturing（旧记录缺失也按未完成）：继续当前帖采集。
- captured：当前帖正常结束采集且已落库；保存该批 commentKeys。继续时校验页面，读取本地笔记和这些评论，完成原分析，不重新滚动/采集。缺少快照时明确报错暂停，不猜测或悄悄重采。
- completed：当前帖采集与分析均已完成；先保存检查点，再推进 index。若在此暂停，继续跳过当前帖处理，按原导航流程返回搜索并打开下一篇。index 等于队列长度时只执行收尾。

index 是当前处理/待处理位置；在 completed 边界尚未推进时，completedItems 为 index+1，completedNoteKeys 同步包含本帖。恢复后的下一篇仍需 navigate → ready → guard，URL与目标 noteKey 校验沿用 DiscoveryBrowser。最多5帖、每帖500、整个任务10分钟含暂停保持；停止不会导航到下一篇。

旧记录兼容读取，无需迁移；但旧版本没有记录的完成阶段不能通过评论数量补猜。验收新版行为应重新加载扩展后启动新任务。旧任务继续可能需要再次确认当前帖采集；已有缓存规则不变。

## 验证

修改生产代码前运行首批7项回归：4失败、3通过。失败包括完成后 guard 暂停重复 A、恢复后重复 A、500边界提前 completed、边界 stop 无法生效。修复后全部通过。

新增18项：14项状态机测试 + 原生产链路测试新增4种参数场景。覆盖：
- A/E：第1或第2帖未完成暂停，继续仍是该帖。
- B/D：已完成后暂停及 JSON/JobSchema/IndexedDB/后台重载，继续下一帖。
- C：A完成→正常Back/卡片点击→等待B就绪→B采集；不会在ready前处理。
- F：最后一帖完成只收尾，没有越界第三帖。
- G：边界停止不再导航；既有集成还覆盖继续等待旧导航时再次停止。
- H：未完成的验证码/登录/页面异常不标完成；恢复重新检查。
- 已采集待分析的 live/restored 两种情况均不重启采集会话；每帖仅一次 XHS_START_SESSION。
- 检查点落库失败、10分钟超时、迟到进度、恢复计数。

最终：`npm test`（Vitest）32文件 **354/354通过**；`npm run typecheck`、`npm run lint`、`npm run build`、`npm run zip:edge`、`git diff --check`均通过。依赖现有 Rollup 注释位置警告不影响构建；没有禁用检查。

| 证据层 | 状态 |
| --- | --- |
| A 源码状态机 | PASS |
| B 单元/定向回归 | PASS |
| C fixture | PASS，现有评论数量断言保持 |
| D 自动集成 | PASS，真实生产模块+合成DOM+fake IndexedDB+Mock AI |
| E 浏览器 | PARTIAL：Edge现有小红书笔记能读取；未验收新版扩展流程 |
| F 真实小红书 | NOT VERIFIED |

本轮 Browser Use 已成功读取当前笔记，不能再报告 Debugger unattached。Edge内部扩展页无法绑定，工具没有侧边栏操作入口，未能重新加载并运行新版扩展。用户明确选择“暂不方便，先交付并标注真实流程未验证”。只进行了页面读取，未触发真实采集/AI/切帖测试，不将其算成流程通过，也没有绕过平台验证。

## Edge交付及待验收

- ZIP：`D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip`
- 解压目录：`D:\AI-Toys\seak-lead-agent\.output\edge-mv3`
- ZIP 363741字节，SHA256：`7f7eef972d4c7b7b8a944809f54ae3519258f95a6e5fd8c5705d0d2a01b1fbf2`。

手工步骤：重新加载新版扩展并刷新笔记；返回已登录搜索页，从侧边栏启动新任务。采集中暂停再继续，应留在原帖；本帖处理完成的暂停边界再继续，应正常返回并点击下一篇，等待其加载才采集。若只有采集完成、AI未完成，应显示“评论已保存，继续将完成本帖分析”，先完成分析再切帖。测试最后一帖与停止，不应打开额外帖子。出现验证/登录/异常立即停止该项验收并记 PLATFORM_LIMITATION，不处理或绕过验证。本轮不修改采集算法来制造完成条件，也不把达到总数等同“全部采集”。
