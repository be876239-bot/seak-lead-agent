# 第三方来源与许可证声明

核对日期：2026-10-15。commit 通过 GitHub API 在当日 HEAD 固定。

## 作为依赖安装

| 库 | 仓库 | License | 固定 commit | 用途 |
|---|---|---|---|---|
| WXT | wxt-dev/wxt | MIT | f7786beb46f6c4f894c6e3d70027d2f7caf1f8b6 | 插件工程、入口与构建（官方 react-ts 模板脚手架） |
| @mozilla/readability | mozilla/readability | Apache-2.0 | ab4027a8b37669745016869a37a504727992b2ba | 产品页正文抽取（克隆 DOM 上运行） |
| Dexie | dexie/Dexie.js | Apache-2.0 | ddb6cb94a156837deea8bcef646cce0d5c8327c7 | IndexedDB 仓储与事务 |
| Zod | colinhacks/zod | MIT | 680d19f7d1e042e55934209caeb79bc843b94f44 | schema 单一事实来源与输出校验 |
| Papa Parse | mwatson/papa-parse | MIT | 安装时以 npm lockfile 版本为准 | CSV 导出转义 |

## 局部参考/适配（MIT，复制时保留声明）

| 来源 | 固定 commit | 拟复用文件 | 复用方式 | 明确不迁入 |
|---|---|---|---|---|
| nideaon/xhs-comment-analyzer | ca6303d6a300b9fa546236bcd08bd2d3a6041bb8 | src/scraper/comment_scraper.py、src/scraper/models.py | 仅参考其 DOM 解析与字段设计，选择器以本项目 T11 真实 fixture 复核后改写为 TS；若最终仅借鉴思路未复制代码片段，登记为“思路参考” | browser.py 的 Playwright/Cookie 流程、词典、反检测、run.py |
| SarmadSalee/LeadEngine | 8b87473e2a5d067bf1dd0073acf85c8b7e099b59 | packages/ai/src/openai-compatible.ts | 参考其薄 HTTP 客户端形态；本项目自行实现含 Zod 校验与错误脱敏的百炼适配器 | lead-scoring.ts（商家评分，非购买意向）、monorepo 其余部分 |

## 仅功能/交互参考，未查到许可证，不复制任何代码

| 仓库 | HEAD commit | 说明 |
|---|---|---|
| antonia-sz/xhs_comment_insight | 5ae4376e7029706a17b2342669600e84664f2fe3 | 侧边栏交互参考；LICENSE 字段为 NONE |
| yyst73Serendipity/xhs-comment-saver | cd9b2404306436815a488db22bbd85eab967e87d | 去重与管理流程参考；LICENSE 字段为 NONE |

## 决策

- 无许可证代码一律不进入项目（上表两仓库）。
- 两个 MIT 候选的最终复用形态（复制适配 vs 思路参考）在完成 T12/T15 时在 `docs/decisions.md` 记录，含具体源文件与改动。
- 未执行任何第三方仓库脚本。
