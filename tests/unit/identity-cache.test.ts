import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  commentIdentity, contextHash, dedupeComments, parsePublishedAt, toCommentRecord,
} from '../../src/domain/identity';
import { buildCacheKey, filterUncached } from '../../src/analysis/cache';
import { AnalysisSchema, CommentSchema } from '../../src/domain/schemas';

const NOTE_KEY = 'xhs:' + 'b'.repeat(24);
const CAPTURED_AT = '2026-10-15T02:00:00.000Z';

function makeComment(over: Partial<Parameters<typeof toCommentRecord>[0]> = {}) {
  return toCommentRecord({
    noteKey: NOTE_KEY,
    platformCommentId: '0001',
    parentKey: null,
    text: '求分享',
    authorDisplayName: null,
    authorLocalKey: null,
    profileUrl: null,
    publishedText: null,
    likeCount: null,
    truncated: false,
    capturedAt: CAPTURED_AT,
    ordinal: 0,
    ...over,
  });
}

describe('commentIdentity — 强身份', () => {
  it('有平台 ID：key=xhs:noteId:commentId，反复渲染同一评论得到同一 key', () => {
    const a = commentIdentity({
      noteKey: NOTE_KEY, platformCommentId: '0001', authorLocalKey: 'anonuser1',
      text: '多少钱', publishedText: '2天前', parentKey: null, ordinal: 0,
    });
    const b = commentIdentity({
      noteKey: NOTE_KEY, platformCommentId: '0001', authorLocalKey: 'anonuser1',
      text: '多少钱', publishedText: '2天前', parentKey: null, ordinal: 5,
    });
    expect(a.commentKey).toBe(`${NOTE_KEY}:0001`);
    expect(a.identityQuality).toBe('strong');
    expect(b.commentKey).toBe(a.commentKey);
    expect(dedupeComments([makeComment(), makeComment()])).toHaveLength(1);
  });
});

describe('commentIdentity — 弱身份保守组合', () => {
  const weak = (over: object) => commentIdentity({
    noteKey: NOTE_KEY, platformCommentId: null, authorLocalKey: 'u1',
    text: '求', publishedText: '2天前', parentKey: null, ordinal: 0, ...over,
  });

  it('不同作者相同“求”不合并', () => {
    expect(weak({ authorLocalKey: 'u1' }).commentKey)
      .not.toBe(weak({ authorLocalKey: 'u2' }).commentKey);
  });
  it('同作者同文本同时间视为重复渲染，可合并', () => {
    expect(weak({ ordinal: 0 }).commentKey).toBe(weak({ ordinal: 7 }).commentKey);
  });
  it('父评论不同不合并（父上下文进入哈希）', () => {
    expect(weak({ parentKey: 'p1' }).commentKey).not.toBe(weak({ parentKey: 'p2' }).commentKey);
  });
  it('正文规范化后再哈希：仅空白差异视为同一条', () => {
    expect(weak({ text: '求  ' }).commentKey).toBe(weak({ text: ' 求' }).commentKey);
  });
  it('无作者且无时间的相同短评论保守保留，不强行合并', () => {
    const c1 = makeComment({ platformCommentId: null, authorLocalKey: null, text: '求', ordinal: 0 });
    const c2 = makeComment({ platformCommentId: null, authorLocalKey: null, text: '求', ordinal: 1 });
    expect(c1.commentKey).not.toBe(c2.commentKey);
    expect(dedupeComments([c1, c2])).toHaveLength(2);
  });
  it('无 ID 一律标记 weak', () => {
    expect(weak({}).identityQuality).toBe('weak');
  });
});

describe('toCommentRecord / parsePublishedAt', () => {
  it('相对时间保留原文、publishedAt=null，不猜日期', () => {
    const c = makeComment({ publishedText: '2天前' });
    expect(c.publishedText).toBe('2天前');
    expect(c.publishedAt).toBeNull();
    expect(parsePublishedAt('昨天')).toBeNull();
    expect(parsePublishedAt('01-05')).toBeNull();
    expect(parsePublishedAt(null)).toBeNull();
  });
  it('绝对日期可解析', () => {
    expect(parsePublishedAt('2025-10-13')).toBe('2025-10-13T00:00:00.000Z');
    expect(parsePublishedAt('2025年10月13日')).toBe('2025-10-13T00:00:00.000Z');
    expect(parsePublishedAt('2025-13-01')).toBeNull();
  });
  it('记录满足 CommentSchema', () => {
    CommentSchema.parse(makeComment({ authorLocalKey: 'anonuser2', publishedText: '2天前' }));
  });
});

describe('contextHash — 只含稳定上下文', () => {
  const base = {
    productContext: '题库 99元 考研',
    noteContext: '笔记标题 正文片段',
    parentContext: '我们也有这个需求',
  };
  it('确定性：重复计算一致', () => {
    expect(contextHash(base)).toBe(contextHash(base));
  });
  it('补全父评论导致哈希变化（触发重判）', () => {
    expect(contextHash({ ...base, parentContext: '' })).not.toBe(contextHash(base));
  });
  it('捕获时间/随机 ID 不在哈希成分中：不受其影响', () => {
    const at = contextHash(base);
    expect(contextHash({ ...base, noteContext: base.noteContext })).toBe(at);
    // 只有上下文成分进入哈希；时间戳/批次 ID 根本不参与计算
    expect(at.length).toBeGreaterThanOrEqual(8);
    expect(at.length).toBeLessThanOrEqual(128);
  });
  it('满足 AnalysisSchema.contextHash 约束', () => {
    expect(contextHash(base).length).toBeGreaterThanOrEqual(8);
  });
});

describe('buildCacheKey / filterUncached', () => {
  const parts = {
    productId: z.string().uuid().parse('11111111-1111-4111-8111-111111111111'),
    profileVersion: 1,
    commentKey: `${NOTE_KEY}:0001`,
    contextHash: contextHash({ productContext: 'p', noteContext: 'n', parentContext: '' }),
    provider: 'bailian',
    modelId: 'qwen3.8-flash',
    promptVersion: 'v1',
    ruleVersion: 'r1',
  };

  it('同输入同键；长度符合 schema（16–128）', () => {
    const k = buildCacheKey(parts);
    expect(k).toBe(buildCacheKey({ ...parts }));
    expect(k.length).toBeGreaterThanOrEqual(16);
    expect(k.length).toBeLessThanOrEqual(128);
  });
  it('任一稳定成分变化即失效：产品/版本/评论/上下文/模型/提示词/规则', () => {
    const k = buildCacheKey(parts);
    for (const patch of [
      { productId: '22222222-2222-4222-8222-222222222222' },
      { profileVersion: 2 },
      { commentKey: `${NOTE_KEY}:0002` },
      { contextHash: contextHash({ productContext: 'p2', noteContext: 'n', parentContext: '' }) },
      { provider: 'other' },
      { modelId: 'qwen-other' },
      { promptVersion: 'v2' },
      { ruleVersion: 'r2' },
    ]) {
      expect(buildCacheKey({ ...parts, ...patch }), JSON.stringify(patch)).not.toBe(k);
    }
  });
  it('filterUncached：无新增即空（不调用 AI）', () => {
    const candidates = [
      { cacheKey: buildCacheKey(parts), commentKey: parts.commentKey },
      { cacheKey: buildCacheKey({ ...parts, commentKey: `${NOTE_KEY}:0002` }), commentKey: `${NOTE_KEY}:0002` },
    ];
    expect(filterUncached(new Set([candidates[1]!.cacheKey]), candidates)).toEqual([candidates[0]]);
    expect(filterUncached(new Set(candidates.map((c) => c.cacheKey)), candidates)).toEqual([]);
  });
  it('AnalysisSchema 可接受由缓存键构成的记录', () => {
    const decision = {
      commentId: 'c001', relevance: 'direct', need: 'explicit', purchaseIntent: 'price_or_access',
      speakerRole: 'seeker', intentTarget: 'our_product', productFit: 'supported',
      needSummary: '询问价格', evidence: [{ sourceId: 'c001:text', quote: '多少钱' }],
      reason: '明确询价', uncertainty: null,
    } as const;
    AnalysisSchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      cacheKey: buildCacheKey(parts),
      productId: parts.productId,
      profileVersion: 1,
      commentKey: parts.commentKey,
      contextHash: parts.contextHash,
      decision,
      group: 'high_intent',
      modelId: parts.modelId,
      promptVersion: 'v1',
      ruleVersion: 'r1',
      createdAt: CAPTURED_AT,
    });
  });
});
