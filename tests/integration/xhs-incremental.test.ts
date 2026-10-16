// @vitest-environment-options {"url":"https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa"}
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppError, toErrorPayload } from '../../src/domain/errors';
import type { Comment, Note } from '../../src/domain/schemas';
import { buildError, buildOk, RequestSchema } from '../../src/messaging/protocol';
import { XhsSessionManager } from '../../src/xhs/session';
import { SeekLeadDb } from '../../src/storage/db';
import { Repositories } from '../../src/storage/repositories';

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock('wxt/browser', () => ({ browser: { tabs: { sendMessage } } }));
const { captureNote } = await import('../../src/xhs/capture');
let manager: XhsSessionManager;
let db: SeekLeadDb;
let repos: Repositories;
let scroll: ReturnType<typeof vi.fn>;
let jobId: string;

function items(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const id = start + i;
    return `<div class="parent-comment"><div class="comment-item" id="comment-${id}"><div class="author"><a class="name" href="/user/profile/synthetic-${id}">合成用户</a></div><div class="content"><span class="note-text">合成评论${id}</span></div></div></div>`;
  }).join('');
}
function replace(start: number, end: number) {
  document.querySelector('.list-container')!.innerHTML = items(start, end);
}
const wait = async () => { await Promise.resolve(); };
const persist = async (note: Note, comments: Comment[]) => repos.saveCaptureDelta(jobId, note, comments, new AbortController().signal);

beforeEach(async () => {
  document.body.innerHTML = `<div id="noteContainer"><h1 id="detail-title">合成懒加载测试</h1><div id="detail-desc"><span class="note-text">非真实评论</span></div><div class="note-scroller" style="overflow-y:auto"><div class="comments-el"><div class="list-container">${items(1,20)}</div></div></div></div>`;
  const container = document.querySelector<HTMLElement>('.note-scroller')!;
  Object.defineProperties(container, { clientHeight: { value: 500, configurable: true }, scrollHeight: { value: 5000, configurable: true } });
  scroll = vi.fn();
  container.scrollBy = scroll;
  manager = new XhsSessionManager(() => document);
  db = new SeekLeadDb(`incremental-${crypto.randomUUID()}`);
  repos = new Repositories(db);
  jobId = crypto.randomUUID();
  await repos.createJob({
    id: jobId, kind: 'comments', status: 'collecting', ownerId: 'test', generation: 0,
    productId: null, profileVersion: null, tabId: 7, noteKey: null, provider: 'mock', modelId: 'mock', promptVersion: 'unchanged',
    totalItems: 0, completedItems: 0, failedItems: 0, errorCode: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  sendMessage.mockReset();
  sendMessage.mockImplementation(async (_tab, req) => {
    try { return buildOk(req.requestId, await manager.handle(RequestSchema.parse(req))); }
    catch (err) { return buildError(req.requestId, toErrorPayload(err)); }
  });
});
afterEach(() => { manager.dispose(); db.close(); });

it('A–E：首屏20→21–40替换DOM，滚动前已落库，最终1–40全保留且重复不重复保存', async () => {
  let firstStored = false;
  let storedCount = 0;
  scroll.mockImplementation(() => {
    firstStored = firstStored || storedCount >= 20;
    replace(21, 40);
  });
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: async (note, comments) => {
    await persist(note, comments); storedCount = await db.comments.count();
  } });
  expect(firstStored).toBe(true);
  expect(result.comments).toHaveLength(40);
  expect(await db.comments.count()).toBe(40);
  expect((await db.comments.toArray()).map((c) => c.platformCommentId).sort()).toEqual(Array.from({length:40},(_,i)=>String(i+1)).sort());
  expect(document.querySelector('#comment-1')).toBeNull();
});

it('F：多轮未新增才停止，不把暂未新增标为全部采集', async () => {
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: persist });
  expect(scroll.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(result.stopReason).toBe('no_new');
  expect(result.comments).toHaveLength(20);
});

it('网络延迟：第二轮后才出现新评论，仍继续累计', async () => {
  scroll.mockImplementation(() => { if (scroll.mock.calls.length === 3) replace(21, 40); });
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: persist });
  expect(result.comments).toHaveLength(40);
});

it('G：等待期间取消会STOP，已保存首屏保留，后续DOM不再写入', async () => {
  const ac = new AbortController();
  await expect(captureNote(7, { autoLoad: true, signal: ac.signal,
    wait: async () => { ac.abort(); replace(21,40); await wait(); }, onDelta: persist,
  })).rejects.toMatchObject({ code: 'CANCELLED' });
  const count = await db.comments.count();
  replace(41,60); await wait();
  expect(await db.comments.count()).toBe(count);
  expect(count).toBe(20);
  expect(sendMessage.mock.calls.at(-1)![1].type).toBe('XHS_STOP_SESSION');
});

it('H：达到500立即停止，保留500条且不继续滚动', async () => {
  scroll.mockImplementation(() => { const start = scroll.mock.calls.length * 20 + 1; replace(start, start+19); });
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: persist });
  expect(result.stopReason).toBe('limit');
  expect(result.comments).toHaveLength(500);
  expect(await db.comments.count()).toBe(500);
  expect(scroll.mock.calls.length).toBe(24);
});

it('I：评论容器消失报明确错误并STOP，保留此前落库数据', async () => {
  scroll.mockImplementation(() => document.querySelector('.comments-el')!.remove());
  await expect(captureNote(7, { autoLoad: true, wait, onDelta: persist })).rejects.toMatchObject({ code: 'PARSE_FAILED' });
  expect(await db.comments.count()).toBe(20);
  expect(sendMessage.mock.calls.at(-1)![1].type).toBe('XHS_STOP_SESSION');
});

it('遇登录遮挡报告平台限制，不继续滚动', async () => {
  scroll.mockImplementation(() => document.body.insertAdjacentHTML('beforeend','<div class="login-container">登录限制</div>'));
  await expect(captureNote(7, { autoLoad: true, wait, onDelta: persist })).rejects.toMatchObject({ code: 'PAGE_BLOCKED' });
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('拒绝把换帖后的评论混入旧笔记', async () => {
  scroll.mockImplementation(() => history.replaceState({}, '', '/explore/bbbbbbbbbbbbbbbbbbbbbbbb'));
  try {
    await expect(captureNote(7, { autoLoad: true, wait, onDelta: persist })).rejects.toMatchObject({ code: 'PAGE_CHANGED' });
    expect(await db.comments.count()).toBe(20);
  } finally { history.replaceState({}, '', '/explore/aaaaaaaaaaaaaaaaaaaaaaaa'); }
});

it('落库失败不能继续滚动或伪报成功', async () => {
  await expect(captureNote(7, { autoLoad: true, wait, onDelta: async () => { throw new AppError('STORAGE_ERROR', '模拟写入失败'); } }))
    .rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  expect(scroll).not.toHaveBeenCalled();
});

it('无平台ID/作者/时间的同一DOM评论，重复取样不膨胀为重复评论', async () => {
  document.querySelector('.list-container')!.innerHTML = '<div class="comment-item"><div class="content"><span class="note-text">没有身份信息的合成评论</span></div></div>';
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: persist });
  expect(result.comments).toHaveLength(1);
  expect(await db.comments.count()).toBe(1);
  expect(result.comments[0]!.identityQuality).toBe('weak');
});

it('明确空评论标志停止且不滚动；不伪造加载成功', async () => {
  document.querySelector('.comments-el')!.innerHTML = '<div class="no-comments">暂无评论</div>';
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: persist });
  expect(result.stopReason).toBe('no_more');
  expect(scroll).not.toHaveBeenCalled();
  expect(result.comments).toHaveLength(0);
});

it('实时进度区分发现数、本轮新增、加载中与未确认全部', async () => {
  const progress = vi.fn();
  scroll.mockImplementationOnce(() => replace(21,40));
  await captureNote(7, { autoLoad: true, wait, onDelta: persist, onProgress: progress });
  expect(progress.mock.calls.some(([p]) => p.loading && p.discoveredCount === 40 && p.addedCount === 20)).toBe(true);
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ loading: false, stopReason: 'no_new', discoveredCount: 40 });
});

it('未知滚动容器报错，不滚动背后信息流，已保存首屏保留', async () => {
  document.querySelector<HTMLElement>('.note-scroller')!.style.overflowY = 'visible';
  await expect(captureNote(7, { autoLoad: true, wait, onDelta: persist })).rejects.toMatchObject({ code: 'PARSE_FAILED' });
  expect(scroll).not.toHaveBeenCalled();
  expect(await db.comments.count()).toBe(20);
});

it('G持久化守卫：取消已落库的任务，迟到checkpoint不能再写评论', async () => {
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: persist });
  await repos.updateJob(jobId, { status: 'cancelled' });
  await expect(persist(result.note, [{ ...result.comments[0]!, commentKey: 'late-new-comment' }])).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(await db.comments.count()).toBe(20);
});

it('少量评论不足一屏仍可正常停止，不误报滚动容器缺失', async () => {
  Object.defineProperty(document.querySelector('.note-scroller')!, 'scrollHeight', { value: 500, configurable: true });
  const result = await captureNote(7, { autoLoad: true, wait, onDelta: persist });
  expect(result.stopReason).toBe('no_new');
  expect(result.comments).toHaveLength(20);
});
