// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: async () => true } } }));

afterEach(() => vi.unstubAllGlobals());

it('无 DOM 的后台环境仍可完成静态产品抽取和同域补读，不误走渲染', async () => {
  expect(typeof globalThis.DOMParser).toBe('undefined');
  const html = readFileSync('tests/fixtures/products/static-info.html', 'utf8');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })));
  const render = vi.fn(async () => { throw new Error('静态页面不应触发渲染'); });
  const { collectProductSources } = await import('../../src/product/service');
  const result = await collectProductSources('https://example.com/', crypto.randomUUID(), undefined, render);
  expect(result.renderUsed).toBe(false);
  expect(result.blocks.some((b) => b.text.includes('99'))).toBe(true);
  expect(render).not.toHaveBeenCalled();
});

it('worker 同域补读也不依赖浏览器 DOMParser', async () => {
  const html = `<html><head><title>小型产品页</title></head><body><main><h1>客户管理工具</h1><p>${'提供客户记录、跟进提醒与导出，帮助一人公司管理潜客。'.repeat(12)}</p><a href="/pricing">价格</a></main></body></html>`;
  const fetchMock = vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', fetchMock);
  const { collectProductSources } = await import('../../src/product/service');
  const result = await collectProductSources('https://example.com/', crypto.randomUUID());
  expect(result.renderUsed).toBe(false);
  expect(fetchMock.mock.calls.length).toBe(2);
  expect(result.blocks.some((b) => b.url === 'https://example.com/pricing')).toBe(true);
});

it('静态读取期间取消会停止且不误开渲染标签', async () => {
  const ac = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => {
    ac.abort();
    throw new DOMException('aborted', 'AbortError');
  }));
  const render = vi.fn();
  const { collectProductSources } = await import('../../src/product/service');
  await expect(collectProductSources('https://example.com/', crypto.randomUUID(), ac.signal, render))
    .rejects.toMatchObject({ code: 'CANCELLED' });
  expect(render).not.toHaveBeenCalled();
});
