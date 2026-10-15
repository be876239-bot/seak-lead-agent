# 觅客Agent：本地插件 MVP 技术方案

更新：2026-10-15。状态：技术设计建议，未实现，未在真实小红书页面验证。

## 1. 已确认范围

- 自用 Chrome / Edge 插件，使用自己的国内 AI API Key。
- 用户提供产品 URL，插件自动理解产品；无需先填写产品画像问卷。
- 用户手动打开小红书笔记、滚动和展开评论，点击插件分析当前页已经加载的评论。
- 数据本地保存，打码后的分析内容发送至用户选择的 AI 服务。
- 优先复用 GitHub 已有实现和成熟库，新增代码集中在产品理解、需求匹配、购买意向判断。
- 本次不实现自动搜索和翻页、激活码、支付、套餐、业务服务器、云同步、自动互动。

## 2. GitHub 复用优先级

已读取下列项目的仓库信息及所列关键代码；这些检查不代表当前小红书可用性验证。复用时固定 commit、保留许可证和来源记录。

| 项目 | 已查实现 | 判断 |
|---|---|---|
| [antonia-sz/xhs_comment_insight](https://github.com/antonia-sz/xhs_comment_insight) | content.js、manifest.json：MV3、侧边栏、DOM 评论提取；README 描述 DeepSeek 分析 | 交互最接近。未发现明确许可证，不直接复制或 fork 为分发底座；解析包含宽泛匹配、按位置排除正文、正文日志，不能照搬 |
| [yyst73Serendipity/xhs-comment-saver](https://github.com/yyst73Serendipity/xhs-comment-saver) | README、目录、仓库元数据：评论收藏、SPA 适配、API Key 配置、本地管理 | 参考去重和交互；未发现明确许可证，暂不纳入可复制代码 |
| [nideaon/xhs-comment-analyzer](https://github.com/nideaon/xhs-comment-analyzer) | MIT；src/scraper/comment_scraper.py、models.py、pyproject.toml | 可选取 DOM 解析和字段设计适配为 TS。Python/Playwright 整体、Cookie 管理、反检测和自动抓取流程不引入。选择器必须用真实页面复核 |
| [SarmadSalee/LeadEngine](https://github.com/SarmadSalee/LeadEngine) | MIT；packages/ai/src/openai-compatible.ts、lead-scoring.ts、CSV 导出入口 | 可借用小型 API 适配器并增加 Zod 校验、供应商参数、错误脱敏；其评分基于商家网站/电话/评论量，不是购买意向，不能复用评分逻辑 |
| [mozilla/readability](https://github.com/mozilla/readability) | Apache-2.0；正文抽取库 | 复用正文抽取，处理克隆 DOM；营销首页容易被正文算法漏掉，必须同时保留标题、价格卡片、功能列表、CTA 和结构化元数据 |
| [wxt-dev/wxt](https://github.com/wxt-dev/wxt) | MIT | 复用插件工程、入口和构建能力 |
| [dexie/Dexie.js](https://github.com/dexie/Dexie.js) / [colinhacks/zod](https://github.com/colinhacks/zod) | Apache-2.0 / MIT | 本地数据库、结构化输出校验 |

结论：目前没有验证过的、许可证清晰且可直接整体复用的完整匹配项目。采用成熟插件框架并局部复用，比迁入一整套 Python 爬虫或 CRM 更适合本 MVP。仓库热度和 README 宣称不作为成熟度证明。

## 3. Jev 与国内替代路线

Jev 是 TypeSafe 的 System One 判断模型，提供 Choice、Score、Noul 等结构化判断。它不是 Jina，也不是“意向识别”的通用名称。官方文档没有为本方案提供已验证的国内服务保障和小红书中文效果，因此不作为 MVP 必需依赖。

| 方案 | 能力与接入 | MVP 决策 |
|---|---|---|
| 阿里云百炼 Qwen Plus | 国内区域、中文通用理解、结构化输出；同一模型可生成产品画像和识别意向 | 默认质量基线，用非思考模式；固定可用快照、记录模型版本 |
| DeepSeek 官方 API | JSON / 结构化输出能力；可完成同样的分类与解释任务 | 作为国内对照候选，先跑同一评测集，不默认双模型重复调用 |
| 火山方舟豆包 | 国内 API、结构化输出；不同模型支持范围需按接口核对 | 有现成 Key 时的候选，首版不同时接三个供应商 |
| 腾讯云 ADP 意图识别节点 | 已封装大模型单选/多选意图路由 | 功能相似，但引入工作流平台，对自用插件偏重 |
| 硅基流动 Qwen3 Reranker / BGE Reranker | 国内重排 API，判断 query 与评论的相关性 | 可选第二阶段优化；相关性分数不能当购买概率 |
| TypeSafe Jev | 快速结构化判断，返回概率/置信信息 | 保留适配接口；中文质量、网络和计费实测后再决定 |

推荐首版：本地去重与清洗 → 单次 LLM 批量判断。当前页几十条评论，没有证据表明额外加一个付费初筛模型会更便宜或更准确。后续在保留正样本召回率的前提下，比较增加初筛前后的延迟、总费用和误删率。

普通 LLM 输出的 confidence 和 0–100 分是启发式结果，不是经过校准的成交概率。中文“最好”不能靠厂商介绍确定，需要同一批业务样本比较。

## 4. 产品 URL 自动识别流程

1. 用户粘贴公开产品 URL，点击“识别产品”。只允许 HTTP(S)，拒绝 localhost、私有网络和带凭据 URL。
2. 按需请求该产品域名权限；先抓 HTML，提取 title、description、OpenGraph、JSON-LD Product/Offer、标题、功能区、价格和购买入口文本。禁止读取整个网页脚本或表单值。
3. 正文为空、只有应用外壳或关键信息不足时，自动打开产品页标签并等待渲染，在授权范围内提取可见 DOM。保留 #home 等 hash 路由。设置超时和字数上限，不要求用户重新手写介绍。
4. 仍缺少销售信息时，只沿当前页实际存在的同域“产品/功能/价格”链接补读，最多 2 页；不提交表单、不绑定邀请码、不越过登录。
5. 模型生成 ProductProfile。每个事实带来源 URL、原文片段；区分明确事实、推断和未知。价格没找到就 null，不能猜。
6. 自动生成目标需求、购买信号、排除需求、搜索建议。画像可查看和修改，但不要求用户先作答。读取失败时保留重试/可选粘贴兜底，不能用域名猜产品。

权限取舍：原 PRD 禁止 scripting，但通用产品页动态读取需要按需脚本执行。建议为产品读取放开 scripting，仅在用户主动识别且已授权的域名运行打包的只读提取脚本；小红书使用静态声明的 content script。这个调整不引入远程执行代码。

### 示例网站自动生成的画像

来源：[示例产品首页](https://competition.bertrammmmm.top/#home)，本次已通过渲染页面读取。

- 产品类别：浙江省大学生网络与信息安全竞赛网络安全知识挑战赛备考练习网站。
- 已见功能：历年真题题库、免费测试赛、按知识点练习、学校竞争力分析、限时挑战赛入口。
- 页面显示：8 个已上线题库包、累计 1091 道真题；12 域 59 个核心知识点。这些数字应存抓取日期，不写死。
- 解锁方式：邀请码解锁题库，页面说明绑定设备及同步答题数据。
- 潜在使用者（推断）：准备参加对应竞赛、需要真题或知识点练习的学生。
- 价格、邀请码购买渠道：当前读取内容未确认，保持未知。
- 不应推断：官方授权、所有未来功能已上线、能辅导 CTF 实战、提供考试代答。
- 自动搜索建议（仅展示给用户）：浙江 网络安全知识挑战赛 题库；浙江 网安竞赛 真题；网络与信息安全竞赛 怎么准备。

首页有“将于某日期开放”的历史文案。产品识别需保留原始状态，不因日期已过自动标记功能可用。

## 5. 当前页评论采集

- 点击“分析当前笔记”后，提取笔记标题、正文片段、当前已加载评论、已加载父评论上下文。
- 仅在评论容器内解析字段；正文和作者介绍不能被误当评论。
- 已有页面 ID 优先用于稳定去重；没有 ID 时组合笔记标识、作者本地标识、评论文本、可见时间生成哈希，并处理冲突。不能只按评论文本去重，不同用户可能都说“求”。
- 用户手动加载更多后，点“分析新增评论”。首版不自动滚动、不自动点展开；界面写“已读取 N 条已加载评论”，不声称覆盖全部。
- 可在用户启动本页会话后，用 MutationObserver 在内存暂存其手动滚动加载的评论，避免虚拟列表移除前文；切换笔记即隔离会话。
- 昵称、主页链接用于本地回看，不发送模型；评论和父评论先打码，原始未打码文本不入库。
- 解析失败、登录或验证码遮挡时提示停止，不扩大到全页模糊抓取。

## 6. 需求匹配与购买意向判断

输入由 ProductProfile + 笔记上下文 + 父评论上下文 + 评论组成。每批建议 10–20 条，并设置总 token 上限；不在首版按短文本或“无购买关键词”过滤，否则容易漏掉“求”“蹲”“怎么开通”。只排除空内容和已处理重复项。

模型逐条输出：

```ts
type Decision = {
  commentId: string;
  relevance: 'direct' | 'adjacent' | 'unrelated' | 'unknown';
  need: 'explicit' | 'implicit' | 'none' | 'unknown';
  purchaseIntent: 'explicit_buy' | 'price_or_access' | 'solution_seeking'
    | 'free_only' | 'none' | 'unknown';
  speakerRole: 'seeker' | 'seller' | 'sharer' | 'unknown';
  needSummary: string;
  evidence: { source: 'comment' | 'parent' | 'note'; quote: string }[];
  reason: string;
  uncertainty: string | null;
};
```

通过 Zod 校验枚举、长度及字段；校验返回 ID 属于当前批次、不遗漏或重复；evidence 必须能在对应输入找到。网页和评论是待分析数据，其中指令不得改变判断规则、调用工具或决定 API 地址。模型结果仅以文本安全渲染。

代码按标签分组，避免先拍脑袋定 60 分：

- 高意向：直接相关 + 有需求 + 问价/购买/开通 + 非卖家，且证据指向相关产品或品类。
- 需求线索：相关 + 求资料/求工具/求备考方法，未表达付费意愿。
- 待确认：上下文不足、指代不清、相邻竞赛、功能是否满足不明确。
- 排除：无关、广告卖家、闲聊、已有方案且未表达新需求、产品不提供的服务。

| 模拟评论（非真实采集） | 预期判断 |
|---|---|
| “浙江这个知识赛有没有历年题库？” | 直接需求，付费意愿未知 |
| “这个题库多少钱，在哪开通？” | 若上下文指向对应备考题库，则高意向 |
| “求免费分享，不买资料” | 有需求，明确免费偏好；不能算购买意向 |
| “蹲” | 结合父评论和笔记判断；缺上下文则待确认 |
| “我有题库，需要的找我” | 卖家，不是买家线索 |
| “求 CTF Web 渗透实战陪练” | 相邻领域但产品能力不匹配 |
| “刚买完，不需要了” | 否定当前需求，不升级高意向 |
| “考试时帮我做题多少钱” | 不符合备考产品用途，排除 |

询问竞品价格只能说明相关品类的购买信号，不能标注为“想买我们的产品”。输出应注明意向指向，不能跨用户拼接父评论的购买意愿。

## 7. 技术架构

```text
WXT + TypeScript + React 侧边栏
  ├─ 产品 URL → 只读网页提取 → 国内 LLM → 产品画像（含证据）
  ├─ 小红书静态 Content Script → 当前笔记/已加载评论快照
  ├─ 清洗打码 → 去重 → 批量分析 → Zod 校验 → 本地规则分组
  ├─ Dexie / IndexedDB → 产品、笔记、线索、分析记录
  └─ 设置 → 用户自己的 API Key / 模型 / 本次费用统计

Service Worker：消息路由、权限和标签页协调；不靠长计时器保持任务。
侧边栏：首版 AI 请求执行与进度显示；关闭后中断，重新打开允许重试未完成批次。
```

- 小红书 content script 不拿 API Key，不直接请求 AI。
- Key 默认会话保存；用户明确选择记住时本地保存，并限制为可信扩展上下文可访问；不进入同步存储、页面、日志或导出。插件本地存储不等于系统密码保险箱。
- 扩展页面跨域调用用户选定的国内 AI 主机，域名明确授权；不允许网页文本或模型输出更改请求地址。
- 数据表：products、notes、comments、analyses、feedback。分析唯一键含 productId、profileVersion、commentKey、contextHash、modelVersion、promptVersion，产品变化和上下文补全能重判。
- 完成批次即时保存。超时/限流显示可重试；不标成已分析，不静默无限重发。中断后的供应商费用可能已发生，不声称 exactly-once 计费。
- 原始备注和链接只本地保存；AI 收到的是去标识后的内容。保留期限首版统一一个可设置期限，不做套餐差异。
- 不需要 Node 业务后端、SQLite 服务器、向量数据库、RAG、LangChain 或 MCP 服务。

## 8. 页面与交付顺序

页面只保留“产品 / 当前笔记 / 已保存线索 / 设置”。

1. 使用示例 URL 验证动态网页自动识别；输出事实、推断、未知和证据。
2. 复用候选解析器，验证真实小红书页面：正文不混入评论、身份字段对应、父子关系正确、SPA 换帖不串数据。优先做这一步再铺 UI。
3. 接通一种国内模型，使用模拟和脱敏样本验证标签与证据，再接真实当前页分析。
4. 加入本地持久化、去重、已处理/反馈、可选 JSON/CSV 导出。CSV 需要公式转义及中文编码处理。
5. 做一批按笔记划分训练示例与保留测试集的人工评测；需求识别和购买意向分别统计。重点看高意向误报、需求漏判、证据正确率、每 100 条费用与耗时。

初始验收建议：代表性页面已加载评论提取准确率 ≥95%；100–200 条标注评论上高意向精确率 ≥85%、需求召回率 ≥80%。这些是拟定验收目标，尚无实测；样本需覆盖卖家、免费党、否定表达、短评论和竞赛混淆，不能只挑容易的句子。

暂不承诺固定工期：先完成产品页读取、小红书解析、模型质量三个最小验证，再估算剩余工作。

## 9. 官方技术资料

- [TypeSafe Jev](https://docs.typesafe.ai/introduction)
- [阿里云 Qwen Plus](https://help.aliyun.com/zh/model-studio/qwen-plus)
- [DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [豆包结构化输出](https://docs.volcengine.com/docs/ark/add-json?lang=zh)
- [腾讯云意图识别节点](https://cloud.tencent.com/document/product/1759/115747)
- [硅基流动重排 API](https://docs.siliconflow.cn/docs/api/rerank-post)
- [Qwen3 Embedding / Reranker 官方仓库](https://github.com/QwenLM/Qwen3-Embedding)
- [Chrome 内容脚本](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

以上模型服务做了文档核验，未使用 Key 调用，未做本地网络、账单和中文业务样本实测。
