export default defineContentScript({
  matches: ['https://www.xiaohongshu.com/*'],
  main() {
    // 采集会话在 T14 实现；当前不观察、不采集。
  },
});
