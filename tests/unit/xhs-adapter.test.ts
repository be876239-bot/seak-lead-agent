import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { detectPage, parseLoadedComments, parseNote } from '../../src/xhs/adapter';
import { PARSER_VERSION } from '../../src/xhs/selectors';

function load(name: string): Document {
  const html = readFileSync(`tests/fixtures/xhs/${name}.html`, 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

const NOTE_KEY = 'xhs:' + 'a'.repeat(24);

describe('detectPage', () => {
  it('笔记详情（展开/折叠/无评论/弹层+背后信息流）均为 note', () => {
    for (const f of ['note-detail-expanded', 'note-detail-collapsed', 'note-detail-no-comments', 'page-overlay-with-feed']) {
      expect(detectPage(load(f)), f).toBe('note');
    }
  });
  it('纯信息流页面 unsupported', () => {
    expect(detectPage(load('feed-only'))).toBe('unsupported');
  });
  it('错误页不解析为笔记', () => {
    expect(['unsupported', 'blocked']).toContain(detectPage(load('error-page-404')));
  });
});

describe('parseLoadedComments — note-detail-expanded', () => {
  const comments = parseLoadedComments(load('note-detail-expanded'), NOTE_KEY);

  it('10 顶层 + 18 子评论，共 28 条', () => {
    expect(comments).toHaveLength(28);
    expect(comments.filter((c) => !c.isSub)).toHaveLength(10);
    expect(comments.filter((c) => c.isSub)).toHaveLength(18);
  });

  it('顶层评论 comment-0001 字段逐项正确', () => {
    const top = comments.find((c) => c.elementId === 'comment-0001')!;
    expect(top.platformCommentId).toBe('0001');
    expect(top.parentElementId).toBeNull();
    expect(top.text).toContain('我们也有这个需求');
    expect(top.authorDisplayName).toBe('anonuser2');
    expect(top.profileUrl).toBe('/user/profile/anonuser2');
    expect(top.authorLocalKey).toBe('anonuser2');
    expect(top.publishedText).toBe('2天前');
    expect(top.locationText).toBe('江苏');
    expect(top.likeCount).toBe(5);
    expect(top.replyCount).toBe(5);
    expect(top.isAuthorReply).toBe(false);
    expect(top.truncated).toBe(false);
    expect(top.noteKey).toBe(NOTE_KEY);
  });

  it('作者回复子评论：父子对应、“作者”标记、赞/回复占位文本不产生数字', () => {
    const sub = comments.find((c) => c.elementId === 'comment-0002')!;
    expect(sub.isSub).toBe(true);
    expect(sub.parentElementId).toBe('comment-0001');
    expect(sub.isAuthorReply).toBe(true);
    expect(sub.text).toBe('可以聊聊');
    expect(sub.likeCount).toBeNull();
    expect(sub.replyCount).toBeNull();
  });

  it('每条子评论的 parentElementId 都指向已解析的顶层评论', () => {
    const topIds = new Set(comments.filter((c) => !c.isSub).map((c) => c.elementId));
    for (const c of comments.filter((x) => x.isSub)) {
      expect(c.parentElementId, c.elementId ?? '').not.toBeNull();
      expect(topIds.has(c.parentElementId), c.elementId ?? '').toBe(true);
    }
  });
});

describe('parseLoadedComments — 其他 fixture', () => {
  it('折叠态：10 顶层 + 8 子', () => {
    const comments = parseLoadedComments(load('note-detail-collapsed'), NOTE_KEY);
    expect(comments.filter((c) => !c.isSub)).toHaveLength(10);
    expect(comments.filter((c) => c.isSub)).toHaveLength(8);
  });

  it('无评论页返回空数组且不报错', () => {
    expect(parseLoadedComments(load('note-detail-no-comments'), NOTE_KEY)).toEqual([]);
  });

  it('X01：弹层解析恰好 28 条，背后 30 张信息流卡片零混入', () => {
    const comments = parseLoadedComments(load('page-overlay-with-feed'), NOTE_KEY);
    expect(comments).toHaveLength(28);
    for (const c of comments) {
      expect(c.elementId).toMatch(/^comment-\d{4}$/);
    }
  });

  it('缺评论根容器时报 PARSE_FAILED，绝不退化为全页抓取', async () => {
    expect(() => parseLoadedComments(load('feed-only'), NOTE_KEY)).toThrowError(
      expect.objectContaining({ name: 'AppError' }) as never,
    );
    try {
      parseLoadedComments(load('feed-only'), NOTE_KEY);
    } catch (err) {
      expect(err).toMatchObject({ code: 'PARSE_FAILED' });
    }
  });
});

describe('parseNote', () => {
  const url = `https://www.xiaohongshu.com/explore/${'a'.repeat(24)}`;

  function withUrl(name: string): Document {
    const html = readFileSync(`tests/fixtures/xhs/${name}.html`, 'utf8');
    return new JSDOM(html, { url }).window.document;
  }

  it('从真实 URL 解析 noteId/noteKey/标题/正文', () => {
    const note = parseNote(withUrl('note-detail-expanded'));
    expect(note.noteId).toBe('a'.repeat(24));
    expect(note.noteKey).toBe(NOTE_KEY);
    expect(note.sourceUrl).toBe(url);
    expect(note.title.length).toBeGreaterThan(0);
    expect(note.bodyExcerpt.length).toBeGreaterThan(0);
    expect(note.parserVersion).toBe(PARSER_VERSION);
  });

  it('正文超长截断', () => {
    const dom = new JSDOM(
      `<div id="noteContainer"><h1 id="detail-title">t</h1><div id="detail-desc"><span class="note-text">${'长'.repeat(13000)}</span></div></div>`,
      { url },
    );
    const note = parseNote(dom.window.document);
    expect(note.bodyTruncated).toBe(true);
    expect(note.bodyExcerpt.length).toBeLessThanOrEqual(12000);
  });

  it('noteId 取路径稳定 ID，不把 xsec_token 等跟踪参数当 ID', () => {
    const tracked = `${url}?xsec_token=abcdef0123456789abcdef0123456789&xsec_source=pc_feed`;
    const html = readFileSync('tests/fixtures/xhs/note-detail-expanded.html', 'utf8');
    const doc = new JSDOM(html, { url: tracked }).window.document;
    const note = parseNote(doc);
    expect(note.noteId).toBe('a'.repeat(24));
    expect(note.noteKey).toBe(NOTE_KEY);
    expect(note.noteKey).not.toContain('xsec');
  });

  it('信息流页（无详情结构）报 PARSE_FAILED，不虚构笔记', () => {
    expect(() => parseNote(load('feed-only'))).toThrowError(
      expect.objectContaining({ name: 'AppError' }) as never,
    );
    try {
      parseNote(load('feed-only'));
    } catch (err) {
      expect(err).toMatchObject({ code: 'PARSE_FAILED' });
    }
  });
});
