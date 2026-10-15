import type { ProductSourceBlock } from './extract-static';

/**
 * 自包含的页面内提取函数：可通过 scripting.executeScript({func,args}) 注入
 * （参数仅原始值，函数体不引用外部作用域）。仅读取可见文本与白名单元数据，
 * 不读 input/textarea 值、Cookie、localStorage、脚本源码。
 */
export function extractRenderedInPage(
  finalUrl: string,
  fetchedAt: string,
  maxChars: number,
  ignoreVisibility: boolean,
): Omit<ProductSourceBlock, 'id'>[] {
  const PRICE_RE = /(\d+(?:[.,]\d+)?\s*(?:元|块|人民币|¥|￥|CNY|RMB|\$|USD|美元))|(?:¥|￥|\$)\s*\d+(?:[.,]\d+)?/i;
  const norm = (v: string) => v.replace(/\s+/g, ' ').trim();
  const doc = document;
  const out: Omit<ProductSourceBlock, 'id'>[] = [];

  const pickMeta = (sel: string, attr: string) => norm(doc.querySelector(sel)?.getAttribute(attr) || '');
  const tm = norm([
    norm(doc.querySelector('title')?.textContent || ''),
    pickMeta('meta[name="description"]', 'content'),
    pickMeta('meta[property="og:title"]', 'content'),
    pickMeta('meta[property="og:description"]', 'content'),
  ].filter(Boolean).join(' | '));
  if (tm) out.push({ url: finalUrl, kind: 'title-meta', text: tm.slice(0, 2000), fetchedAt });

  const headings = [...doc.querySelectorAll('h1,h2,h3')].map((e) => norm(e.textContent || '')).filter(Boolean).slice(0, 40);
  if (headings.length) out.push({ url: finalUrl, kind: 'headings', text: headings.join(' / ').slice(0, 4000), fetchedAt });

  const ldTexts: string[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const data = JSON.parse(s.textContent || '') as unknown;
      const visit = (n: unknown) => {
        if (Array.isArray(n)) { n.forEach(visit); return; }
        if (n && typeof n === 'object') {
          const o = n as Record<string, unknown>;
          if (/product|offer/i.test(String(o['@type'] ?? ''))) {
            const pick: Record<string, unknown> = {};
            for (const k of ['@type', 'name', 'description', 'price', 'priceCurrency', 'availability']) {
              if (typeof o[k] === 'string' || typeof o[k] === 'number') pick[k] = o[k];
            }
            if (Object.keys(pick).length > 1) ldTexts.push(norm(JSON.stringify(pick)).slice(0, 2000));
          }
          Object.values(o).forEach(visit);
        }
      };
      visit(data);
    } catch {
      /* 非法 JSON-LD 忽略 */
    }
  });
  for (const t of [...new Set(ldTexts)].slice(0, 8)) {
    if (t.length > 20) out.push({ url: finalUrl, kind: 'json-ld', text: t, fetchedAt });
  }

  const visibleParts: string[] = [];
  let total = 0;
  if (doc.body) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT']);
    let node = walker.nextNode();
    while (node) {
      const parent = (node as Text).parentElement;
      if (parent && !parent.closest('[hidden],[aria-hidden="true"]') && !skipTags.has(parent.tagName)) {
        let visible = ignoreVisibility;
        if (!visible) {
          const rect = parent.getBoundingClientRect();
          visible = rect.width > 0 || rect.height > 0 || parent.getClientRects().length > 0;
        }
        if (visible) {
          const t = norm((node as Text).textContent || '');
          if (t) {
            visibleParts.push(t);
            total += t.length;
          }
        }
      }
      if (total >= maxChars) break;
      node = walker.nextNode();
    }
  }
  const text = visibleParts.join(' ');
  if (text) {
    out.push({ url: finalUrl, kind: 'rendered-dom', text: text.slice(0, maxChars), fetchedAt });
    const priceLines = visibleParts.filter((l) => PRICE_RE.test(l) && l.length <= 160).slice(0, 12);
    if (priceLines.length) out.push({ url: finalUrl, kind: 'price-offer', text: priceLines.join(' | ').slice(0, 3000), fetchedAt });
  }
  return out;
}
