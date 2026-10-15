import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const sendMessage = vi.fn();
const permissionsContains = vi.fn();

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test', getURL: (p: string) => 'chrome-extension://test/' + p, sendMessage: (...a: unknown[]) => sendMessage(...a) },
    permissions: { contains: (...a: unknown[]) => permissionsContains(...a), request: vi.fn() },
    tabs: { create: vi.fn(), get: vi.fn(), remove: vi.fn(), onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }, onRemoved: { addListener: vi.fn(), removeListener: vi.fn() } },
    scripting: { executeScript: vi.fn() },
  },
}));

async function collect(url: string) {
  const { collectProductSources } = await import('../../src/product/service');
  return collectProductSources(url, crypto.randomUUID());
}

const staticHtml = () => readFileSync('tests/fixtures/products/static-info.html', 'utf8');

beforeEach(() => {
  vi.resetModules();
  sendMessage.mockReset();
  permissionsContains.mockReset();
  permissionsContains.mockResolvedValue(true);
});

describe('collectProductSources', () => {
  it('静态足够时不走渲染，不补读外部动作链接', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const u = String(input);
      if (u === 'https://example.com/') {
        return new Response(staticHtml(), { headers: { 'content-type': 'text/html' } });
      }
      return new Response('<html><head><title>定价</title></head><body><main><h1>价格方案</h1><p>基础版 99 元，专业版 299 元，包含全部 1091 道真题的解锁权限与限时挑战赛参赛资格，按年续费可随时取消，不需要邀请码即可咨询客服。</p></main></body></html>', { headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await collect('https://example.com/');
    expect(r.renderUsed).toBe(false);
    expect(r.blocks.length).toBeGreaterThan(2);
    // 静态 fixture 文本超过一半预算 → 不补读
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('空壳页触发渲染兜底并透传后台结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body><div id="app"></div></body></html>', { headers: { 'content-type': 'text/html' } })));
    sendMessage.mockResolvedValue({
      ok: true,
      data: {
        finalUrl: 'https://spa.example.com/#home',
        blocks: [{ id: 's001', url: 'https://spa.example.com/#home', kind: 'rendered-dom', text: '在线备考题库，历年真题一千余道，邀请码解锁，价格 99 元每年，覆盖十二个知识域。'.repeat(20), fetchedAt: new Date().toISOString() }],
        truncated: false,
        degraded: false,
      },
    });
    const r = await collect('https://spa.example.com/#home');
    expect(r.renderUsed).toBe(true);
    expect(r.finalUrl).toBe('https://spa.example.com/#home');
    expect(r.blocks[0]!.kind).toBe('rendered-dom');
  });

  it('fetch 异常后转渲染；渲染也失败则 PAGE_UNREACHABLE 可重试', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    sendMessage.mockResolvedValue({ ok: false, error: { code: 'PAGE_UNREACHABLE', message: '未渲染', retryable: true } });
    await expect(collect('https://down.example.com/')).rejects.toMatchObject({ code: 'PAGE_UNREACHABLE' });
  });

  it('无权限直接拒绝，不发起请求', async () => {
    permissionsContains.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(collect('https://nope.example.com/')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非 HTML 响应报 PAGE_UNSUPPORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('binary', { headers: { 'content-type': 'application/pdf' } })));
    sendMessage.mockResolvedValue({ ok: false, error: { code: 'PAGE_UNSUPPORTED', message: 'x', retryable: false } });
    await expect(collect('https://example.com/doc.pdf')).rejects.toMatchObject({ code: 'PAGE_UNSUPPORTED' });
  });
});
