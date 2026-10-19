// @vitest-environment-options {"url":"https://www.xiaohongshu.com/search_result?keyword=AI"}
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { toErrorPayload } from '../../src/domain/errors';
import { SeekLeadDb } from '../../src/storage/db';
import { Repositories } from '../../src/storage/repositories';
import { TaskLockManager } from '../../src/analysis/lock';
import { MockProvider } from '../../src/ai/mock';
import { runProfileGeneration, type RunnerDeps } from '../../src/analysis/runner';
import { XhsSessionManager } from '../../src/xhs/session';
import { RequestSchema, buildRequest, buildOk, buildError } from '../../src/messaging/protocol';

const shared = vi.hoisted(() => ({
  deps: null as unknown as RunnerDeps,
  tabs: { get: vi.fn(), query: vi.fn(), create: vi.fn(), update: vi.fn(), goBack: vi.fn(), sendMessage: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'test', getURL: () => 'chrome-extension://test/' }, tabs: shared.tabs } }));
vi.mock('../../src/analysis/jobs', () => ({
  get analysisRepos() { return shared.deps.repos; },
  makeDeps: async () => shared.deps,
  baseJob: (_deps: unknown, id: string) => ({
    id, kind: 'comments', status: 'created', ownerId: 'test', generation: 0,
    productId: null, profileVersion: null, tabId: null, noteKey: null,
    provider: 'mock', modelId: 'mock', promptVersion: 'test', totalItems: 0,
    completedItems: 0, failedItems: 0, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), errorCode: null,
  }),
}));
vi.mock('../../src/xhs/capture', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/xhs/capture')>();
  return { ...actual, captureNote: (id: number, options: import('../../src/xhs/capture').CaptureOptions) =>
    actual.captureNote(id, { ...options, wait: async () => { await Promise.resolve(); } }) };
});
vi.mock('../../src/discovery/browser', async load => {
  const actual = await load<typeof import('../../src/discovery/browser')>();
  return { ...actual, wait: async () => {} };
});

let db: SeekLeadDb;
let manager: XhsSessionManager | undefined;
afterEach(() => { manager?.dispose(); db?.close(); });
const noteId = 'a'.repeat(24);
const otherNoteId = 'b'.repeat(24);
const sourceUrl = 'https://www.xiaohongshu.com/search_result?keyword=AI';
const noteUrl = `https://www.xiaohongshu.com/explore/${noteId}?source=synthetic`;
function items() {
  return '<div class="parent-comment"><div class="comment-item" id="comment-1"><div class="content"><span class="note-text">需要购买PPT工具</span></div></div></div>';
}

it('重新处理批量任务中的指定帖子：身份守卫生效，原检查点和已保存数据保留', async () => {
  vi.resetModules();
  const { registerDiscoveryHandlers } = await import('../../src/discovery/jobs');
  const { handleBackgroundMessage } = await import('../../src/messaging/handlers');
  db = new SeekLeadDb('discovery-reprocess-' + crypto.randomUUID());
  const repos = new Repositories(db);
  const lock = new TaskLockManager(repos);
  const claim = { value: null, status: 'unknown', evidence: [] };
  const provider = new MockProvider({
    profile: () => ({
      schemaVersion: 1, name: { value: '合成产品', status: 'inferred', evidence: [] },
      category: claim, summary: claim, capabilities: [], targetAudience: [], needsServed: [],
      exclusions: [], accessMethod: claim, price: claim, purchaseChannel: claim, searchSuggestions: ['AI PPT'],
    }),
    classification: input => ({
      results: input.items.map(item => ({
        commentId: item.commentId, relevance: 'direct', need: 'explicit', purchaseIntent: 'explicit_buy',
        speakerRole: 'seeker', intentTarget: 'our_product', productFit: 'supported',
        needSummary: '合成需求', evidence: [{ sourceId: item.commentId + ':text', quote: item.text }],
        reason: '合成测试', uncertainty: null,
      })),
    }),
  });
  shared.deps = { repos, lock, provider, providerName: 'mock', modelId: 'mock', retryDelayMs: 0 };
  const product = await runProfileGeneration(shared.deps, {
    inputUrl: 'https://example.com', finalUrl: 'https://example.com',
    blocks: [{ id: 'b001', url: 'https://example.com', text: '合成产品', fetchedAt: new Date().toISOString() }],
  });

  let currentUrl = sourceUrl;
  let backs = 0;
  const clicked: string[] = [];
  function renderSearch() {
    manager?.dispose();
    currentUrl = sourceUrl;
    history.replaceState({}, '', sourceUrl);
    document.body.innerHTML = [noteId, otherNoteId].map(id =>
      `<section class="note-item"><a class="cover" href="/explore/${id}?source=synthetic">note</a></section>`,
    ).join('');
    document.querySelectorAll<HTMLAnchorElement>('a.cover').forEach(anchor => anchor.onclick = event => {
      event.preventDefault();
      clicked.push(anchor.href);
      renderNote(anchor.href);
    });
    manager = new XhsSessionManager(() => document);
  }
  function renderNote(url: string) {
    manager?.dispose();
    currentUrl = url;
    history.replaceState({}, '', url);
    document.body.innerHTML = `<div id="noteContainer"><h1 id="detail-title">合成笔记</h1><div id="detail-desc">合成正文</div><div class="scroller" style="overflow-y:auto"><div class="comments-el"><div class="list-container">${items()}</div></div></div></div>`;
    const scroller = document.querySelector<HTMLElement>('.scroller')!;
    Object.defineProperties(scroller, { clientHeight: { value: 500 }, scrollHeight: { value: 500 } });
    scroller.scrollBy = () => {};
    manager = new XhsSessionManager(() => document);
  }
  renderSearch();
  shared.tabs.get.mockImplementation(async (id: number) => {
    if (id !== 7) throw new Error('No tab with id: ' + id);
    return { id: 7, url: currentUrl, status: 'complete', active: true };
  });
  shared.tabs.query.mockImplementation(async (query?: { url?: string }) => {
    if (query?.url?.includes('search_result') && !currentUrl.includes('/search_result')) return [];
    return [{ id: 7, url: currentUrl, status: 'complete', active: true }];
  });
  shared.tabs.goBack.mockImplementation(async () => { backs++; renderSearch(); });
  shared.tabs.create.mockImplementation(() => { throw new Error('不允许创建标签'); });
  shared.tabs.update.mockImplementation(() => { throw new Error('不允许直接改URL'); });
  shared.tabs.sendMessage.mockImplementation(async (_id: number, raw: unknown) => {
    const request = RequestSchema.parse(raw);
    try { return buildOk(request.requestId, await manager!.handle(request)); }
    catch (error) { return buildError(request.requestId, toErrorPayload(error)); }
  });
  registerDiscoveryHandlers();
  const sender = { id: 'test', url: 'chrome-extension://test/sidepanel.html' };
  const parentJobId = crypto.randomUUID();
  const start = await handleBackgroundMessage(buildRequest('DISCOVERY_START', {
    jobId: parentJobId, productId: product.id, tabId: 7, direction: 'AI PPT', maxPosts: 1,
  }), sender);
  expect(start.ok, start.error?.message).toBe(true);

  let parent = await repos.getJob(parentJobId);
  for (let attempt = 0; attempt < 400 && parent?.discovery?.status !== 'completed' && parent?.discovery?.status !== 'paused'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    parent = await repos.getJob(parentJobId);
  }
  expect(parent?.discovery?.status, JSON.stringify(parent?.discovery)).toBe('completed');
  expect(parent?.discovery?.completedNoteKeys).toContain('xhs:' + noteId);
  const parentCheckpoint = {
    index: parent!.discovery!.index,
    completedNoteKeys: [...parent!.discovery!.completedNoteKeys!],
    comments: parent!.discovery!.comments,
    leads: parent!.discovery!.leads,
  };

  const wrongPost = await handleBackgroundMessage(buildRequest('DISCOVERY_REPROCESS_POST', {
    jobId: crypto.randomUUID(), parentJobId, postUrl: `https://www.xiaohongshu.com/explore/${otherNoteId}`,
  }), sender);
  expect(wrongPost.ok).toBe(false);
  expect(wrongPost.error?.code).toBe('PERMISSION_DENIED');

  const reprocessJobId = crypto.randomUUID();
  const reprocess = await handleBackgroundMessage(buildRequest('DISCOVERY_REPROCESS_POST', {
    jobId: reprocessJobId, parentJobId, postUrl: noteUrl,
  }), sender);
  expect(reprocess.ok, reprocess.error?.message).toBe(true);
  let child = await repos.getJob(reprocessJobId);
  for (let attempt = 0; attempt < 400 && child?.discovery?.status !== 'completed' && child?.discovery?.status !== 'paused'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    child = await repos.getJob(reprocessJobId);
  }
  expect(child?.discovery?.status, JSON.stringify(child?.discovery)).toBe('completed');
  expect(child?.discovery?.targets).toHaveLength(1);
  expect(child?.discovery?.targets?.[0]).toContain(noteId);
  expect(await repos.commentsForNote('xhs:' + noteId)).toHaveLength(1);
  expect(await db.analyses.count()).toBe(1);
  const parentAfter = await repos.getJob(parentJobId);
  expect(parentAfter?.discovery?.index).toBe(parentCheckpoint.index);
  expect(parentAfter?.discovery?.completedNoteKeys).toEqual(parentCheckpoint.completedNoteKeys);
  expect(parentAfter?.discovery?.comments).toBe(parentCheckpoint.comments);
  expect(parentAfter?.discovery?.leads).toBe(parentCheckpoint.leads);
  expect(clicked).toHaveLength(2);
  expect(backs).toBe(2);
  expect(shared.tabs.create).not.toHaveBeenCalled();
  expect(shared.tabs.update).not.toHaveBeenCalled();
}, 60000);
