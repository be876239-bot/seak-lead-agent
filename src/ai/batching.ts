import { LIMITS } from '../domain/limits';
import type { Comment, Note, ProductProfile } from '../domain/schemas';
import { classificationOverheadChars } from '../privacy/ai-payload';

export type BatchCandidate = { comment: Comment; cacheKey: string };

export type PlannedBatch = {
  comments: Comment[];
  cacheKeys: string[];
  /** 本批评论+父评论文本字符数（不含 DTO 固定开销）。 */
  commentChars: number;
  /** 产品+笔记在 DTO 中的固定开销；runner 以 overheadChars+commentChars 作为总预算，保证规划条目全部进入。 */
  overheadChars: number;
};

export const commentEstimate = (c: Comment, parentLookup: Map<string, Comment>): number =>
  c.text.length + (c.parentKey ? parentLookup.get(c.parentKey)?.text.length ?? 0 : 0);

/**
 * 评论批次规划：先由调用方过滤已完成缓存，再按每批 ≤15 条且评论文本 ≤12,000 字符切分。
 * 单条（含父评论）超限时截断评论正文并标记 truncated；不因内容短或被关键词判定而丢弃任何候选。
 */
export function planCommentBatches(
  candidates: readonly BatchCandidate[],
  parentLookup: Map<string, Comment>,
  profile: ProductProfile,
  note: Note,
): PlannedBatch[] {
  const overheadChars = classificationOverheadChars(profile, note);
  const est = commentEstimate;
  const batches: PlannedBatch[] = [];
  let current: PlannedBatch | null = null;

  for (const cand of candidates) {
    let comment = cand.comment;
    if (est(comment, parentLookup) > LIMITS.maxBatchChars) {
      const parentChars = comment.parentKey ? parentLookup.get(comment.parentKey)?.text.length ?? 0 : 0;
      const keep = Math.max(1, LIMITS.maxBatchChars - parentChars);
      comment = { ...comment, text: comment.text.slice(0, keep), truncated: true };
    }
    const size = est(comment, parentLookup);
    if (current && (current.comments.length >= LIMITS.maxBatchItems || current.commentChars + size > LIMITS.maxBatchChars)) {
      batches.push(current);
      current = null;
    }
    if (!current) current = { comments: [], cacheKeys: [], commentChars: 0, overheadChars };
    current.comments.push(comment);
    current.cacheKeys.push(cand.cacheKey);
    current.commentChars += size;
  }
  if (current) batches.push(current);
  return batches;
}
