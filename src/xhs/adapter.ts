import { AppError } from '../domain/errors';
import { SEL, PARSER_VERSION } from './selectors';
import { LIMITS } from '../domain/limits';

export type ParsedNote = {
  noteId: string;
  noteKey: string;
  sourceUrl: string;
  title: string;
  bodyExcerpt: string;
  bodyTruncated: boolean;
  parserVersion: string;
};

export type ParsedComment = {
  elementId: string | null;
  platformCommentId: string | null;
  noteKey: string;
  parentElementId: string | null;
  text: string;
  authorDisplayName: string | null;
  authorLocalKey: string | null;
  profileUrl: string | null;
  publishedText: string | null;
  locationText: string | null;
  likeCount: number | null;
  replyCount: number | null;
  isAuthorReply: boolean;
  isSub: boolean;
  truncated: boolean;
};

const NOTE_ID_RE = /\/(?:explore|item|discovery\/item)\/([0-9a-z]{24})/;

export function detectPage(doc: Document): 'note' | 'unsupported' | 'blocked' {
  const root = doc.querySelector(SEL.noteRoot);
  if (!root) {
    if (doc.querySelector(SEL.loginOverlay)) return 'blocked';
    return 'unsupported';
  }
  if (!doc.querySelector(SEL.commentsArea) && doc.querySelector(SEL.loginOverlay)) return 'blocked';
  return 'note';
}

export function parseNote(doc: Document): ParsedNote {
  const url = doc.defaultView?.location.href || doc.URL || '';
  const m = NOTE_ID_RE.exec(url);
  const title = (doc.querySelector(SEL.noteTitle)?.textContent || '').trim();
  const body = (doc.querySelector(SEL.noteBody)?.textContent || '').trim();
  if (!m || (!title && !body)) {
    throw new AppError('PARSE_FAILED', '无法识别当前笔记标题/正文，可能页面结构已变化');
  }
  const noteId = m[1]!;
  const truncated = body.length > LIMITS.maxNoteChars;
  return {
    noteId,
    noteKey: `xhs:${noteId}`,
    sourceUrl: url,
    title: title.slice(0, 300),
    bodyExcerpt: body.slice(0, LIMITS.maxNoteChars),
    bodyTruncated: truncated,
    parserVersion: PARSER_VERSION,
  };
}

function countOf(text: string | null): number | null {
  if (!text) return null;
  const t = text.trim();
  if (!t || /^(赞|回复|分享)$/.test(t)) return null;
  const wan = /^(\d+(?:\.\d+)?)万$/.exec(t);
  if (wan) return Math.round(Number(wan[1]) * 10000);
  const num = /^(\d+)$/.exec(t);
  return num ? Number(num[1]) : null;
}

function parseItem(el: Element, noteKey: string, isSub: boolean, parentElementId: string | null): ParsedComment {
  const rawId = (el.getAttribute('id') || '').startsWith(SEL.commentIdAttrPrefix) ? el.getAttribute('id') : null;
  const platformCommentId = rawId ? rawId.slice(SEL.commentIdAttrPrefix.length) : null;
  const authorA = el.querySelector(SEL.authorLink);
  const name = (authorA?.textContent || '').trim();
  const href = authorA?.getAttribute('href') || null;
  const path = href ? /^\/user\/profile\/[^/?#]+/.exec(href)?.[0] ?? null : null;
  const profileUrl = path ? `https://www.xiaohongshu.com${path}` : null;
  const authorLocalKey = path ? path.split('/').pop() ?? null : null;
  let text = (el.querySelector(SEL.content)?.textContent || '').trim();
  const truncated = text.length > LIMITS.maxCommentChars;
  text = text.slice(0, LIMITS.maxCommentChars);
  return {
    elementId: rawId,
    platformCommentId,
    noteKey,
    parentElementId,
    text,
    authorDisplayName: name || null,
    authorLocalKey,
    profileUrl,
    publishedText: (el.querySelector(SEL.date)?.textContent || '').trim() || null,
    locationText: (el.querySelector(SEL.location)?.textContent || '').trim() || null,
    likeCount: countOf(el.querySelector(SEL.likeCount)?.textContent ?? null),
    replyCount: countOf(el.querySelector(SEL.replyCount)?.textContent ?? null),
    isAuthorReply: (el.querySelector(SEL.authorTag)?.textContent || '').includes('作者'),
    isSub,
    truncated,
  };
}

/** 只解析当前评论容器内已加载评论；找不到容器即失败，绝不退化为全页抓取。 */
export function parseLoadedComments(doc: Document, noteKey: string): ParsedComment[] {
  const area = doc.querySelector(SEL.commentsArea);
  if (!area) throw new AppError('PARSE_FAILED', '未找到评论容器，页面可能未加载完成或结构已变化');
  const list = area.querySelector(SEL.listContainer);
  if (!list) {
    if (area.querySelector(SEL.noComments)) return [];
    throw new AppError('PARSE_FAILED', '未找到评论列表容器');
  }
  const out: ParsedComment[] = [];
  for (const wrapper of list.querySelectorAll(':scope > .parent-comment')) {
    const top = wrapper.querySelector(':scope > .comment-item:not(.comment-item-sub)');
    if (!top) continue;
    out.push(parseItem(top, noteKey, false, null));
    for (const sub of wrapper.querySelectorAll(`${SEL.replyContainer} ${SEL.subCommentItem}`)) {
      out.push(parseItem(sub, noteKey, true, top.getAttribute('id')));
    }
  }
  // 少数页面顶层评论不在 .parent-comment 包装内
  for (const bare of list.querySelectorAll(':scope > .comment-item:not(.comment-item-sub)')) {
    out.push(parseItem(bare, noteKey, false, null));
  }
  return out;
}
