import { handleBackgroundMessage } from '../src/messaging/handlers';
import { registerProductHandlers } from '../src/product/handlers';

export default defineBackground(() => {
  registerProductHandlers();
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
