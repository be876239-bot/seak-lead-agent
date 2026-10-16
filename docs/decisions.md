# 决策记录

## D014 2026-10-17 多帖完成检查点与继续恢复
- 以本轮用户要求取代D010的“500条即结束整个任务”：每帖上限仍500；处理完成后有下一帖则边界暂停，用户继续才推进，最后一帖收尾完成。
- Job.discovery可选post记录capturing/captured/completed及最多500个commentKeys。正常采集已落库才记captured；原AI分析成功才记completed；在下一次页面检查/导航前持久化完成，恢复不重采已完成快照。旧记录缺字段保守按未完成处理，不通过总数猜完成。
- 当前未完成继续当前帖；已采集继续分析；本帖已完成继续下一帖。停止、验证码/登录、总10分钟含暂停和页面匹配守卫保持；晚到进度绑定原索引，计数保留高水位。
- 不改评论发现/去重/回复/滚动、AI Prompt/分组/缓存。新增18项、总354通过；Edge真实页面可读但新版侧边栏流程未验收，用户选择先交付。详见 `discovery-resume-2026-10-17.md`。

## D013 2026-10-17 评论发现与累计的少量漏采修复
- 基线925ae86，312项原测试通过；审计后先补红测，限定评论容器，不改AI/产品/缓存/DB架构。
- MutationObserver使用已确认列表来源的addedNodes/removedNodes，兼容整个list-container替换；保留原换帖/平台守卫。不同弱节点碰撞加序号，同节点/强ID去重不变；空comment-视为无ID。完全重建的弱节点可能重复，明确标弱，不牺牲已证明不同的评论。
- 半屏步长，上限400px、不再120px最小跨屏；滚动和到底状态共用祖先。no_new需到底、无加载、15秒安静和连续4轮，新增/内容变化重置；ARIA加载只看DOM语义，不检查网络。500总条数、3分钟/200轮和任务10分钟保持。
- 包装根评论/回复入口改为所属wrapper定位；媒体仅评论自身content内占位，不扫描整页。新增24项、总336项通过；旧测试只补JSDOM滚动位置模型，原结果断言保留。无现网验证，见comment-recall-2026-10-17.md。

## D012 2026-10-16 正常卡片点击与原搜索页返回
- 审计基线34e2c38：原DiscoveryBrowser新建about:blank标签，再tabs.update目标URL；不走真实卡片入口，也不返回搜索页。用户报告该路径出现笔记不可浏览/扫码提示，但其平台原因不能由代码审计确定。
- 用户授权正常页面交互。改为复用sourceTabId，内容脚本按笔记ID重查当前可见section.note-item a[href]，优先cover，scrollIntoView后再验上下文并click()；不改变href/target、location/history、不创建任务标签。采集后tabs.goBack一次，核验原搜索地址及详情已关闭，再重新查下一张卡片。程序化click不伪装isTrusted，不承诺平台接受。
- 保存原搜索URL、search/opening/note/returning阶段、预期noteKey、已完成笔记；导航字段原子写入原jobs记录。继续时先核验实际页面与保存位置；旧直接URL任务保留数据但要求停止后新建。返回失败时不重跑已分析帖子。
- 卡片丢失、异常历史目标、30秒无导航、连续3次结构/脚本失败或权限问题暂停；加载期间仍检查风控。新增笔记不可浏览、扫码查看、非法消息、404提示识别；不匹配评论/正文引用。没有刷新或点击重试、URL兜底、新权限、私有API或反检测。
- 保留D011评论+回复增量采集/父子上下文、500总条数、5帖/10分钟含暂停、原AI Prompt/group-v2/缓存/脱敏/DB表版本。命中500即结束，不再展开或切页。
- 310项自动测试与本机合成浏览器两帖82条（2回复）闭环通过；MockAI不代表Lead质量。Edge已断开，用户明确暂无法连接，真实小红书验收阻塞。不能声称平台不会限制账号。

## D011 2026-10-16 用户授权：正常展开并增量采集评论回复
- 审计确认原adapter、parentKey、AI parent上下文和fixture已有回复支持；漏采主要因为采集器只滚动、不展开折叠回复，另有无平台ID父评论及父DOM虚拟移除时的关联缺口。
- 用户明确授权在主动采集期间正常点击“展开/查看更多回复”控件。本轮只使用历史真实fixture证实的.reply-container .show-more和严格文案白名单，禁止互动按钮、表单、导航链接、私有API、凭据读取和验证绕过。
- 总500条含一级+回复；每次一组，等待增量、短暂稳定后再继续，10秒无响应停止，单帖最多100次展开；继续继承原取消、时间、轮次、去重、缓存、脱敏和平台限制边界。
- 复用原parentKey与根评论DOM关系，禁止文本猜父子；无法确认关系则报错停止。平台不提供精确reply-to时仅记录根评论，不猜回复对象。无DB表或版本迁移，无AI Prompt/分组变化。
- 用户本轮选择先交付代码与步骤。Edge连接返回Debugger unattached，未执行真实展开/采集；自动测试与合成UI不当作真实小红书通过。

## D010 2026-10-16 用户授权：有界串行寻找客户任务
- 用户明确允许从当前小红书正常搜索结果进入相关公开笔记，正常导航、等待、滚动和只读采集；优先复用 searchSuggestions，不构造私有搜索接口。
- 默认最多5篇、每篇最多500条、总计10分钟（含暂停）；同一个前台任务标签串行复用，命中单帖500上限后整次任务结束。当前搜索结果页保留，不无限扩展结果、展开回复或后台定时运行。
- 复用既有captureNote/Session/IndexedDB/AI runner/批次/缓存/分组；jobs表增加可选任务元数据，无新数据库表或云服务。外部signal桥接既有分析取消锁，迟到结果受原提交守卫保护。
- 已识别的验证码/登录/风控、结构或权限异常立即暂停，不自动刷新或恢复；后台中断仅持久化暂停，用户手动继续须保留原截止时间并校验画像/模型、页面和笔记身份。
- D009的“仅当前笔记/禁止自动进入下一篇”在此范围被本次授权替代；其余凭据、平台限制绕过、互动、反检测等禁令继续保持。
- 本轮用户选择先交付代码与验收步骤；真实已登录小红书验收仍NOT VERIFIED。详见 `serial-discovery-2026-10-16.md`。

## D009 2026-10-16 用户授权：当前笔记滚动增量采集
- 本轮用户明确将“只分析DOM已加载评论”列为阻塞问题，授权点击开始后通过正常滚动触发当前笔记懒加载。因此仅撤销该范围内的自动滚动禁令；不扩展到私有接口、凭据、自动搜索/点击展开、社交互动或其他平台。
- 复用既有会话及分页，在GET_SNAPSHOT增加可选advance字段；content script仅在当前笔记内按已确认DOM祖先的实际overflow和尺寸选择滚动容器。后台循环取样并逐轮事务落库，再进入既有AI批次/缓存。弱身份的同一DOM节点复用序号，平台ID仍为主要去重依据。
- 500ms取样、每轮5次、连续4轮未新增停止；另有500条/3分钟/200轮上限及取消/错误。未新增只代表未能继续发现，不代表平台全量。明确末尾目前仅使用历史fixture证实的暂无评论标志，不伪造新选择器。
- Prompt、Lead分组、模型和缓存键均不改。自动化及合成浏览器结果与真实小红书验收严格分开，见incremental-capture-2026-10-16.md。

## D008 2026-10-16 接手修复：数据边界与结果提交
- 评论模型请求最终组装时显式提取 product/note/items，idMap 只留本地；模拟 few-shot 同样移除本地映射。产品来源、语义 DTO、修复请求和模型输出复用 redactText；昵称原文保留规则 D006 不变。
- 此次仅修复传输白名单和脱敏，分类系统指令、语义字段、规则及模型输出协议未改变；保留 comment-v2/profile-v2 和既有缓存，避免隐私修复导致全部历史结果重新计费。后续真正修改提示词语义仍必须升级版本。旧数据库不会在此轮批量迁移或删除。
- 取消/锁接管后的模型结果不得提交；结果写入与租约检查置于同一个 IndexedDB 事务，过期锁不可复活续租。供应商已回报的 token 仍记用量。
- Background 没有原生 DOMParser 时使用精确依赖 linkedom 0.18.13 的 worker 入口离线解析 HTML，保留静态优先与 Readability，不新增 offscreen 权限、不执行网页脚本。ISC 许可随 public/licenses/linkedom.txt 打包。
- 不新增 JEV、数值评分、自动搜索或其他平台。真实浏览器和模型质量验收仍需独立完成。
- 后续同轮增量：重试前校验画像/配置与 input-v1 请求摘要，校验失败或锁冲突不修改原批次；旧任务没有可验证摘要时引导重新读取笔记，保留已完成缓存。完整 AI 响应体受超时与取消控制，静态产品读取取消向后台传递；Lead 卡片增加理由、不确定点和人工主页跳转。合成卡片渲染不计入 T29/T30。

## D001 2026-10-15 百炼模型连通验证（第 0 步）
- `.env` 保存 `DASHSCOPE_API_KEY`（gitignore 排除，不入库、不进日志）。
- 实测 `POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，model=`qwen3.8-flash`，`response_format:{type:json_object}`、`enable_thinking:false`（HTTP 顶层参数）均被接受；返回标准 `usage.prompt_tokens/completion_tokens/total_tokens`。request_id 示例：chatcmpl-417c7092-9314-9cd7-a6a7-375b775454af。
- 注意：Git Bash 下 `curl -d` 内联 JSON 会被判 "Required body invalid"，须用 `--data-binary @file`；与 API 本身无关。

## D002 2026-10-15 验收浏览器对调：Edge 主验收、Chrome 冒烟
- 实测本机 browser-use 内置浏览器为 Qoder Electron（Chrome/150 核），不能加载 MV3 扩展，仅用于 T11 fixture 采集与解析器调试。
- 用户的小红书登录态在 Edge。经用户确认，真实扩展验收（T29）在 Edge 进行，Chrome 改为冒烟（T31 互换角色）。DEVELOPMENT.md 其余约束不变。

## D003 2026-10-15 范围以 DEVELOPMENT.md 为准
- README 宣传口径（搜索词翻笔记、JEV 初筛）超出 MVP 实现；经用户确认 MVP 按 DEVELOPMENT.md/TODO.md 范围开发，README 已改为与实现一致的 MVP 口径（T02）。

## D004 2026-10-15 pnpm override 固定 @vitejs/plugin-react 5.2.0
- wxt 0.21.4 解析到 vite 7.3.7，而模板 module-react 允许 plugin-react ^6（要求 vite ^8 的 `./internal` 子路径），`wxt prepare` 崩溃。5.2.0 同时兼容 vite ^4–^8，为最小改动方案。影响：仅构建工具链；升级 wxt/vite 时重新评估并移除该 override。

## D005 2026-10-15 模型输出 schema 使用 z.strictObject
- zod 4 的 z.object 默认剥离未知键；DEVELOPMENT.md 要求“未知字段拒绝”，DecisionSchema 与 ProductProfileSchema 改为 z.strictObject，其余持久化 schema 保持剥离语义。


## D006 2026-10-16 昵称保留原文不打码（用户指示）
- 用户明确要求导出与界面显示网友昵称原文（"脱敏昵称不要脱敏啊"）。session.ts 昵称仅做空白规整、不再 redactText；昵称/主页/属地仍绝不进入 AI DTO（白名单不变）。风险口径随 DEVELOPMENT.md 第 9 节修订：导出文件含原始昵称，数据由用户本地自担。旧库中已打码的昵称会在同笔记重新采集时覆盖为原文。

## D007 2026-10-16 分组规则降门槛 group-v2＋缓存与规则版本解耦（用户指示）
- 用户反馈“高意向/有需求分类不准、门槛太死”，指示降门槛并同意免费重算旧结果。
- group-v2：取消“高意向必须有当前评论自身证据”；solution_seeking 计入付费信号；adjacent/非需求方身份/free_only 由 review 放宽到 need；uncertainty 与判不了的字段仍进 review。RULE_VERSION=group-v2。
- 计费保护：缓存键组成固定使用 CACHE_RULE_VERSION=group-v1（分组规则不影响模型判断结果），Analysis 行仍记录真实 ruleVersion；规则升级不再触发付费缓存失效。
- 免费重算：buildLeadGroups 对 ruleVersion≠当前版本的行按当前规则重判展示分组，人工纠正优先；旧结果打开即新分组，零费用。
- 意向展示并为三档中文（意向本产品/意向该品类/无意向），intentTarget 存储与导出协议枚举不变；竞品徽章“并非本产品”保留。
- 同批修复小红书用户 ID 抓取：作者主页 href 剥离 `?xsec_token` 等查询参数后取路径段作 authorLocalKey，profileUrl 转为绝对 URL（相对链接此前无法通过 safeExternalUrl 渲染）。旧库数据需重新采集该笔记后刷新。
