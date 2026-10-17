import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildError, buildOk } from '../../src/messaging/protocol';
import type { Comment, Note } from '../../src/domain/schemas';
import { AppError } from '../../src/domain/errors';

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock('wxt/browser', () => ({ browser: { tabs: { sendMessage } } }));

const { captureNote } = await import('../../src/xhs/capture');
const { parseDisplayedCommentCount } = await import('../../src/xhs/adapter');

const NOTE_KEY = 'xhs:abcdef';
const TS = '2026-10-15T00:00:00Z';

const note: Note = {
  noteKey: NOTE_KEY, sourceUrl: 'https://www.xiaohongshu.com/explore/abcdef',
  title: '笔记标题', bodyExcerpt: '正文摘录', capturedAt: TS, parserVersion: 'xhs-v1',
};

function comment(id: string): Comment {
  return {
    commentKey: `${NOTE_KEY}:c${id}`, noteKey: NOTE_KEY, platformCommentId: null, parentKey: null,
    text: `评论${id}`, authorDisplayName: null, authorLocalKey: null, profileUrl: null,
    publishedText: null, publishedAt: null, likeCount: null,
    capturedAt: TS, identityQuality: 'weak', truncated: false,
  };
}

function snapshot(comments: Comment[], nextCursor: string | null, extra: Record<string, unknown> = {}) {
  return {
    sessionId: 's1', noteKey: NOTE_KEY, parserVersion: 'xhs-v1', capturedAt: TS,
    note, comments, hasMoreLoaded: false, truncated: false, nextCursor, ...extra,
  };
}

const statusOk = (over: Record<string, unknown> = {}) =>
  buildOk('r', { noteKey: NOTE_KEY, parserVersion: 'xhs-v1', supported: true, blocked: false, ...over });

type Handlers = Record<string, (req: { requestId: string; type: string }) => unknown>;

function route(handlers: Handlers): void {
  sendMessage.mockImplementation((_tabId: number, req: { requestId: string; type: string }) => {
    const h = handlers[req.type];
    return Promise.resolve(h
      ? h(req)
      : buildError(req.requestId, { code: 'UNKNOWN', message: '未路由', retryable: false }));
  });
}

beforeEach(() => { sendMessage.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('captureNote 采集编排', () => {
  it('采集中页面消息不返回，取消仍能立即终止等待并发送STOP', async () => {
    const ac = new AbortController();
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], null)),
      XHS_GET_SNAPSHOT: () => { queueMicrotask(() => ac.abort()); return new Promise(() => {}); },
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    await expect(captureNote(7, { autoLoad: true, signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sendMessage.mock.calls.at(-1)![1].type).toBe('XHS_STOP_SESSION');
  });

  it('页面消息超时有明确错误，不无限等待', async () => {
    vi.useFakeTimers();
    sendMessage.mockReturnValue(new Promise(() => {}));
    const assertion = expect(captureNote(7)).rejects.toMatchObject({ code: 'PARSE_FAILED', retryable: true });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });

  it('按 cursor 翻页汇总全部评论，结束后必发 STOP', async () => {
    let snapCalls = 0;
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], 'c2')),
      XHS_GET_SNAPSHOT: () => {
        snapCalls += 1;
        return snapCalls === 1
          ? buildOk('r', snapshot([comment('2')], 'c3'))
          : buildOk('r', snapshot([comment('3')], null));
      },
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    const cap = await captureNote(7);
    expect(cap.comments.map((c) => c.commentKey)).toEqual([
      `${NOTE_KEY}:c1`, `${NOTE_KEY}:c2`, `${NOTE_KEY}:c3`,
    ]);
    expect(cap.note.noteKey).toBe(NOTE_KEY);
    expect(cap.hasMoreLoaded).toBe(false);
    expect(cap.truncated).toBe(false);
    const types = sendMessage.mock.calls.map(([, req]) => (req as { type: string }).type);
    expect(types).toEqual(['XHS_GET_STATUS', 'XHS_START_SESSION', 'XHS_GET_SNAPSHOT', 'XHS_GET_SNAPSHOT', 'XHS_STOP_SESSION']);
  });

  it('翻页中途报错也执行 STOP；错误码原样抛出', async () => {
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], 'c2')),
      XHS_GET_SNAPSHOT: () => buildError('r', { code: 'SNAPSHOT_EXPIRED', message: '缓冲已变化', retryable: true }),
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    await expect(captureNote(7)).rejects.toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
    const types = sendMessage.mock.calls.map(([, req]) => (req as { type: string }).type);
    expect(types[types.length - 1]).toBe('XHS_STOP_SESSION');
  });

  it('blocked → PAGE_BLOCKED；unsupported → PAGE_UNSUPPORTED；均不建会话', async () => {
    route({ XHS_GET_STATUS: () => statusOk({ blocked: true, noteKey: null, supported: false }) });
    await expect(captureNote(7)).rejects.toMatchObject({ code: 'PAGE_BLOCKED' });

    route({ XHS_GET_STATUS: () => statusOk({ supported: false }) });
    await expect(captureNote(7)).rejects.toMatchObject({ code: 'PAGE_UNSUPPORTED' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('标签页不可达（消息抛错）→ PAGE_UNSUPPORTED 且可重试', async () => {
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    const err = await captureNote(99).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('PAGE_UNSUPPORTED');
    expect(err.retryable).toBe(true);
  });

  it('hasMoreLoaded 与 truncated 跨页取或；不谎称全部评论', async () => {
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], 'c2', { hasMoreLoaded: true })),
      XHS_GET_SNAPSHOT: () => buildOk('r', snapshot([comment('2')], null, { truncated: true, note: null })),
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    const cap = await captureNote(7);
    expect(cap.hasMoreLoaded).toBe(true);
    expect(cap.truncated).toBe(true);
    expect(cap.note.title).toBe('笔记标题');
  });

  it('reads only the verified comment total selector and supports 万 units', () => {
    document.body.innerHTML = '<div id="noteContainer"><div class="comments-el"><div class="total">共 1.2万 条评论</div></div></div>';
    expect(parseDisplayedCommentCount(document)).toBe(12000);
    document.querySelector('.total')!.textContent = '共 86 条评论';
    expect(parseDisplayedCommentCount(document)).toBe(86);
    document.querySelector('.total')!.textContent = '评论加载中';
    expect(parseDisplayedCommentCount(document)).toBeNull();
  });
});
