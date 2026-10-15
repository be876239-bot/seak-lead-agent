# T11 证据目录

## 已采集（真实、已登录、已脱敏 fixture）

采集时间：2026-10-15。采集环境：Qoder 内置 Chromium 浏览器，用户本人小红书账号登录态（会话此前已通过扫码登录建立，本次无需重新扫码，故无登录二维码截图）。

| fixture | 页面类型 | 依据 |
|---|---|---|
| tests/fixtures/xhs/note-detail-expanded.html | 详情弹层，已手动展开 3 组子回复 | 10 父评论 + 18 子评论，5 个未点开的 .show-more |
| tests/fixtures/xhs/note-detail-collapsed.html | 详情弹层默认态 | 10 父评论 + 8 预载子评论，7 个 .show-more |
| tests/fixtures/xhs/note-detail-no-comments.html | 无评论笔记 | .no-comments 存在，0 条评论 |
| tests/fixtures/xhs/page-overlay-with-feed.html | 弹层 + 背后 30 张信息流卡片 | X01 隔离回归 |
| tests/fixtures/xhs/feed-only.html | 纯信息流（无弹层） | detectPage→unsupported |
| tests/fixtures/xhs/error-page-404.html | 无效笔记 404 | 异常页不虚构评论 |

每个选择器的登记与预期数量见 `tests/fixtures/xhs/meta.json`。

## 产品页真实证据（T07–T09）

- tests/fixtures/products/real-app-shell-competition.html：2026-10-15 用 curl 从真实示例产品 URL（技术方案 B01 的竞赛题库站，https，公开页面）抓取的静态 HTML。内容为 hash-route SPA 外壳（717 字节，仅标题与加载占位），无个人信息、无 Cookie。回归测试断言 extractStatic 提取真实标题并判定需渲染兜底，见 tests/unit/product-static.test.ts。
- tests/fixtures/products/static-info.html / app-shell.html：为单元覆盖构造的合成页（JSON-LD 价格、截断、空壳等分支），非真实页面抓取，已在测试中注明用途。
- 真实产品页的渲染兜底读取（临时标签 + executeScript）与画像生成结果属浏览器环境行为，归 T29 实测取证。

## 原始未脱敏 DOM

`docs/evidence/raw/` 下的 `.html` 为脱敏前的中间快照，已列入 .gitignore，仅本机保留，到期清理（见 T26 保留期）。真实未脱敏数据不进入仓库、不进入 AI DTO、不进入导出。

## 匿名化方法

浏览器内克隆 DOM 后：用户/笔记/评论 ID 映射为 anonuserN / anonnoteN / comment-0001…，昵称与回复对象名替换，剥离 xsec_token 等全部跟踪参数与签名图片 URL，script/style 移除，文本跑联系方式正则。同一 ID 在同一 fixture 内映射一致，可测试父子作者区分与去重（X02/X04）。

## 待补证据（不阻塞 T12）

- 虚拟列表滚动移除前文（X03）：需要真实滚动会话验证，归入 T14/T29。
- 风控验证码遮挡页（X05）：不主动触发风控，等真实使用时机出现时补充截图证据；当前 detectBlock 仅能按登录弹窗/404 特征实现，标注未完全验证。
