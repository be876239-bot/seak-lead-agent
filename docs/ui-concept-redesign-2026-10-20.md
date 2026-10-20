# 原始概念图驱动的 UI 重设计交付（2026-10-20）

## 基线与保护

- 主项目：D:\AI-Toys\seak-lead-agent。
- 分支：ui-port-20261019；HEAD：5b9480410a1a0d53576ccfc85ef59d049f03213f。
- 开始时已有 6 个已跟踪修改，以及旧交付报告、组件测试两个未跟踪文件；全部继承，没有 reset、clean、checkout、commit、push、merge。
- 本轮前的 11 个相关文件、Git diff 与状态快照保存于 `.scratch/ui-redesign-baseline-20261020/`；没有清理用户数据或参考仓库。
- 本轮没有修改采集、AI、任务引擎、消息协议、存储结构、权限或依赖。原独立 CurrentNote 未加入导航。

## 原始参考及分析

Git 对象中已存在 a08d54172f4b39834db98238bab9d93a56fd5efc。重新核对 show --stat、diff-tree：17 个新增文件，其中 5 张 PNG、5 个静态 HTML、5 个画布 HTML、README 与 canvas.json。完整树中的其他图片是应用图标；没有独立 JPG/WebP/GIF/SVG/Figma 文件。HTML 有内联 SVG 图标。

原始概念图均位于该提交的 `docs/design/ui/png/`，已逐张查看：

| 原始路径 | 用途 | 本轮采用 |
|---|---|---|
| docs/design/ui/png/00-in-browser.png | 浏览器与侧边栏整体 | 紧凑白色顶部、四栏导航、侧边栏密度 |
| docs/design/ui/png/01-products.png | 产品/画像/方向 | 当前产品边框与标记、身份区、字段网格、关键词标签 |
| docs/design/ui/png/02-hunt.png | 运行任务 | 深蓝摘要、大号真实进度、黄色进度条、独立部分采集提醒 |
| docs/design/ui/png/03-leads.png | 线索 | 分组标签、突出原文、卡片边框、操作区 |
| docs/design/ui/png/04-settings.png | 设置 | 分组卡片/分隔行、真实用量数字、独立数据管理 |

原图未重绘，精确 Git blob 副本：`D:\AI-Toys\seak-lead-agent\.scratch\ui-originals-a08d541\`。上一轮完整图库：`C:\Users\youyou\Documents\ChatGPT\觅客agent\artifacts\a08d541-ui-gallery\index.html`。

原始文件链接格式：`https://raw.githubusercontent.com/houchenfeng/seak-lead-agent/a08d54172f4b39834db98238bab9d93a56fd5efc/docs/design/ui/png/<文件名>.png`。

## 视觉规范与有意差异

- 背景 #F5F4ED、白卡片、主色 #3B5BC9、任务摘要 #30489E、强调 #FFC64F、提示文字 #8A6100；主正文 #20211F、次正文 #62645D、边框 #E3DED1。
- 本地字体 Noto Sans SC / Microsoft YaHei UI / Segoe UI / system-ui，不加载远程字体。主标题16px、正文13px、辅助11–12px；数字使用等宽数字；大进度40px。
- 卡片12px圆角、控件8px圆角，主要间距8–12px；34–40px操作高度。选中导航用黄色底线与字重，不只靠颜色。危险操作有明确文字与红色样式，焦点与减少动态偏好保留。
- 自然纵向滚动、自动换行与minmax网格，320px断点；不使用固定屏幕高度截掉内容。
- 保留现有业务语义，因此不照搬概念稿的数字意向分、批量勾选、同步飞书、已跑方向计数、未知连接状态绿灯、模拟评论注入、固定/关闭假按钮或模型全局切换。只展示已有真实数据。
- 产品的事实/推断/未知及证据、任务的完整性/暂停说明、线索的不确定点均保留，所以信息量比概念稿更大。当前产品仍用已有选择/展开机制，没有偷偷改变选中/展开行为。
- 设置继续提供真实可编辑控件与原来的保存、授权、连接测试；没有伪造“已连接”状态。Key处理代码未改。

## 修改文件

| 文件 | 修改 |
|---|---|
| entrypoints/sidepanel/App.tsx | 概念稿靶心品牌图形、四页导航，保持现有事件 |
| entrypoints/sidepanel/Products.tsx | 产品身份与当前标记、字段网格、可复制关键词标签、历史列表 |
| entrypoints/sidepanel/Discovery.tsx | 顺序设置区、前置任务摘要、真实数字/进度条、醒目控制、独立完整性提示 |
| entrypoints/sidepanel/DiscoveryPostResults.tsx | 单篇详情中的线索卡/证据共用样式 |
| entrypoints/sidepanel/Leads.tsx | 筛选面板、定性标签、突出评论原文、处理状态、证据与纠正操作 |
| entrypoints/sidepanel/Settings.tsx | 模型、用量、日志、保留期、数据管理、版本分组；用量为实际计数 |
| entrypoints/sidepanel/sidepanel.css | 整理为统一设计系统，替换之前叠加的样式规则 |
| src/ui/BrandMark.tsx | 轻量展示组件，图形参照原稿，无交互 |
| src/ui/LeadExplanation.tsx | 共用理由/不确定性样式，不改展示条件 |
| src/ui/CollectionProgress.tsx | 移除覆盖公共样式的内联颜色，字段与状态条件不改 |
| src/ui/OnboardingGuide.css | 引导卡片/步骤/按钮与视觉系统统一 |
| tests/fixtures/ui/sidepanel.ts | schema校验的合成产品、长回复、分析、笔记和任务，仅测试使用 |
| tests/unit/sidepanel-presentation.test.ts | 保留原3项并新增3项带数据实际组件回归 |
| docs/ui-concept-redesign-2026-10-20.md | 本报告 |

旧报告 docs/ui-reference-port-2026-10-20.md 未修改。

## 验证

- TypeScript：PASS。
- ESLint：PASS。
- 第一轮全量：43文件、509项、0失败。
- 最终全量：43文件、509项全部通过、0失败，120.97秒。
- Edge生产构建（npm run build:edge）：PASS。
- Edge ZIP（npm run zip:edge，含生产构建）：PASS。
- git diff --check：PASS；只存在LF/CRLF提示，不是空白错误。
- 压缩包CRC验证、12个条目逐字节匹配edge-mv3：PASS。
- AST对比本轮开始快照：8个组件内138处现有事件/值/勾选/禁用/引导绑定保持一致；新增progress.value仅用于展示已有完成数量，未加入任务控制逻辑。证据`.scratch/ui-redesign/binding-audit.json`。
- 新增3项：画像字段/未知信息/关键词复制；已保存线索的证据、父上下文、筛选、纠正入口及记录数不变；保存任务的进度、部分状态、暂停/继续/停止消息意图与索引保持。
- 初次新增任务UI测试失败源于测试替身未返回协议要求的requestId；修正替身的响应格式与跨消息对象复制后通过，未放宽协议或断言，未增加测试超时。

## Edge浏览器证据（合成环境）

使用现有实际App组件，仅在`.scratch`临时预览中替换browser与后台传输边界，数据来自tests/fixtures/ui。localhost源的IndexedDB与扩展源隔离；没有使用真实Key、调用模型、访问小红书或改变扩展历史数据。

- 320/380/480px三个iframe视口，含滚动条时可用宽度305/365/465px；产品、运行任务、长回复线索、设置均检查。测得各页scrollWidth等于clientWidth，没有横向溢出。
- 实际点击：展开画像、四页切换、任务暂停→继续、线索分组筛选（2条→1条）、纠正入口→取消、批量结果展开单篇详情、引导重启→暂停→恢复原步骤。
- 页面有实际组件与数据，无框架错误遮罩；预览控制台error/warn为空。
- 引导在嵌套iframe头部的点击出现一次工具定位deadline；读取发现按钮仍存在，改在同一个Edge的独立本地App页验证，成功启动/暂停/继续。没有修改应用引导逻辑掩盖工具问题。
- 截图：`.scratch/ui-redesign/{products,discovery,leads,settings,onboarding}.png`。产品图已在修正320px标签断行及短关键词换行后重新截图；任务/线索/设置图为最终组件布局。

### 原图与渲染对照

| 对照点 | 证据与结果 |
|---|---|
| 色彩/导航 | 五张原图的米白底、白顶栏、黄色下划线已采用；原模型状态胶囊无真实状态来源，不伪造 |
| 产品卡结构 | 01-products原图身份/字段/关键词；实际字段保留事实与未知、复制功能，紧凑分列；320px标签断行已修正 |
| 任务层级 | 02-hunt原图深蓝数字摘要；实际进度与控制在摘要内，部分提醒为独立黄条，详细采集信息移出蓝卡 |
| 线索结构 | 03-leads原图突出原文与意向；实际使用高意向/有需求文字标签，保留全部理由、父评论、证据，不使用数字分数 |
| 设置结构 | 04-settings原图卡片分组与用量；实际加入独立日志/版本分组，用量为真实计数，未知token继续诚实标注 |
| 适配/交互 | 3个窄宽度实际渲染与DOM尺寸证明无横溢；暂停/继续等点击验证只覆盖合成后台 |

## 未验证边界与人工验收

真实已安装Edge扩展侧边栏：待人工验收。F 真实小红书：NOT VERIFIED。

合成UI点击不代表真实任务、AI接口或平台兼容验收。仍需重新加载`.output/edge-mv3`，不要卸载扩展或清理数据，再检查已有画像/历史评论/线索/纠正的显示，实际任务启动/暂停/继续/停止、单帖重新采集/失败重试/重新分析、真实导出、模型连接检查与引导推进。遇平台验证按现有机制暂停。

## 安装包

- 路径：D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip
- 大小：391357字节。
- SHA-256：D306AAECA8CD65825CE6E9ED925BB7DF90906FB9F25A8B6A17A89ED809AE0D55。
- 解压加载目录：D:\AI-Toys\seak-lead-agent\.output\edge-mv3。

没有提交、推送、合并或发布；HEAD保持不变。工作区有意保持修改状态，原有未跟踪报告和测试均保留。

最终Git复核：分支与HEAD不变，10个已跟踪文件修改，5个未跟踪文件（含开始前已有2个）；已跟踪diff为413行新增、694行删除，包含继承的工作区修改，不等于本轮单独diff。没有commit/push/merge。
