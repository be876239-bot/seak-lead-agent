# 决策记录

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
