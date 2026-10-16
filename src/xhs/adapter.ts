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
  /** 只在解析内存使用，不进入消息、数据库或AI。 */
  sourceElement: Element;
  elementId: string | null;
  platformCommentId: string | null;
  noteKey: string;
  parentElementId: string | null;
  parentElement: Element | null;
  parentContainer: Element | null;
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

const NOTE_ID_RE = /\/(?:explore|search_result|item|discovery\/item)\/([0-9a-z]{24})/;

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

/** 字段必须属于这一条评论，不能误读嵌套回复的作者/正文。 */
function owned(el:Element,selector:string):Element|null {
  return [...el.querySelectorAll(selector)].find(node=>node.closest('.comment-item')===el)??null;
}
export function rootComment(wrapper:Element):Element|null {
  return [...wrapper.querySelectorAll(SEL.commentItem)].find(el=>el.closest(SEL.parentWrapper)===wrapper)??null;
}
function parseItem(el: Element, noteKey: string, isSub: boolean, parentElementId: string | null, parentElement: Element | null = null, parentContainer: Element | null = null): ParsedComment {
  const id=el.getAttribute('id')??'';
  const rawId = id.startsWith(SEL.commentIdAttrPrefix)&&id.length>SEL.commentIdAttrPrefix.length ? id : null;
  const platformCommentId = rawId ? rawId.slice(SEL.commentIdAttrPrefix.length) : null;
  const authorA = owned(el,SEL.authorLink);
  const name = (authorA?.textContent || '').trim();
  const href = authorA?.getAttribute('href') || null;
  const path = href ? /^\/user\/profile\/[^/?#]+/.exec(href)?.[0] ?? null : null;
  const profileUrl = path ? `https://www.xiaohongshu.com${path}` : null;
  const authorLocalKey = path ? path.split('/').pop() ?? null : null;
  const content = owned(el,SEL.content);
  let text = (content?.textContent || '').trim();
  // 图片可在已确认的.content内、但不在.note-text内；只保留占位，不读取图片或整页文字。
  const body=owned(el,'.content');
  if (!text && body && [...body.querySelectorAll('img,svg,canvas')].some(node=>node.closest('.comment-item')===el)) text = '[non-text-comment]';
  const truncated = text.length > LIMITS.maxCommentChars;
  text = text.slice(0, LIMITS.maxCommentChars);
  return {
    sourceElement: el,
    elementId: rawId,
    platformCommentId,
    noteKey,
    parentElementId,
    parentElement,
    parentContainer,
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
  return parseCommentSubtree(list,noteKey);
}

/** 调用方必须先证明scope来自已确认列表；也用于MutationRecord中刚移除的子树。 */
export function parseCommentSubtree(scope:Element,noteKey:string):ParsedComment[] {
  const out: ParsedComment[] = [];
  const seen = new Set<Element>();

  // 不再假设每个评论永远是 parent-comment 的直接子节点。
  // 虚拟列表重渲染时包装层/评论层可能短暂改变；只要 comment-item
  // 仍位于已确认的 listContainer 内，就解析它。范围仍严格限制在评论列表，
  // 不做全页文本兜底，也不会把互动区的元素当评论。
  const selector=`${SEL.commentItem},${SEL.subCommentItem}`;
  const elements=[...(scope.matches(selector)?[scope]:[]),...scope.querySelectorAll(selector)];
  for (const el of elements) {
    if (seen.has(el)) continue;
    seen.add(el);
    const isSub = el.classList.contains('comment-item-sub');
    const wrapper = el.closest(SEL.parentWrapper);
    const top = wrapper ? rootComment(wrapper) : null;
    if (!isSub) {
      out.push(parseItem(el, noteKey, false, null, null, wrapper));
      continue;
    }
    // 回复可以在父评论 DOM 被虚拟列表移除后继续存在；保留 wrapper 引用，
    // 让 session 层用本次会话已经确认的父键恢复 parentKey。
    out.push(parseItem(el, noteKey, true, top?.getAttribute('id') ?? null, top, wrapper));
  }
  return out;
}

/** 只接受历史fixture证实的回复容器.show-more及明确展开文案，绝不点击.interactions里的“回复”。 */
export function replyExpandControls(doc: Document): {control:HTMLElement;parent:Element}[] {
  const list=doc.querySelector(SEL.listContainer);if(!list)return [];
  const found:{control:HTMLElement;parent:Element}[]=[];
  for(const wrapper of list.querySelectorAll(SEL.parentWrapper)) {
    const parent=rootComment(wrapper)??wrapper;
    for(const control of wrapper.querySelectorAll<HTMLElement>(`${SEL.replyContainer} ${SEL.showMore}`)) {
      if(control.closest(SEL.parentWrapper)!==wrapper || control.closest('.interactions,form') || control.hasAttribute('href') || control.hasAttribute('disabled') || control.getAttribute('aria-disabled')==='true')continue;
      const text=(control.textContent??'').replace(/\s+/g,' ').trim();
      if(!/^(?:展开\s*(?:\d+\s*条|全部|更多)?|查看\s*(?:全部|更多)|加载\s*更多)\s*回复$/.test(text))continue;
      let visible=true;
      for(let node:Element|null=control;node;node=node.parentElement){const style=doc.defaultView?.getComputedStyle(node);if(node.hasAttribute('hidden')||node.getAttribute('aria-hidden')==='true'||style?.display==='none'||style?.visibility==='hidden'){visible=false;break;}}
      if(visible)found.push({control,parent});
    }
  }
  return found;
}
