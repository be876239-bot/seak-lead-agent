# 搜索滚动消息入口遗漏修复（2026-10-19）

根因：协议、DiscoveryBrowser和XhsSessionManager均已支持XHS_SCROLL_SEARCH，但entrypoints/xhs.content.ts白名单未加入该类型。真实onMessage监听器因此返回undefined，不执行manager.handle，后台报“页面脚本返回了非法响应”。这不是平台返回非法消息的证据。

最小生产修改：仅将XHS_SCROLL_SEARCH加入入口白名单。原有同扩展sender.id校验、RequestSchema、页面身份和平台验证拦截保持原样；不更改导航、滚动策略、评论采集、AI或权限。

新增tests/integration/xhs-content-entry.test.ts，直接加载生产content入口并取得实际注册监听器，调用真实manager与DOM滚动实现，仅浏览器桥接由测试提供。
修复前7项中4项失败：正常向下/回顶部滚动、错误页面/验证返回消息都被入口忽略。修复后7项全部通过；另外验证陌生sender、非法参数、非XHS消息仍被拒绝。

全量Vitest：39文件、478/478 PASS。TypeScript、ESLint、git diff --check PASS。Chrome/Edge生产构建、ZIP PASS；各11个文件逐字节匹配对应生产目录。构建有第三方Zod注释警告，不影响产物。
包路径：.output/seeklead-agent-0.1.0-edge.zip 与 .output/seeklead-agent-0.1.0-chrome.zip。
两包SHA256：05ab9cbcbad8b34fd7ba199bd3bea320f2eb1557b96645c17a71c8d456541733。

分支codex/eric-development，HEAD 16a6d7d；保留已有脏工作区，本轮未提交或推送。
F真实小红书：NOT VERIFIED。重载扩展并刷新原搜索页后继续任务，观察候选卡片不在当前DOM时是否能正常滚动查找。遇验证立即暂停，不保证一定能找回目标卡片。
