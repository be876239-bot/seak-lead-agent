import { browser } from 'wxt/browser';
import { AppError } from '../domain/errors';
import { LIMITS } from '../domain/limits';
import { parseProductUrl } from './url-policy';
import { extractStatic, type ProductSourceBlock } from './extract-static';
import { parseHtmlDocument } from './html-document';

export type ProductSourcesResult = {
  inputUrl: string;
  finalUrl: string;
  blocks: ProductSourceBlock[];
  totalChars: number;
  truncated: boolean;
  degraded: boolean;
  renderUsed: boolean;
};

const ACTION_RE = /登录|退出|下载|邀请|绑定|提交|logout|signin|login|download|submit/i;
const RELEVANT_RE = /产品|功能|价格|定价|套餐|题库|product|pricing|feature/i;

async function fetchHtmlLimited(url: string, signal?: AbortSignal): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIMITS.staticFetchTimeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: ctrl.signal,
    });
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(ct)) throw new AppError('PAGE_UNSUPPORTED', '目标不是 HTML 页面');
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > LIMITS.maxHtmlBytes) throw new AppError('PAGE_UNSUPPORTED', '页面 HTML 超过 2MB 上限');
    const reader = res.body?.getReader();
    if (!reader) throw new AppError('PAGE_UNREACHABLE', '无法读取响应体');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.maxHtmlBytes) {
        reader.cancel().catch(() => {});
        throw new AppError('PAGE_UNSUPPORTED', '页面 HTML 超过 2MB 上限');
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function findSupplementLinks(html: string, baseUrl: string): string[] {
  const doc = parseHtmlDocument(html);
  doc.querySelectorAll('script,style').forEach((e) => e.remove());
  const out: string[] = [];
  const seen = new Set<string>();
  doc.querySelectorAll('a[href]').forEach((a) => {
    const label = (a.textContent || '').trim();
    if (!label || ACTION_RE.test(label) || !RELEVANT_RE.test(label)) return;
    if (a.closest('nav,footer,header')) return;
    try {
      const u = new URL(a.getAttribute('href') || '', baseUrl);
      if (u.origin !== new URL(baseUrl).origin) return;
      u.hash = '';
      const key = u.toString();
      if (key === new URL(baseUrl).origin + '/' || seen.has(key) || /\.(pdf|zip|exe|dmg)$/i.test(u.pathname)) return;
      seen.add(key);
      out.push(key);
    } catch {
      /* 忽略非法链接 */
    }
  });
  return out.slice(0, 2);
}

/** 渲染兜底读取：面板经消息走后台；后台协调器直接注入本地实现（不能给自己发消息）。 */
export type RenderReaderFn = (jobId: string, url: string) => Promise<{
  finalUrl: string; blocks: ProductSourceBlock[]; truncated: boolean; degraded?: boolean;
}>;

const messageRenderReader: RenderReaderFn = async (jobId, url) => {
  const res = await browser.runtime.sendMessage({
    protocol: 1, requestId: crypto.randomUUID(), type: 'PRODUCT_READ_RENDERED', payload: { jobId, url },
  });
  if (!res?.ok) {
    const e = res?.error;
    throw new AppError(e?.code ?? 'PAGE_UNREACHABLE', e?.message ?? '渲染读取失败', true);
  }
  return res.data;
};

/** 侧边栏编排：静态优先 → 渲染兜底 → 同域补读（最多 2 页）。 */
export async function collectProductSources(
  rawUrl: string, jobId: string, signal?: AbortSignal, renderReader: RenderReaderFn = messageRenderReader,
): Promise<ProductSourcesResult> {
  if (signal?.aborted) throw new AppError('CANCELLED', '产品读取已取消');
  const { url } = parseProductUrl(rawUrl);
  const granted = await browser.permissions.contains({ origins: [url.origin + '/*'] });
  if (!granted) throw new AppError('PERMISSION_DENIED', '请先在弹窗中授权该域名');

  const fetchedAt = new Date().toISOString();
  let finalUrl = url.toString();
  let blocks: ProductSourceBlock[] = [];
  let truncated = false;
  let degraded = false;
  let renderUsed = false;
  let supplementBase = '';

  let needsRender = true;
  try {
    const html = await fetchHtmlLimited(finalUrl, signal);
    if (signal?.aborted) throw new AppError('CANCELLED', '产品读取已取消');
    const r = extractStatic(html, finalUrl, fetchedAt);
    needsRender = r.needsRender;
    blocks = r.blocks;
    truncated = r.truncated;
    if (!needsRender) supplementBase = html;
  } catch (err) {
    if (signal?.aborted) throw new AppError('CANCELLED', '产品读取已取消');
    if (err instanceof AppError && (err.code === 'CANCELLED' || err.code === 'PAGE_UNSUPPORTED')) throw err;
    needsRender = true;
  }

  if (needsRender) {
    const res = await renderReader(jobId, finalUrl);
    finalUrl = res.finalUrl || finalUrl;
    blocks = res.blocks;
    truncated = res.truncated;
    degraded = res.degraded ?? false;
    renderUsed = true;
  }

  // 同域补读：仅在静态正文不足一半预算时进行
  const totalChars = () => blocks.reduce((n, b) => n + b.text.length, 0);
  if (supplementBase && totalChars() < LIMITS.maxProductChars / 2) {
    for (const link of findSupplementLinks(supplementBase, finalUrl)) {
      if (signal?.aborted) throw new AppError('CANCELLED', '已取消');
      try {
        const html = await fetchHtmlLimited(link, signal);
        const r = extractStatic(html, link, fetchedAt);
        for (const b of r.blocks) {
          if (totalChars() >= LIMITS.maxProductChars) { truncated = true; break; }
          blocks.push({ ...b, id: `s${String(blocks.length + 1).padStart(3, '0')}` });
        }
      } catch {
        if (signal?.aborted) throw new AppError('CANCELLED', '产品读取已取消');
        /* 补读失败不阻断，已有来源块 */
      }
    }
  }

  if (signal?.aborted) throw new AppError('CANCELLED', '产品读取已取消');
  if (!blocks.length) {
    throw new AppError('PAGE_UNREACHABLE', '未能读取到产品页内容，请检查链接是否公开可访问' + (renderUsed ? '（可尝试把页面切到前台后重试）' : ''), true);
  }
  return { inputUrl: rawUrl, finalUrl, blocks, totalChars: totalChars(), truncated, degraded, renderUsed };
}
