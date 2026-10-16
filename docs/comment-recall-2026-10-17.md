# 少量评论漏采修复：审计、回归与交付

日期：2026-10-17。项目D:\AI-Toys\seak-lead-agent，分支codex/eric-development。起始HEAD 925ae86，起始工作区干净。范围仅评论发现、解析、累计与停止条件。

## 结论

已找到并修复可由生产模块组合测试复现的丢失路径，包括短暂节点/列表替换、弱身份误合并、过大的滚动步长、过早空闲停止、包装后的回复入口和图片正文占位。它们解释了代码为何可能只漏几条；**尚不能断言用户那篇真实笔记的每一条漏采都由这些原因造成**，没有拿到可操作的新版真实页面逐条对照。

最终31文件336项自动测试通过（基线30文件312项，新增24项）。typecheck、lint、build、Edge ZIP及git diff --check通过。真实Edge绑定返回Debugger unattached，用户明确选择先交付，真实验收NOT VERIFIED。没有遭遇/处理平台验证码，不能写成本轮PLATFORM_LIMITATION，也不能称新版现网已解决或评论已采全。

## 全链路审计（A–E）

| 环节 | 已确认行为/缺口 | 修复或结论 |
| --- | --- | --- |
| 页面/容器 | SEL限定noteContainer→comments-el→list-container | 保留隔离，不扫描整页文本；Observer仍观察页面用于原平台/换帖守卫，解析范围严格收窄 |
| A 滚动间隙 | 原步长75%视口、最少120px，窄视口可一次跨过整屏 | 改最多半屏、上限400px、下限1px；回归用实际步长决定中间窗口，旧策略会漏21–24，新策略保留1–50 |
| B 延迟与停止 | 原每轮5×500ms、连续4轮无新增就停，约10秒；不看底部/加载/DOM变化 | 保留采样，增加atBottom/activityVersion/loadingComments；须到底、无回复或标准ARIA加载、持续15秒安静且连续4轮无新增才no_new；内容变化/新增重置；同内容重渲染不无限重置 |
| B 滚动祖先 | 状态新增逻辑若选择内层短容器，会与实际滚动的外层不一致（实现中补测复现） | 状态和滚动共用同一容器查找，优先实际有溢出的已确认祖先，再考虑不足一屏容器 |
| 虚拟列表 | 原Observer微任务只重扫当前DOM；同一JS任务中插入/移除或连续替换的中间节点不在最终DOM | 使用MutationRecord的addedNodes/removedNodes；先确认记录来自会话已知列表/评论区，列表整体替换仅解析其中的list-container子树；提取后立即加入已脱敏会话buffer，下一快照await增量落库，不依赖节点继续存在 |
| C 去重 | 强ID优先；无ID时作者+正文+时间+父键会把不同节点的相同短评论合并 | 强键和全局identity/cache函数不变；会话为不同弱节点分配碰撞后缀，同一节点复用序号；同节点重复扫描、移除再插入不重复 |
| C 空ID | id=comment-被当作elementId，三个同文弱节点可能共用ordinal，仅存两条 | 空后缀当无ID，按节点弱身份分开；新增红测3→2，修复后3条 |
| D 解析 | 925ae86已不要求一级评论直接隶属parent，故普通多包装一级评论不是本轮新增根因；展开入口仍只查直接parent，根评论定位也只查直接子节点 | 继续限定列表，按所属parent-wrapper找根评论；包装后的回复可展开且parentKey不串。作者/正文限定属于当前comment-item，避免借用嵌套回复字段 |
| D 非文本/缺字段 | 缺作者/日期本就保留；图片如果在.content内但不在.note-text内会得到空文本被跳过 | 只在该评论自身.content内检查媒体并保留[non-text-comment]，无OCR/下载；真正空骨架不伪造，后续填充仍可采到 |
| E 异步与落库 | capture drain→await onDelta→found累计→下一滚动；Repository原事务校验signal与job状态 | 未发现需要重写的Promise/IndexedDB竞态；用回归验证保存Promise完成前不滚动、DOM移除不影响已提取值；原取消/迟到禁写守卫保留 |
| 回复与AI | parentKey→本地父评论补查→既有AI DTO/批次/缓存 | 不改AI Prompt、分组、产品逻辑或缓存规则；原父子/AI上下文、500条、10分钟/暂停停止测试继续运行 |

网络迹象只使用评论区标准aria-busy/role=progressbar、内容变化和最近新增，不读取请求、Cookie、token或私有API。它不能保证覆盖现网所有加载指示器。单帖3分钟/200轮、一级+回复总500、寻找任务总10分钟、取消/暂停/平台异常仍有效；不是无限等待。没有新增回看点击或扩大自动浏览范围。

## 修改文件

| 文件 | 作用 |
| --- | --- |
| src/xhs/adapter.ts | 可验证子树解析、字段归属、包装根评论/展开入口、媒体占位、空ID处理 |
| src/xhs/session.ts | MutationRecord累计、弱节点碰撞区分、半屏滚动、统一祖先、状态元数据 |
| src/xhs/capture.ts | 利用底部/内容版本/加载状态及15秒安静期收尾 |
| src/messaging/protocol.ts | 快照新增可选activityVersion/atBottom/loadingComments，仅采集消息元数据 |
| src/domain/limits.ts | 新增captureQuietMs=15000，其他安全上限不变 |
| tests/integration/xhs-recall.test.ts | 新增24项回归，生产session/capture→真实Repository→fake-indexeddb |
| tests/integration/xhs-incremental.test.ts | 滚动替身补真实scrollTop推进/边界夹紧，原断言不变 |
| tests/integration/xhs-replies.test.ts | 同上，避免JSDOM永远scrollTop=0却断言已到底 |
| tests/integration/discovery-e2e.test.ts | 同上，模拟1000px滚动高度/500px视口，原两帖80条、导航、缓存、恢复断言不变 |
| README/DEVELOPMENT/TODO/decisions/test-report/本报告 | 同步最新停止条件、证据及限制 |

IndexedDB无表/版本迁移；CommentSchema不变；既有一级/回复记录可读。AI、analysis、privacy、product、classification、identity、storage、锁文件和权限配置与基线无差异。弱节点后缀只影响确实冲突的采集身份，不改变缓存判定规则。

## 红→绿证据与测试

首批14项在未修改实现时8项失败：12秒延迟、同作者同文不同节点、瞬时节点、瞬时窗口、包装回复展开、图片、窄视口步长、20秒加载。随后列表整体替换补测旧路径41/50失败；内层短容器补测（开发中的状态路径）错误报告已到底；空comment-补测2/3失败。均先看见失败再修复；共11个红测，不把预防性通过用例说成红测。

新增24项覆盖：

1. 1–20→15–35→30–50重叠窗口精确保留1–50；1秒延迟；12秒延迟。
2. 无ID同作者同文同时间保留两条；同节点重复取样不膨胀。
3. 同任务内插入又移除；列表内容连续替换；整个list-container连续替换，中间评论进入DB。
4. 两组包装父评论各自回复不串；包装展开控件仍加载并保存回复。
5. 图片/表情非文本占位；缺作者/时间与延迟文本骨架。
6. 窄视口半屏限制；按实际步长模拟跨过21–24的漏采；列表外推荐不采。
7. 20秒aria-busy加载；14秒DOM变化重置安静期、22秒新评论；busy不消失也受3分钟上限；未到底不误报no_new但200轮终止；内层短容器不冒充外层到底。
8. 落库Promise先完成再滚动；验证出现即停止禁写；同无ID节点移除再插入不重复；空ID的三条相同评论不合并。

没有把旧期望26改成28或降低数量断言。旧JSDOM替身仅修正此前未模拟的原生滚动位置；原40/80/500、回复父键、取消和恢复断言保留。相同内容重渲染可正常收尾，避免因DOM重绘拖到上限。

最终命令：npm test（Vitest，31文件336项，11.61秒）；npm run typecheck；npm run lint；npm run build；npm run zip:edge；git diff --check均退出0。Rollup有既有Zod注释标记非阻塞警告，未禁用检查或测试。

## 验收分层

| 层级 | 状态 | 实际证据 |
| --- | --- | --- |
| A 源码 | PASS | 上述链路审计及基线diff |
| B 单元测试 | PASS | 全量中的原解析/身份/缓存等测试通过 |
| C fixture | PASS（离线） | 历史脱敏fixture回归，新增结构为明确合成数据；没有新增现网快照 |
| D 自动集成 | PASS | 新24项、原回复/懒加载/串行AI组合均通过；fake-indexeddb不是Edge用户库 |
| E 浏览器 | NOT VERIFIED | 本轮未完成新版浏览器执行，不复用上一轮截图当证据 |
| F 真实小红书 | NOT VERIFIED | 标签发现后绑定超时，恢复文档再绑定返回Debugger unattached；用户暂无法准备，先交付 |

未测量真实发现率、误采率或模型质量；不提供百分比，不承诺全量或账号绝对安全。平台限制状态没有被绕过。

## Edge交付与下一次真实验收

ZIP：D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip，363147字节。

SHA256：9112af34dbd3a802cdef0e9a9e72762c3c5a58e34adf407e7e4dcd7244facf49。

11项逐字节匹配edge-mv3构建，未包含.env/tests/eval/node_modules/.scratch，Key格式扫描0命中（不代表全面秘密审计）。权限未增。Chrome目录已build，Chrome ZIP仍为旧包，使用本次Edge包。

真实验收：重新加载.output/edge-mv3并刷新已登录笔记；选评论较多的公开帖子，记录初始已加载ID集合与一级/回复数量，主动开始采集、不手动助载；观察小步滚动、延迟、回复和停止状态，再将真实可见遗漏逐条按平台ID与本地导出比对，不拿页面“总评论数”直接当可访问数量。测试取消，确认后续无写入。Key只由用户本地配置，不提供给Codex/ChatGPT。验证码/扫码/登录/风控或页面异常立即停止该项并记录PLATFORM_LIMITATION，不刷新试探或规避。

## 仍存在的限制

- 没有新版真实小红书验证，不能确认用户原问题在现网消失；网络延迟超过安静期仍可能漏，时间/数量上限意味着只保证有界采集。
- 无平台ID、相同公开字段且DOM节点完全重建时，无法同时证明“新评论”与“旧评论重渲染”。本轮保留不同弱节点以避免误杀，同节点/强ID去重仍稳定；此类完全重建的弱评论可能重复，不能声称零重复。未用作者+文本强行合并；总500仍限制累计。
- MutationRecord保留节点引用，不保留每次DOM属性/文本的历史副本。若同一节点在回调前被原地改写多次，无法还原已覆盖的旧内容；没有用私有接口弥补。
- 图片/表情只保存占位，没有OCR/图像语义，纯空骨架不伪造评论；未知平台结构/加载指示器仍需真实fixture补证。
