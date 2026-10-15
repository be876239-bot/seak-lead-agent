import { browser } from 'wxt/browser';
import { AppError } from '../domain/errors';
import { LIMITS } from '../domain/limits';
import type { ProductSourceBlock } from './extract-static';
import { extractRenderedInPage } from './extract-rendered';

export type RenderedReadResult = {
  finalUrl: string;
  blocks: ProductSourceBlock[];
  truncated: boolean;
  degraded: boolean;
};

type ActiveRead = { tabId: number; aborted: boolean };
const activeReads = new Map<string, ActiveRead>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等页面 load 完成；后台标签若不渲染则给 degraded 提示（不伪造成功）。 */
async function waitForComplete(tabId: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab) throw new AppError('CANCELLED', '产品标签被关闭或读取已取消');
    if (tab.status === 'complete') return true;
    await sleep(300);
  }
  return false;
}

/** 正文稳定：连续两次 innerText 长度一致。 */
async function waitForStableBody(tabId: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let last = -1;
  let stableAt = 0;
  while (Date.now() < deadline) {
    const [inj] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => document.body ? document.body.innerText.length : 0,
    });
    const len = (inj?.result as number) ?? 0;
    if (len > 0 && len === last) {
      stableAt += 1;
      if (stableAt >= 2) return true;
    } else {
      stableAt = 0;
    }
    last = len;
    await sleep(500);
  }
  return false;
}

export async function readRenderedProduct(jobId: string, url: string, signal?: AbortSignal): Promise<RenderedReadResult> {
  const origin = new URL(url).origin;
  const granted = await browser.permissions.contains({ origins: [origin + '/*'] });
  if (!granted) throw new AppError('PERMISSION_DENIED', '需要先授权该域名的读取权限');

  const tab = await browser.tabs.create({ url, active: false });
  const tabId = tab.id;
  if (typeof tabId !== 'number') throw new AppError('UNKNOWN', '无法创建产品读取标签');
  const state: ActiveRead = { tabId, aborted: false };
  activeReads.set(jobId, state);
  const onAbort = () => { state.aborted = true; browser.tabs.remove(tabId).catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    if (state.aborted) throw new AppError('CANCELLED', '已取消');
    const loaded = await waitForComplete(tabId, LIMITS.renderTimeoutMs);
    if (state.aborted) throw new AppError('CANCELLED', '已取消');

    const finalTab = await browser.tabs.get(tabId).catch(() => null);
    const finalUrl = finalTab?.url ?? url;
    if (!finalUrl.startsWith(origin + '/')) {
      throw new AppError('PERMISSION_DENIED', `页面跳转到未授权域名：${new URL(finalUrl).origin}`);
    }

    let degraded = false;
    if (!loaded) degraded = true;
    else {
      const stable = await waitForStableBody(tabId, LIMITS.renderTimeoutMs - 3000);
      if (!stable) degraded = true;
    }

    const [inj] = await browser.scripting.executeScript({
      target: { tabId },
      func: extractRenderedInPage,
      args: [finalUrl, new Date().toISOString(), LIMITS.maxProductChars, false],
    });
    const rawBlocks = (inj?.result as Omit<ProductSourceBlock, 'id'>[] | undefined) ?? [];
    if (!rawBlocks.length) {
      throw new AppError('PAGE_UNREACHABLE', '页面在后台未渲染出可见正文，请把该产品标签切到前台后点击重试');
    }
    const fetchedAt = new Date().toISOString();
    let total = 0;
    let truncated = false;
    const blocks: ProductSourceBlock[] = [];
    for (let i = 0; i < rawBlocks.length; i++) {
      const b = rawBlocks[i]!;
      const remain = LIMITS.maxProductChars - total;
      if (remain <= 0) { truncated = true; break; }
      const text = b.text.slice(0, remain);
      if (text.length < b.text.length) truncated = true;
      total += text.length;
      blocks.push({ ...b, text, id: `s${String(blocks.length + 1).padStart(3, '0')}`, fetchedAt });
    }
    return { finalUrl, blocks, truncated, degraded };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    activeReads.delete(jobId);
    browser.tabs.remove(tabId).catch(() => {});
  }
}

export function cancelRenderedRead(jobId: string): boolean {
  const state = activeReads.get(jobId);
  if (!state) return false;
  state.aborted = true;
  browser.tabs.remove(state.tabId).catch(() => {});
  return true;
}
