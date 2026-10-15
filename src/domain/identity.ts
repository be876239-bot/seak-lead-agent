import type { Comment } from './schemas';

/** 非加密稳定 64 位哈希（cyrb53），确定性用于身份/缓存键，不用于安全场景。 */
export function hash64(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2246822507);
    h2 = Math.imul(h2 ^ ch, 3266489909);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 3266489909) ^ Math.imul(h1 ^ (h1 >>> 13), 2246822507);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function normalizeCommentText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export type CommentIdentityInput = {
  noteKey: string;
  platformCommentId: string | null;
  authorLocalKey: string | null;
  text: string;
  publishedText: string | null;
  parentKey: string | null;
  /** 无平台 ID 且作者/时间都缺失时的保守序号，避免不同评论被强行合并。 */
  ordinal: number;
};

export function commentIdentity(input: CommentIdentityInput): {
  commentKey: string;
  identityQuality: 'strong' | 'weak';
} {
  if (input.platformCommentId) {
    return {
      commentKey: `${input.noteKey}:${input.platformCommentId}`,
      identityQuality: 'strong',
    };
  }
  const base = [
    input.noteKey,
    input.authorLocalKey ?? '',
    normalizeCommentText(input.text),
    input.publishedText ?? '',
    input.parentKey ?? '',
  ].join('\u0001');
  let key = `${input.noteKey}:anon:${hash64(base)}`;
  if (!input.authorLocalKey && !input.publishedText) {
    key += `:${input.ordinal}`;
  }
  return { commentKey: key, identityQuality: 'weak' };
}

/** 平台时间为相对描述（“2天前”）或格式不可靠时返回 null，绝不猜日期。 */
export function parsePublishedAt(publishedText: string | null): string | null {
  if (!publishedText) return null;
  const m = /^(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s+\d{1,2}:\d{2})?$/.exec(publishedText.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

export function toCommentRecord(input: {
  noteKey: string;
  platformCommentId: string | null;
  parentKey: string | null;
  text: string;
  authorDisplayName: string | null;
  authorLocalKey: string | null;
  profileUrl: string | null;
  publishedText: string | null;
  likeCount: number | null;
  truncated: boolean;
  capturedAt: string;
  ordinal: number;
}): Comment {
  const identity = commentIdentity(input);
  return {
    commentKey: identity.commentKey,
    noteKey: input.noteKey,
    platformCommentId: input.platformCommentId,
    parentKey: input.parentKey,
    text: input.text,
    authorDisplayName: input.authorDisplayName,
    authorLocalKey: input.authorLocalKey,
    profileUrl: input.profileUrl,
    publishedText: input.publishedText,
    publishedAt: parsePublishedAt(input.publishedText),
    likeCount: input.likeCount,
    capturedAt: input.capturedAt,
    identityQuality: identity.identityQuality,
    truncated: input.truncated,
  };
}

/** commentKey 去重，保留首次出现；不同作者/保守序号条目不会被合并。 */
export function dedupeComments(comments: Comment[]): Comment[] {
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const c of comments) {
    if (seen.has(c.commentKey)) continue;
    seen.add(c.commentKey);
    out.push(c);
  }
  return out;
}

/**
 * 稳定上下文哈希：只含进入模型的稳定上下文（产品语义、笔记标题/正文片段、父评论文本）。
 * 不含捕获时间、批次 ID 等易变值；父评论补全会改变哈希，触发重判。
 */
export function contextHash(input: {
  productContext: string;
  noteContext: string;
  parentContext: string;
}): string {
  const join = (s: string) => normalizeCommentText(s).slice(0, 12000);
  return `ctx:${hash64([join(input.productContext), join(input.noteContext), join(input.parentContext)].join('\u0002'))}`;
}
