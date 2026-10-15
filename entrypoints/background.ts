import { handleBackgroundMessage } from '../src/messaging/handlers';
import { registerProductHandlers } from '../src/product/handlers';
import { getDb } from '../src/storage/db';
import { Repositories } from '../src/storage/repositories';
import { TaskLockManager } from '../src/analysis/lock';

export default defineBackground(() => {
  registerProductHandlers();
  // 启动恢复：上次进程遗留的运行中任务标 interrupted（不依赖 unload 事件）
  void new TaskLockManager(new Repositories(getDb())).recoverInterrupted().catch(() => {});
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
