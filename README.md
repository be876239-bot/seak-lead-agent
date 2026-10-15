# 觅客Agent（SeekLead Agent）

觅客Agent 是一个本地浏览器插件，帮你从小红书笔记的评论区里找客户。

贴上你的产品链接，插件读取网页并自动生成带证据的产品画像；你在浏览器里手动打开一篇相关小红书笔记并加载评论，插件读取**当前页已加载的评论**，先本地清洗、打码、去重，再用你自己的国内 AI Key 分析，输出“高意向 / 有需求 / 待确认 / 排除”四组线索。每条线索附评论原文、判断理由和证据，你点进原帖自己回复。

插件只读不写：不自动搜索、不自动滚动、不替你发私信，也不碰你的账号密码。所有业务数据保存在本机 IndexedDB，可随时导出或删除。

> 第一版（MVP）支持 Chrome / Edge，只分析已加载评论；自动搜索、抖音等平台为后续规划。

## 开发状态

当前处于 MVP 开发中，进度以 `TODO.md` 勾选为准。规范见 `DEVELOPMENT.md`，任务清单见 `TODO.md`，调研见 `觅客Agent-MVP技术方案.md`。

## 构建与加载（开发中，安装说明在 T32 定稿）

环境：Node v24.13.0、pnpm 10.33.0（实测版本）。

```bash
pnpm install     # 安装依赖
pnpm dev         # 开发模式
pnpm build       # 构建，产物在 .output/chrome-mv3/
pnpm zip         # 打包 zip
pnpm typecheck && pnpm lint && pnpm test
```

构建后在浏览器 `chrome://extensions`（或 Edge `edge://extensions`）开启开发者模式，加载 `.output/chrome-mv3/` 目录。
