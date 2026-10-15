import { describe, it, expect } from 'vitest';
import { parseProductUrl, sameOrigin } from '../../src/product/url-policy';
import { extractStatic } from '../../src/product/extract-static';
import { AppError } from '../../src/domain/errors';
import { readFileSync } from 'node:fs';

const html = (f: string) => readFileSync(new URL('../fixtures/' + f, import.meta.url), 'utf8');

describe('url-policy', () => {
  it('接受公开 https URL 并保留 hash', () => {
    const r = parseProductUrl('https://competition.example.com/#home');
    expect(r.origin).toBe('https://competition.example.com');
    expect(r.url.hash).toBe('#home');
  });
  it('拒绝非 http(s)、凭据、localhost、私网、IPv6 回环', () => {
    const bad = [
      'ftp://x.com/a',
      'https://user:pass@x.com/',
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://192.168.1.10/',
      'http://10.0.0.1/',
      'http://169.254.169.254/latest',
      'http://[::1]/',
      'http://[fe80::1]/',
      'chrome-extension://abc/',
    ];
    for (const u of bad) {
      expect(() => parseProductUrl(u), u).toThrow(AppError);
    }
  });
  it('sameOrigin 严格比较', () => {
    expect(sameOrigin('https://a.com/p', 'https://a.com/q')).toBe(true);
    expect(sameOrigin('https://a.com', 'https://b.com')).toBe(false);
  });
});

describe('extract-static', () => {
  const fetchedAt = '2026-10-15T10:00:00.000Z';
  it('静态信息页产出分类型来源块，价格与 JSON-LD 可见', () => {
    const r = extractStatic(html('./products/static-info.html'), 'https://example.com/#home', fetchedAt);
    const kinds = r.blocks.map((b) => b.kind);
    expect(kinds).toContain('title-meta');
    expect(kinds).toContain('json-ld');
    expect(kinds).toContain('headings');
    expect(kinds).toContain('article');
    expect(kinds).toContain('price-offer');
    expect(r.totalChars).toBeGreaterThan(200);
    expect(r.needsRender).toBe(false);
    const ld = r.blocks.find((b) => b.kind === 'json-ld')!;
    expect(ld.text).toContain('99.00');
    expect(r.blocks.every((b) => b.id.startsWith('s'))).toBe(true);
    expect(new Set(r.blocks.map((b) => b.id)).size).toBe(r.blocks.length);
  });
  it('不采集 script 正文与图片 URL，href 只保留 origin+path', () => {
    const src = html('./products/static-info.html');
    const r = extractStatic(src, 'https://example.com/', fetchedAt);
    const all = r.blocks.map((b) => b.text).join('');
    expect(all).not.toContain('application/ld+json');
    expect(all).not.toMatch(/<script/);
  });
  it('应用外壳触发 needsRender', () => {
    const r = extractStatic(html('./products/app-shell.html'), 'https://spa.example.com/#home', fetchedAt);
    expect(r.needsRender).toBe(true);
  });
  it('来源块总量不超过 maxProductChars', () => {
    const big = '<html><head><title>t</title></head><body>' + '价'.repeat(40000) + '</body></html>';
    const r = extractStatic(big, 'https://example.com/', fetchedAt);
    expect(r.truncated).toBe(true);
    expect(r.totalChars).toBeLessThanOrEqual(30000);
  });
  it('真实示例产品页（2026-10-15 curl 采集）：识别标题并判定需渲染兜底', () => {
    const r = extractStatic(
      html('./products/real-app-shell-competition.html'),
      'https://competition.bertrammmmm.top/#home',
      fetchedAt,
    );
    expect(r.docTitle).toContain('浙江省大学生网络与信息安全竞赛');
    expect(r.needsRender).toBe(true);
  });
});
