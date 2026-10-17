# D018 评论列表短暂缺失等待（2026-10-17）

基线d9ba974，分支codex/eric-development，初始工作区干净。

用户真实日志：第3帖URL/noteKey一致，已累计14条，capturing/incomplete，execute因“未找到评论列表容器”暂停。这与此前Back无历史是两个故障点。

确认调用链：captureNote.snapshot → XHS_GET_SNAPSHOT → session.snapshot → ingest(true) → adapter.parseLoadedComments，在已确认评论区域找不到list-container即PARSE_FAILED → captureNote退出并STOP → serial.execute catch暂停。旧实现没有给同帖DOM重建留下等待窗口。

日志不能证明列表缺失是临时重渲染还是长期结构异常；修复只兼容短暂缺失，不能把永久异常伪装成采集完成。

## 最小修改

- src/domain/limits.ts：等待最多10次，每次使用已有500ms采样，总计5秒主动等待。
- src/xhs/capture.ts：仅autoLoad下，对两个现有精确容器缺失错误等待并重新读取同一session/expectedNoteKey。首次失败后advance=false，避免失败前可能已滚动而重复滚动。已累计集合和IndexedDB不重建、不清空。
- 超过预算明确PARSE_FAILED，提示已保存数量；不记captured/completed、不跳过当前帖。
- PAGE_BLOCKED/PAGE_CHANGED/取消及其他PARSE_FAILED立即透传；每次请求仍执行原内容脚本的平台、会话和笔记守卫。只等待网页DOM，不刷新、不点击额外控件、不调用私有API。
- adapter、selectors、session、导航、去重、回复关系、AI、分组、缓存和DB结构无变更。现有500条、3分钟/200轮及总任务10分钟保持。

## 回归

新增7项：短暂缺失后恢复且不重复advance；持续缺失10次后停止；取消；平台验证；换帖；其他解析错误不重试；生产session/capture/IndexedDB集成14条已存→列表移除→1秒后重建→最终1至30全部保留且正常no_new。

首项回归在修改前因相同“未找到评论列表容器”失败，修复后通过。没有删除旧测试或改变既有数量断言。

最终npm test/Vitest：33文件385/385通过；typecheck、lint、build:edge、zip:edge、git diff --check均通过。依赖既有Rollup注释警告非阻塞。

真实小红书新版：NOT VERIFIED。用户日志为真实失败证据，新增合成集成不是现场成功证明。若新版持续提示5秒未恢复，需要该帖当前评论区域的脱敏结构证据，不能继续放宽选择器或无限等待。

ZIP：D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip。
SHA256：77af76d19129e79b5effd4500df6e324faf37c1b72224016b848bee5a354ba33。
重新加载主目录.output/edge-mv3并刷新页面后验收；观察缺失窗口是否自动恢复，检查14条等已保存数据保留，用户停止/平台验证仍立即终止自动采集。
