# 决策记录

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

