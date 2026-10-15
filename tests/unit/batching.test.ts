import { describe, expect, it } from 'vitest';
import { planCommentBatches, type BatchCandidate } from '../../src/ai/batching';
import { buildClassificationInput, classificationOverheadChars } from '../../src/privacy/ai-payload';
import { LIMITS } from '../../src/domain/limits';
import type { Comment, Note, ProductProfile } from '../../src/domain/schemas';

const profile = (): ProductProfile => ({
  schemaVersion: 1,
  name: { value: '备考题库', status: 'observed', evidence: [{ sourceId: 's001', quote: '备考题库' }] },
  category: { value: '题库', status: 'observed', evidence: [] },
  summary: { value: '练习网站', status: 'inferred', evidence: [] },
  capabilities: [], targetAudience: [], needsServed: [], exclusions: [],
  accessMethod: { value: '邀请码', status: 'observed', evidence: [] },
  price: { value: null, status: 'unknown', evidence: [] },
  purchaseChannel: { value: null, status: 'unknown', evidence: [] },
  searchSuggestions: [],
});

const note = (body = '分享一个考研题库使用体验'): Note => ({
  noteKey: 'xhs:note1', sourceUrl: 'https://www.xiaohongshu.com/explore/note1',
  title: '题库体验', bodyExcerpt: body, capturedAt: '2026-10-15T00:00:00Z', parserVersion: 'xhs-v1',
});

const comment = (i: number, text = '这个题库多少钱', over: Partial<Comment> = {}): Comment => ({
  commentKey: `xhs:note1:c${i}`, noteKey: 'xhs:note1', platformCommentId: `c${i}`, parentKey: null,
  text, authorDisplayName: null, authorLocalKey: null, profileUrl: null,
  publishedText: null, publishedAt: null, likeCount: null,
  capturedAt: '2026-10-15T00:00:00Z', identityQuality: 'strong', truncated: false, ...over,
});

const cands = (n: number, text?: string): BatchCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ comment: comment(i + 1, text ?? '这个题库多少钱'), cacheKey: `k${i}` }));

describe('planCommentBatches（T20）', () => {
  it('40 条短评论 → 15/15/10 三批', () => {
    const batches = planCommentBatches(cands(40), new Map(), profile(), note());
    expect(batches.map((b) => b.comments.length)).toEqual([15, 15, 10]);
  });

  it('每批评论文本不超过 12,000 字符（1000 字评论 → 每批 12 条）', () => {
    const long = '题'.repeat(1000);
    const batches = planCommentBatches(cands(30, long), new Map(), profile(), note());
    expect(batches.map((b) => b.comments.length)).toEqual([12, 12, 6]);
    for (const b of batches) expect(b.commentChars).toBeLessThanOrEqual(LIMITS.maxBatchChars);
  });

  it('父评论文本计入批次开销', () => {
    const parent = comment(900, '哈'.repeat(9000));
    const lookup = new Map([[parent.commentKey, parent]]);
    const kids = Array.from({ length: 5 }, (_, i) => ({
      comment: comment(i + 1, '多少钱？', { parentKey: parent.commentKey }),
      cacheKey: `k${i}`,
    }));
    const batches = planCommentBatches(kids, lookup, profile(), note());
    // 每条 est=4+9000=9004 → 每批最多 1 条
    expect(batches.length).toBe(5);
    expect(batches[0]!.commentChars).toBe(9004);
  });

  it('单条超限：截断正文并标记 truncated，独占一批', () => {
    const huge = '题'.repeat(LIMITS.maxBatchChars + 500);
    const batches = planCommentBatches(cands(1, huge), new Map(), profile(), note());
    expect(batches.length).toBe(1);
    expect(batches[0]!.comments.length).toBe(1);
    expect(batches[0]!.comments[0]!.text.length).toBe(LIMITS.maxBatchChars);
    expect(batches[0]!.comments[0]!.truncated).toBe(true);
    expect(batches[0]!.cacheKeys).toEqual(['k0']);
  });

  it('短评论不因“没有购买关键词”被丢弃：全部候选进入批次', () => {
    const shorts = ['+1', '求分享', '蹲', '多少钱？', '同问'].map((t, i) => ({ comment: comment(i + 1, t), cacheKey: `k${i}` }));
    const batches = planCommentBatches(shorts, new Map(), profile(), note());
    const total = batches.reduce((n, b) => n + b.comments.length, 0);
    expect(total).toBe(5);
    expect(batches.flatMap((b) => b.cacheKeys).sort()).toEqual(shorts.map((s) => s.cacheKey).sort());
  });

  it('无新评论（全部命中缓存）→ 0 批，即不调用 AI', () => {
    const list = cands(20);
    const cached = new Set(list.map((c) => c.cacheKey));
    const uncached = list.filter((c) => !cached.has(c.cacheKey));
    expect(planCommentBatches(uncached, new Map(), profile(), note())).toEqual([]);
  });

  it('规划批次与 DTO 一致：预算=overhead+commentChars 时全部条目进入 items', () => {
    const parent = comment(900, '楼主用的题库是哪一个呀，求个名字');
    const lookup = new Map([[parent.commentKey, parent]]);
    const list: BatchCandidate[] = Array.from({ length: 37 }, (_, i) =>
      i % 5 === 0
        ? { comment: comment(i + 1, '多少钱', { parentKey: parent.commentKey }), cacheKey: `k${i}` }
        : { comment: comment(i + 1, '这个题库适合考研吗，有没有论述题练习'), cacheKey: `k${i}` },
    );
    const p = profile();
    const n = note();
    const batches = planCommentBatches(list, lookup, p, n);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      const budget = b.overheadChars + b.commentChars;
      const { input, used } = buildClassificationInput(p, n, b.comments, lookup, budget);
      expect(input.items.length).toBe(b.comments.length);
      expect(input.idMap.length).toBe(b.comments.length);
      expect(used).toBeLessThanOrEqual(budget);
      expect(b.overheadChars).toBe(classificationOverheadChars(p, n));
    }
  });

  it('note 超长时开销按 maxNoteChars 计', () => {
    const n = note('长'.repeat(LIMITS.maxNoteChars + 1000));
    const batches = planCommentBatches(cands(2), new Map(), profile(), n);
    expect(batches[0]!.overheadChars).toBe(classificationOverheadChars(profile(), n));
    expect(batches[0]!.overheadChars).toBeLessThanOrEqual(
      classificationOverheadChars(profile(), n) + LIMITS.maxNoteChars,
    );
  });
});
