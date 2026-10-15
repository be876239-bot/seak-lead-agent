import { handleBackgroundMessage } from '../src/messaging/handlers';

export default defineBackground(() => {
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
