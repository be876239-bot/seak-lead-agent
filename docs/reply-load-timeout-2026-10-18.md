# 回复展开超时非阻塞处理（2026-10-18）

## 基线与根因

分支 codex/eric-development，HEAD 16a6d7d；存在大量用户/网页版GPT未提交改动，全部保留。开始前备份差异与文件哈希至 `.scratch/baselines/reply-timeout-20261018-225328`。
当前实际单帖上限为2000（此前其他修改），本轮不修改上限，也不修改D021预算、AI Prompt/分组/缓存。

`settleReplyLoad`在展开后10秒未新增时抛PARSE_FAILED，串行runner将其变为整任务PAUSE；`advanceReplies`再次发现相同requestKey时也抛错。因此只删除第一个throw仍会暂停。
真实日志证实274条已保存时触发此路径，但不证明平台为何没有及时显示新回复，不能据此认定风控或解析原因。

## 实现

- 会话用有界Set记录失败父评论键；10秒无进展时清除pending并记警告，不抛错。一次失败后，本次任务保守跳过该父评论的后续展开，避免文案/计数变化或控件重渲染后继续点击。
- 同一requestKey重复扫描只跳过，不触发新的暂停。其他父评论和正常滚动继续，已保存内容不丢；迟到回复仍按正常增量解析/父子关联/去重落库。
- 协议快照携带可选replyLoadWarnings，进度显示replyLoadWarningCount；旧数据缺字段兼容。
- 失败键保存在discovery.post检查点，恢复会话时带入，不重新点击失败入口。迟到旧帖回调不会污染新帖，空/重复警告不增加持久化写入。
- 共享captureIncompleteReason将这类警告视为不完整数据。即使显示数量匹配或未知，也跳过AI，不改变已有门禁。当前baseline串行调度会将这类帖子标为partial后继续下一帖，不标为完整完成。
- UI显示“有X组回复加载未确认；已跳过无响应入口，继续采集其他内容，结果可能不完整”。
- 登录、验证码、风控、页面异常/换帖、取消、预算及最大动作次数保护保留。

## 文件

src/xhs/session.ts、capture.ts：超时调度/跳过、警告累计、共享完整性门禁。
src/messaging/protocol.ts、src/domain/schemas.ts：兼容可选字段。
src/discovery/serial.ts、jobs.ts：持久化与恢复接线。
src/ui/CollectionProgress.tsx：警告提示。
对应tests/integration/xhs-replies.test.ts、discovery-e2e.test.ts、discovery-boundary.test.ts，以及tests/unit/xhs-capture.test.ts、collection-progress.test.ts。

## 测试和构建

原“超时应失败”测试按用户批准的新产品规则改为“每个入口只点一次，正常结束、数据库内容保留、警告数正确”；未降低原数量断言。
新增7项：其他回复继续+迟到回复/控件重建、超时后安全验证、会话恢复不重复点击、任务检查点恢复、两帖无PAUSE且均partial/无AI、UI提示、共享AI门禁。
全量Vitest：36文件、452/452 PASS。TypeScript、ESLint、git diff --check PASS。Chrome/Edge生产构建和ZIP PASS；仅第三方Zod注释警告。ZIP各11文件逐字节匹配对应生产目录。

安装包：`.output/seeklead-agent-0.1.0-edge.zip`、`.output/seeklead-agent-0.1.0-chrome.zip`。
SHA256（两包相同）：78845903e297745de42f810a09bb90b4b72242021c20414af7abb18e1ec15c0b。
未创建提交，未推送。工作区仍含原有与本轮修改。

## F 真实小红书：NOT VERIFIED

重载扩展并刷新问题笔记，再继续任务。若自然出现同类无响应入口，检查警告、其他评论继续保存、最终partial并跳过AI、自动进入下一帖。迟到回复若网页正常展示仍应保存；验证码/登录异常仍须暂停，不绕过验证。
本修复不会保证平台能加载全部回复；失败入口在本任务内不会自动重试，即使后续恢复，也保守保留未确认警告。无稳定身份且整个父容器被替换时，仍受项目已有弱身份限制，不猜测不同节点是否为同一评论。

## 用户验收状态更新（2026-10-18）

用户已确认真实小红书回复展开超时处理验收通过。自动化测试与原有边界限制不变。
