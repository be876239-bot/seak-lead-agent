// @vitest-environment-options {"url": "https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa"}
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRequest, RequestSchema, SnapshotPayload, XhsStatusPayload } from '../../src/messaging/protocol';
import { LIMITS } from '../../src/domain/limits';
import { XhsSessionManager } from '../../src/xhs/session';

const NOTE_ID = 'a'.repeat(24);
const NOTE_KEY = `xhs:${NOTE_ID}`;

let clock = 1_760_000_000_000;
let manager: XhsSessionManager;

function useFixture(name: string) {
  document.body.innerHTML = readFileSync(`tests/fixtures/xhs/${name}.html`, 'utf8');
}

function parentCommentHtml(id: string, text: string, author = 'anonuser9'): string {
  return `<div class="parent-comment"><div id="${id}" class="comment-item"><div class="comment-inner-container"><div class="right">`
    + `<div class="author-wrapper"><div class="author"><a href="/user/profile/${author}" class="name">${author}</a></div></div>`
    + `<div class="content"><span class="note-text">${text}</span></div>`
    + `<div class="info"><div class="date"><span>2天前</span><span class="location">北京</span></div></div>`
    + `</div></div></div></div>`;
}

function synthPageHtml(n: number, charLen = 5): string {
  const items = Array.from({ length: n }, (_, i) =>
    parentCommentHtml(`comment-${String(i + 1).padStart(4, '0')}`, '字'.repeat(charLen))).join('');
  return `<div id="noteContainer"><div class="note-container"><h1 id="detail-title" class="title">测试笔记</h1>`
    + `<div id="detail-desc"><span class="note-text">正文内容</span></div>`
    + `<div class="comments-el"><div class="comments-container"><div class="total">共 ${n} 条评论</div>`
    + `<div class="list-container">${items}</div></div></div></div></div>`;
}

function listContainer(): Element {
  const el = document.querySelector('#noteContainer .comments-el .list-container');
  if (!el) throw new Error('list container missing in test page');
  return el;
}

async function flushMutations() {
  await Promise.resolve();
  await Promise.resolve();
}

async function settle() {
  await flushMutations();
  await vi.advanceTimersByTimeAsync(LIMITS.observerDebounceMs + 10);
}

async function handle(type: Parameters<typeof buildRequest>[0], payload: object) {
  const req = buildRequest(type, payload);
  return manager.handle(RequestSchema.parse(req));
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_760_000_000_000;
  history.replaceState({}, '', `/explore/${NOTE_ID}`);
  manager = new XhsSessionManager(() => document, () => clock);
});

afterEach(() => {
  manager.dispose();
  vi.useRealTimers();
});

async function startOn(fixtureOrHtml: string, expectedNoteKey = NOTE_KEY) {
  if (fixtureOrHtml.startsWith('<!') || fixtureOrHtml.includes('<div')) document.body.innerHTML = fixtureOrHtml;
  else useFixture(fixtureOrHtml);
  return (await handle('XHS_START_SESSION', { expectedNoteKey })) as SnapshotPayload;
}

describe('XHS_GET_STATUS', () => {
  it('笔记页 supported，noteKey 为稳定 ID', async () => {
    useFixture('note-detail-expanded');
    const status = XhsStatusPayload.parse(await handle('XHS_GET_STATUS', {}));
    expect(status.supported).toBe(true);
    expect(status.blocked).toBe(false);
    expect(status.noteKey).toBe(NOTE_KEY);
    expect(status.parserVersion).toBe('xhs-dom-v1');
  });
  it('信息流页 unsupported、noteKey=null、不采集', async () => {
    useFixture('feed-only');
    const status = XhsStatusPayload.parse(await handle('XHS_GET_STATUS', {}));
    expect(status).toMatchObject({ supported: false, blocked: false, noteKey: null });
  });
  it('登录遮挡页 blocked', async () => {
    document.body.innerHTML = '<div class="login-container"><span>扫码登录</span></div>';
    const status = XhsStatusPayload.parse(await handle('XHS_GET_STATUS', {}));
    expect(status.blocked).toBe(true);
  });
});

describe('XHS_START_SESSION', () => {
  it('真实 fixture：返回快照并满足 SnapshotPayload；纯图片评论无文本被跳过', async () => {
    const snap = await startOn('note-detail-expanded');
    const parsed = SnapshotPayload.parse(snap);
    expect(parsed.noteKey).toBe(NOTE_KEY);
    // 28 条已加载评论中 2 条为纯图片（note-text 仅含 img），无文本可分析
    expect(parsed.comments).toHaveLength(26);
    expect(parsed.comments.every((c) => c.text.trim().length > 0)).toBe(true);
    expect(parsed.hasMoreLoaded).toBe(false);
    expect(parsed.truncated).toBe(false);
    expect(parsed.note?.title.length).toBeGreaterThan(0);
    expect(parsed.comments.every((c) => c.identityQuality === 'strong')).toBe(true);
  });
  it('先打码再暂存：正文中的手机号进缓冲前已掩码', async () => {
    const html = synthPageHtml(0)
      .replace('<div class="list-container"></div>',
        `<div class="list-container">${parentCommentHtml('comment-0001', '需要的话加 13800138000 聊')}</div>`);
    const snap = await startOn(html);
    expect(snap.comments[0]!.text).toContain('【已脱敏】');
    expect(snap.comments[0]!.text).not.toContain('13800138000');
  });
  it('expectedNoteKey 不符 → PAGE_CHANGED', async () => {
    await expect(startOn('note-detail-expanded', 'xhs:zzzz'))
      .rejects.toMatchObject({ code: 'PAGE_CHANGED' });
  });
  it('遮挡页面拒绝启动', async () => {
    document.body.innerHTML = '<div class="login-container"></div>';
    await expect(handle('XHS_START_SESSION', { expectedNoteKey: NOTE_KEY }))
      .rejects.toMatchObject({ code: 'PAGE_BLOCKED' });
  });
});

describe('增量采集（observer + 防抖）', () => {
  it('用户手动加载的评论在 500ms 防抖后进入缓冲；虚拟列表移除不丢失', async () => {
    const snap = await startOn(synthPageHtml(2));
    expect(snap.comments).toHaveLength(2);
    listContainer().insertAdjacentHTML('beforeend', parentCommentHtml('comment-9001', '新加的一条'));
    await settle();
    const next = await handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null });
    expect((next as SnapshotPayload).comments).toHaveLength(3);
    // 虚拟列表移除 DOM 节点后缓冲仍保留
    document.getElementById('comment-9001')!.remove();
    await settle();
    const after = await handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }) as SnapshotPayload;
    expect(after.comments).toHaveLength(3);
    // 反复渲染同一条（重新插回同一 id）不产生重复
    listContainer().insertAdjacentHTML('beforeend', parentCommentHtml('comment-9001', '新加的一条'));
    await settle();
    const deduped = await handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }) as SnapshotPayload;
    expect(deduped.comments).toHaveLength(3);
  });

  it('500 条上限：超出后停止增加并标记 truncated', async () => {
    const snap = await startOn(synthPageHtml(LIMITS.maxSessionComments + 3));
    expect(snap.comments).toHaveLength(LIMITS.maxSessionComments);
    expect(snap.truncated).toBe(true);
  });

  it('SPA 换帖：旧会话撤销，快照报 PAGE_CHANGED', async () => {
    const snap = await startOn(synthPageHtml(2));
    history.pushState({}, '', `/explore/${'c'.repeat(24)}`);
    document.body.innerHTML = synthPageHtml(1).replace('测试笔记', '另一篇笔记');
    await settle();
    await expect(handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }))
      .rejects.toMatchObject({ code: 'PAGE_CHANGED' });
    // 换帖后可为新笔记重新开会话
    const newKey = `xhs:${'c'.repeat(24)}`;
    history.pushState({}, '', `/explore/${'c'.repeat(24)}`);
    const fresh = await handle('XHS_START_SESSION', { expectedNoteKey: newKey }) as SnapshotPayload;
    expect(fresh.noteKey).toBe(newKey);
  });

  it('登录弹窗出现 → 会话停止，后续报 PAGE_BLOCKED', async () => {
    const snap = await startOn(synthPageHtml(2));
    document.body.insertAdjacentHTML('beforeend', '<div class="login-container"></div>');
    await settle();
    await expect(handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }))
      .rejects.toMatchObject({ code: 'PAGE_BLOCKED' });
  });
});

describe('心跳', () => {
  it('60 秒无面板消息自动结束；期间有消息则续命', async () => {
    const snap = await startOn(synthPageHtml(2));
    clock += 40_000;
    vi.advanceTimersByTime(40_000);
    await handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null });
    clock += 40_000;
    vi.advanceTimersByTime(40_000);
    const alive = await handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }) as SnapshotPayload;
    expect(alive.comments).toHaveLength(2);
    clock += 61_000;
    vi.advanceTimersByTime(61_000);
    await expect(handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
  });
});

describe('STOP 与 cursor', () => {
  it('STOP 后快照失效；未知 sessionId 报 SNAPSHOT_EXPIRED', async () => {
    const snap = await startOn(synthPageHtml(2));
    expect(await handle('XHS_STOP_SESSION', { sessionId: snap.sessionId })).toEqual({ stopped: true });
    await expect(handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
    await expect(handle('XHS_GET_SNAPSHOT', { sessionId: 'no-such', expectedNoteKey: NOTE_KEY, cursor: null }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
  });

  it('超过 1MB 分块返回；逐 cursor 翻页取全；单块不超过上限', async () => {
    const n = 300;
    const first = await startOn(synthPageHtml(n, 1500));
    const encoder = new TextEncoder();
    expect(encoder.encode(JSON.stringify(first)).length).toBeLessThanOrEqual(LIMITS.maxMessageBytes);
    expect(first.comments.length).toBeLessThan(n);
    expect(first.hasMoreLoaded).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    let cursor = first.nextCursor;
    let total = first.comments.length;
    const seenIds = new Set(first.comments.map((c) => c.commentKey));
    let guard = 0;
    while (cursor && guard++ < 20) {
      const page = await handle('XHS_GET_SNAPSHOT', { sessionId: first.sessionId, expectedNoteKey: NOTE_KEY, cursor }) as SnapshotPayload;
      expect(encoder.encode(JSON.stringify(page)).length).toBeLessThanOrEqual(LIMITS.maxMessageBytes);
      for (const c of page.comments) seenIds.add(c.commentKey);
      total += page.comments.length;
      cursor = page.nextCursor;
      if (!cursor) expect(page.hasMoreLoaded).toBe(false);
    }
    expect(total).toBe(n);
    expect(seenIds.size).toBe(n);
  });

  it('分页期间缓冲变化 → 旧 cursor 失效（SNAPSHOT_EXPIRED），从头重新获取一致', async () => {
    const first = await startOn(synthPageHtml(300, 1500));
    expect(first.nextCursor).not.toBeNull();
    listContainer().insertAdjacentHTML('beforeend', parentCommentHtml('comment-9100', '分页时新加载'));
    await settle();
    await expect(handle('XHS_GET_SNAPSHOT', { sessionId: first.sessionId, expectedNoteKey: NOTE_KEY, cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
    const restart = await handle('XHS_GET_SNAPSHOT', { sessionId: first.sessionId, expectedNoteKey: NOTE_KEY, cursor: null }) as SnapshotPayload;
    expect(restart.comments.length).toBeGreaterThan(0);
  });

  it('expectedNoteKey 与缓冲笔记不符 → PAGE_CHANGED，不拼接不同笔记快照', async () => {
    const snap = await startOn(synthPageHtml(2));
    await expect(handle('XHS_GET_SNAPSHOT', { sessionId: snap.sessionId, expectedNoteKey: 'xhs:other', cursor: null }))
      .rejects.toMatchObject({ code: 'PAGE_CHANGED' });
  });
});
