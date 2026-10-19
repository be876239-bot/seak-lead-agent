import { browser } from 'wxt/browser';
import { RequestSchema, buildError, buildOk, type Request } from '../src/messaging/protocol';
import { toErrorPayload } from '../src/domain/errors';
import { XhsSessionManager } from '../src/xhs/session';

const XHS_TYPES = new Set(['XHS_CLICK_NOTE', 'XHS_CLOSE_NOTE', 'XHS_SEARCH_STATE', 'XHS_SCROLL_SEARCH', 'XHS_DISCOVER', 'XHS_GUARD', 'XHS_GET_STATUS', 'XHS_START_SESSION', 'XHS_GET_SNAPSHOT', 'XHS_STOP_SESSION']);

export default defineContentScript({
  matches: ['https://www.xiaohongshu.com/*'],
  main() {
    if (window.top !== window) return;
    const manager = new XhsSessionManager(() => document);
    window.addEventListener('pagehide', () => manager.dispose(), { once: true });

    browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse): true | undefined => {
      const parsed = RequestSchema.safeParse(raw);
      if (!parsed.success) return undefined;
      const req = parsed.data as Request;
      if (!XHS_TYPES.has(req.type)) return undefined;
      if (sender.id !== browser.runtime.id) return undefined;
      void manager.handle(req).then(
        (data) => sendResponse(buildOk(req.requestId, data)),
        (err) => sendResponse(buildError(req.requestId, toErrorPayload(err))),
      );
      return true;
    });
  },
});
