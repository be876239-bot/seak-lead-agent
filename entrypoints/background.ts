import { handleBackgroundMessage } from '../src/messaging/handlers';
import { registerProductHandlers } from '../src/product/handlers';
import { analysisLock, registerAnalysisHandlers } from '../src/analysis/jobs';
import { ensureDailyRetention } from '../src/storage/retention';
import { getDb } from '../src/storage/db';

export default defineBackground(() => {
  registerProductHandlers();
  registerAnalysisHandlers();
  // 启动恢复：上次进程遗留的运行中任务标 interrupted（不依赖 unload 事件）
  void analysisLock.recoverInterrupted()
    .then(() => ensureDailyRetention(getDb()))
    .catch(() => {});
  browser.runtime.onInstalled.addListener(() => {
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  });

  browser.runtime.onMessage.addListener((raw, sender) => {
    if (typeof raw === 'object' && raw !== null && 'protocol' in raw) {
      return handleBackgroundMessage(raw, sender);
    }
    return undefined;
  });
});
