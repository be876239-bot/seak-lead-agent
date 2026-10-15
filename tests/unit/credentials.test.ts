import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const make = () => {
    const data: Record<string, unknown> = {};
    return {
      data,
      async get(key: string) { return key in data ? { [key]: data[key] } : {}; },
      async set(obj: Record<string, unknown>) { Object.assign(data, obj); },
      async remove(key: string) { delete data[key]; },
    };
  };
  return { session: make(), local: make(), sync: make() };
});

vi.mock('wxt/browser', () => ({
  browser: {
    storage: { session: store.session, local: store.local, sync: store.sync },
    runtime: { id: 'ext-test', getURL: (p: string) => `chrome-extension://ext-test/${p}` },
    permissions: { request: vi.fn(async () => true), contains: vi.fn(async () => false) },
  },
}));

import { clearCredential, loadCredential, saveCredential } from '../../src/storage/credentials';
import { handleBackgroundMessage, isTrustedSender } from '../../src/messaging/handlers';
import { buildRequest } from '../../src/messaging/protocol';

beforeEach(() => {
  for (const s of [store.session, store.local, store.sync]) void s.remove('crd');
});

describe('credentials', () => {
  it('未勾选记住：只进 session，绝不进 sync/local', async () => {
    await saveCredential({ presetId: 'bailian', apiKey: 'sk-test', model: 'qwen3.8-flash', remember: false });
    expect(store.session.data.crd).toBeDefined();
    expect(store.local.data.crd).toBeUndefined();
    expect(store.sync.data.crd).toBeUndefined();
  });

  it('勾选记住：进 local，清除时两边都删', async () => {
    await saveCredential({ presetId: 'bailian', apiKey: 'sk-test', model: 'm', remember: true });
    expect(store.local.data.crd).toBeDefined();
    expect(store.session.data.crd).toBeUndefined();
    expect(await loadCredential()).toMatchObject({ apiKey: 'sk-test' });
    await clearCredential();
    expect(await loadCredential()).toBeNull();
  });
});

describe('background 消息安全', () => {
  const trusted = { id: 'ext-test', url: 'chrome-extension://ext-test/sidepanel/index.html' };
  const contentScript = { id: 'ext-test', url: 'https://www.xiaohongshu.com/explore', tabId: 7 };

  it('区分扩展页面与 content script 发送者', () => {
    expect(isTrustedSender(trusted)).toBe(true);
    expect(isTrustedSender(contentScript)).toBe(false);
    expect(isTrustedSender({ id: 'other', url: 'chrome-extension://other/' })).toBe(false);
  });

  it('content script 不能触发敏感后台命令', async () => {
    const req = buildRequest('PRODUCT_READ_RENDERED', { jobId: crypto.randomUUID(), url: 'https://a.example/' });
    const res = await handleBackgroundMessage(req, contentScript);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PERMISSION_DENIED');
  });

  it('未知消息类型与非法结构被拒绝', async () => {
    const bad = { protocol: 1, requestId: 'r', type: 'XHS_AUTO_SCROLL', payload: {} };
    expect((await handleBackgroundMessage(bad, trusted)).ok).toBe(false);
    expect((await handleBackgroundMessage({ junk: true }, trusted)).ok).toBe(false);
  });
});
