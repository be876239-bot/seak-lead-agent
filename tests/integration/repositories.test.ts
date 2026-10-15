import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SeekLeadDb } from '../../src/storage/db';
import { Repositories } from '../../src/storage/repositories';
import type { Analysis, Comment, ProductProfile } from '../../src/domain/schemas';

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

const comment = (over: Partial<Comment> = {}): Comment => ({
  commentKey: 'xhs:note1:c1', noteKey: 'xhs:note1', platformCommentId: 'c1', parentKey: null,
  text: '这个题库多少钱', authorDisplayName: null, authorLocalKey: null, profileUrl: null,
  publishedText: '1天前 浙江', publishedAt: null, likeCount: null,
  capturedAt: '2026-10-15T00:00:00Z', identityQuality: 'strong', truncated: false, ...over,
});

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  id: crypto.randomUUID(), cacheKey: `k-${crypto.randomUUID().replace(/-/g, '')}`,
  productId: crypto.randomUUID(), profileVersion: 1, commentKey: 'xhs:note1:c1',
  contextHash: 'ctx00001', decision: {
    commentId: 'c001', relevance: 'direct', need: 'explicit', purchaseIntent: 'price_or_access',
    speakerRole: 'seeker', intentTarget: 'category', productFit: 'supported',
    needSummary: '问价', evidence: [{ sourceId: 'c001:text', quote: '这个题库多少钱' }],
    reason: '明确问价', uncertainty: null,
  },
  group: 'high_intent', modelId: 'qwen3.8-flash', promptVersion: 'comment-v1', ruleVersion: 'group-v1',
  createdAt: '2026-10-15T00:00:00Z', ...over,
});

describe('repositories', () => {
  let db: SeekLeadDb;
  let repo: Repositories;
  beforeEach(async () => {
    db = new SeekLeadDb(`test-${crypto.randomUUID()}`);
    repo = new Repositories(db);
  });

  it('重复 cacheKey 不重复存储', async () => {
    const a = analysis();
    expect(await repo.insertAnalysisIfAbsent(a)).toBe(true);
    expect(await repo.insertAnalysisIfAbsent(a)).toBe(false);
    expect(await db.analyses.where('cacheKey').equals(a.cacheKey).count()).toBe(1);
  });

  it('同一评论不同产品可分别分析', async () => {
    const p1 = await repo.createProduct({
      inputUrl: 'https://a.example/', finalUrl: 'https://a.example/', profile: profile(),
      sourceBlocks: [{ id: 's001', url: 'https://a.example/', text: 't', fetchedAt: '2026-10-15T00:00:00Z' }],
      modelId: 'qwen3.8-flash', promptVersion: 'profile-v1',
    });
    const p2 = await repo.createProduct({
      inputUrl: 'https://b.example/', finalUrl: 'https://b.example/', profile: profile(),
      sourceBlocks: [{ id: 's001', url: 'https://b.example/', text: 't', fetchedAt: '2026-10-15T00:00:00Z' }],
      modelId: 'qwen3.8-flash', promptVersion: 'profile-v1',
    });
    const c = comment();
    await repo.putComments([c]);
    await repo.insertAnalysisIfAbsent(analysis({ productId: p1.id }));
    await repo.insertAnalysisIfAbsent(analysis({ productId: p2.id }));
    expect(await db.analyses.where('[productId+commentKey]').equals([p1.id, c.commentKey]).count()).toBe(1);
    expect(await db.analyses.where('[productId+commentKey]').equals([p2.id, c.commentKey]).count()).toBe(1);
  });

  it('修改画像递增版本', async () => {
    const p = await repo.createProduct({
      inputUrl: 'https://a.example/', finalUrl: 'https://a.example/', profile: profile(),
      sourceBlocks: [], modelId: 'm', promptVersion: 'profile-v1',
    });
    const edited = await repo.applyUserEdit(p.id, {
      price: { value: '99 元', status: 'user_edited', evidence: [] },
    });
    expect(edited.profileVersion).toBe(2);
    expect(edited.profile.price.status).toBe('user_edited');
  });

  it('失败事务无部分成功', async () => {
    await repo.addBatches([{
      id: 'batch-1', jobId: crypto.randomUUID(), index: 0, status: 'running',
      cacheKeys: [], commentKeys: [], attemptCount: 1, inputHash: 'hash0001',
      startedAt: null, completedAt: null, errorCode: null,
    }]);
    const good = analysis();
    const broken = analysis({ id: good.id });
    await expect(repo.commitBatch({
      batchId: 'batch-1', analyses: [good, broken],
      usage: [{ id: crypto.randomUUID(), jobId: 'j', batchId: 'batch-1', attemptIndex: 0, status: 'success', modelId: 'm', inputTokens: null, outputTokens: null, estimatedCny: null, priceVerifiedAt: null, durationMs: 100, createdAt: '2026-10-15T00:00:00Z' }],
    })).rejects.toThrow();
    expect(await db.analyses.count()).toBe(0);
    expect(await db.usage.count()).toBe(0);
    const batch = await db.batches.get('batch-1');
    expect(batch?.status).toBe('running');
  });

  it('锁：两窗口只有一个成功；过期旧 owner 不能续租', async () => {
    const got = await repo.acquireLock('ai-task', 'owner-A', 'job-1', 60_000);
    expect(got).not.toBeNull();
    expect(await repo.acquireLock('ai-task', 'owner-B', 'job-2', 60_000)).toBeNull();
    expect(await repo.renewLock('ai-task', 'owner-B', got!.generation, 60_000)).toBe(false);
    expect(await repo.renewLock('ai-task', 'owner-A', got!.generation - 1, 60_000)).toBe(false);
    expect(await repo.renewLock('ai-task', 'owner-A', got!.generation, 60_000)).toBe(true);
    expect(await repo.releaseLock('ai-task', 'owner-A', got!.generation)).toBe(true);
    expect((await repo.acquireLock('ai-task', 'owner-B', 'job-2', -1))?.generation).toBe(got!.generation + 1);
    const recovered = await repo.markInterruptedOnRecovery();
    expect(Array.isArray(recovered)).toBe(true);
  });
});
