# D015 连续多帖任务（2026-10-17）

基线 a891a09 / codex/eric-development，工作区初始干净。用户确认上一版“暂停→继续→下一篇”已人工验收；这是用户提供的上一版证据，不代表本轮连续任务已经真实验收。

## 审计与修改

limits.ts 的 maxSessionComments=500，由单帖 captureNote/session 限制，包含一级评论和回复。discovery 的 comments 是跨帖累计，任务另有最多5帖、10分钟含暂停的限制。500不是整个任务上限。

普通帖子原本已经自动串行推进；serial.ts 额外在本帖分析完成、currentComments>=500且还有下一帖时调用pause，是本轮要移除的产品行为。仅修改该生产文件：删除此分支，将原推进代码提取为advanceToNextPost()。

正常链路：采集并保存→captured检查点→原AI分析→completed检查点持久化→advanceToNextPost递增索引并持久化→原guard/navigate/ready/guard→下一帖。最后一帖只返回搜索收尾并completed，不导航到不存在的帖子。完成检查点写入失败或用户停止时不能继续导航。

Pause/Resume保持：未采完继续原帖；采集完成继续本地快照分析；本帖完成继续下一帖；最后一帖完成只收尾。只有用户暂停或平台/页面/其他需人工处理的异常暂停；原停止及10分钟截止保护不变。后台重启仍须用户明确继续，不擅自恢复已中断任务。

UI无需改按钮逻辑：已有组件按running/paused控制暂停和继续，显示当前index+1/total及阶段。正常完成不再写paused，因此不会出现中间“继续”提示。评论解析、召回、回复、去重、AI、产品、搜索方向、缓存、消息协议和DB结构均无变更。

## 测试证据

新增 discovery-continuous.test.ts 6项，修改前5失败/1通过，修改后6通过：40或500条的三帖无Continue连续完成（且持久化状态无paused）；第二帖登录/扫码/CAPTCHA各自暂停并不打开第三帖；完成检查点落库等待期间不导航。

现有 discovery-boundary.test.ts 保留未完成暂停/继续、完成后用户主动暂停/继续、分析快照恢复、最后一帖、迟到progress、持久化失败、超时等回归。原依赖自动500边界的停止/超时测试改为明确调用用户stop/pause，仍验证原安全性质。

discovery.test.ts 中两条旧“500即暂停/不返回”的测试按本轮明确需求更新为5帖可连续完成、总2500且最终只收尾一次。不是放宽单帖500条；原评论采集及回复上限、评论数量断言未改。

A/B/F：新增连续三帖测试；C/D/G：既有boundary测试；E：新增第二帖平台异常测试；H：既有生产handlers/IndexedDB/后台重载集成测试（未改，全部通过）。

- npm test / Vitest：33文件，360/360通过（新增6项）。
- npm run typecheck、npm run lint、npm run build、npm run zip:edge、git diff --check：PASS。
- 现有依赖Rollup注释警告仍为非阻塞，无检查被禁用。
- F真实小红书：NOT VERIFIED，本轮未运行真实平台流程；自动集成使用合成DOM和Mock AI。

## 交付与真实验收

新版ZIP：D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip。
重新加载.output/edge-mv3并刷新小红书页面，从搜索结果启动新任务。观察第1→2→3帖自动推进，无需继续；采集中主动暂停应停在当前帖，继续恢复；完成后主动暂停应从下一帖继续；停止后不得继续导航。遇平台验证立即暂停，不绕过。未完成这些检查前不能把本轮标为真实通过。
