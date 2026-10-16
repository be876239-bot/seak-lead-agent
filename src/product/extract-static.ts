import { Readability } from '@mozilla/readability';
import { LIMITS } from '../domain/limits';
import { parseHtmlDocument } from './html-document';

export type ProductSourceBlock = {
  id: string;
  url: string;
  kind: 'title-meta' | 'json-ld' | 'headings' | 'article' | 'price-offer' | 'rendered-dom';
  text: string;
  fetchedAt: string;
};

export type StaticExtractResult = {
  blocks: ProductSourceBlock[];
  totalChars: number;
  needsRender: boolean;
  truncated: boolean;
  docTitle: string | null;
};

function cleanDoc(html: string, baseUrl: string): Document | null {
  const doc = parseHtmlDocument(html);
  if (doc.querySelector('parsererror') && !doc.body) return null;
  doc.querySelectorAll('script:not([type="application/ld+json"]),style,noscript,svg,iframe,video,audio,canvas').forEach((e) => e.remove());
  doc.querySelectorAll('a[href]').forEach((a) => {
    try {
      const u = new URL(a.getAttribute('href') || '', baseUrl);
      a.setAttribute('href', u.origin + u.pathname);
    } catch {
      a.removeAttribute('href');
    }
  });
  doc.querySelectorAll('img').forEach((e) => {
    e.setAttribute('src', 'ph');
  });
  const base = doc.createElement('base');
  base.setAttribute('href', baseUrl);
  doc.head?.appendChild(base);
  return doc;
}

function pushText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const PRICE_RE = /(\d+(?:[.,]\d+)?\s*(?:元|块|人民币|¥|￥|CNY|RMB|\$|USD|美元))|(?:¥|￥|\$)\s*\d+(?:[.,]\d+)?/i;

function jsonLdBlocks(doc: Document, url: string, fetchedAt: string): ProductSourceBlock[] {
  const out: ProductSourceBlock[] = [];
  let idx = 0;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    let data: unknown;
    try {
      data = JSON.parse(s.textContent || '');
    } catch {
      return;
    }
    const seen: string[] = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        const t = typeof o['@type'] === 'string' ? o['@type'] : Array.isArray(o['@type']) ? o['@type'].join(',') : '';
        if (/product|offer|price/i.test(t) || /product|offer/i.test(String(o.name ?? ''))) {
          const pick: Record<string, unknown> = {};
          for (const k of ['@type', 'name', 'description', 'price', 'priceCurrency', 'offers', 'availability', 'url', 'brand', 'category']) {
            if (k in o) pick[k] = k === 'offers' ? undefined : o[k];
          }
          if ('offers' in o && o.offers && typeof o.offers === 'object') {
            const off = o.offers as Record<string, unknown>;
            pick.offers = {
              '@type': off['@type'],
              price: typeof off.price === 'string' || typeof off.price === 'number' ? off.price : undefined,
              priceCurrency: typeof off.priceCurrency === 'string' ? off.priceCurrency : undefined,
              availability: typeof off.availability === 'string' ? off.availability : undefined,
            };
          }
          const text = pushText(JSON.stringify(pick));
          if (text.length > 20 && !seen.includes(text)) {
            seen.push(text);
            out.push({ id: `s${String(++idx).padStart(3, '0')}`, url, kind: 'json-ld', text: text.slice(0, 4000), fetchedAt });
          }
        }
        Object.values(o).forEach(visit);
      }
    };
    visit(data);
  });
  return out;
}

export function extractStatic(html: string, finalUrl: string, fetchedAt: string): StaticExtractResult {
  const doc = cleanDoc(html, finalUrl);
  if (!doc) {
    return { blocks: [], totalChars: 0, needsRender: true, truncated: false, docTitle: null };
  }
  const blocks: ProductSourceBlock[] = [];
  let idx = 0;

  const title = pushText(doc.querySelector('title')?.textContent || '');
  const desc = pushText(doc.querySelector('meta[name="description"]')?.getAttribute('content') || '');
  const ogTitle = pushText(doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '');
  const ogDesc = pushText(doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '');
  const titleMeta = pushText([title, desc, ogTitle, ogDesc].filter(Boolean).join(' | '));
  if (titleMeta) blocks.push({ id: `s${String(++idx).padStart(3, '0')}`, url: finalUrl, kind: 'title-meta', text: titleMeta.slice(0, 2000), fetchedAt });

  const ld = jsonLdBlocks(doc, finalUrl, fetchedAt);
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((e) => e.remove());
  for (const b of ld) {
    b.id = `s${String(++idx).padStart(3, '0')}`;
    blocks.push(b);
  }

  const headings = [...doc.querySelectorAll('h1,h2,h3')].map((e) => pushText(e.textContent || '')).filter(Boolean).slice(0, 40);
  if (headings.length) blocks.push({ id: `s${String(++idx).padStart(3, '0')}`, url: finalUrl, kind: 'headings', text: headings.join(' / ').slice(0, 4000), fetchedAt });

  let articleText = '';
  try {
    const clone = doc.cloneNode(true) as Document;
    const article = new Readability(clone).parse();
    articleText = pushText(article?.textContent || '');
  } catch {
    articleText = pushText(doc.body?.textContent || '');
  }

  const priceLines = [...(doc.body?.textContent || '').split(/[\n。；;]/)]
    .map((l) => l.trim())
    .filter((l) => l && PRICE_RE.test(l) && l.length <= 160)
    .slice(0, 12);
  if (priceLines.length) blocks.push({ id: `s${String(++idx).padStart(3, '0')}`, url: finalUrl, kind: 'price-offer', text: priceLines.join(' | ').slice(0, 3000), fetchedAt });

  const budget = LIMITS.maxProductChars - blocks.reduce((n, b) => n + b.text.length, 0);
  let truncated = false;
  if (articleText) {
    if (articleText.length > budget) {
      truncated = true;
      articleText = articleText.slice(0, Math.max(0, budget));
    }
    if (articleText.length >= 40) {
      blocks.push({ id: `s${String(++idx).padStart(3, '0')}`, url: finalUrl, kind: 'article', text: articleText, fetchedAt });
    }
  }

  const totalChars = blocks.reduce((n, b) => n + b.text.length, 0);
  const hashRoute = finalUrl.includes('#');
  const needsRender = totalChars < LIMITS.minStaticTextChars || (hashRoute && totalChars < 600);
  return { blocks, totalChars, needsRender, truncated, docTitle: title || null };
}
