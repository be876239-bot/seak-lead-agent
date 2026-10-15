import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeekLeadDb } from '../../src/storage/db';
import { cutoffIso, purgeExpired } from '../../src/storage/retention';
import type { Analysis, Batch, Comment, Job, Note, Usage } from '../../src/domain/schemas';

const PID = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0); // 2026-10-16T12:00:00Z
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

let db: SeekLeadDb;

beforeEach(() => { db = new SeekLeadDb(`retention-${crypto.randomUUID()}`); });
afterEach(() => { db.close(); });

function note(key: string, ageMs: number): Note {
  return {
    noteKey: key, sourceUrl: `https://www.xiaohongshu.com/explore/${key}`,
    title: `笔记${key}`, bodyExcerpt: 'b', capturedAt: iso(ageMs), parserVersion: 'xhs-v1',
  };
}

function comment(key: string, noteKey: string, ageMs: number): Comment {
  return {
    commentKey: key, noteKey, platformCommentId: null, parentKey: null, text: `评论${key}`,
    authorDisplayName: null, authorLocalKey: null, profileUrl: null, publishedText: null, publishedAt: null,
    likeCount: null, capturedAt: iso(ageMs), identityQuality: 'weak', truncated: false,
  };
}

function analysis(id: string, commentKey: string): Analysis {
  return {
    id, cacheKey: `cache-${id}`.padEnd(20, 'x').slice(0, 28), productId: PID, profileVersion: 1,
    commentKey, contextHash: 'hhhhhhhh',
    decision: {
      commentId: 't', relevance: 'direct', need: 'explicit', purchaseIntent: 'explicit_buy',
      speakerRole: 'seeker', intentTarget: 'our_product', productFit: 'supported',
      needSummary: 'n', evidence: [], reason: 'r', uncertainty: null,
    },
    group: 'high_intent', modelId: 'm', promptVersion: 'p', ruleVersion: 'group-v1', createdAt: iso(30 * DAY),
  };
}

function job(id: string, status: Job['status'], ageMs: number): Job {
  return {
    id, kind: 'comments', status, ownerId: 'o', generation: 0, productId: PID, profileVersion: 1,
    tabId: null, noteKey: 'old', provider: 'p', modelId: 'm', promptVersion: 'v',
    totalItems: 1, completedItems: 1, failedItems: 0, createdAt: iso(ageMs), updatedAt: iso(ageMs), errorCode: null,
  };
}

describe('保留期清理（T26）', () => {
  it('cutoffIso 按天回退', () => {
    expect(cutoffIso(NOW, 30)).toBe(new Date(NOW - 30 * DAY).toISOString());
  });

  it('过期笔记/评论删除；孤立 analysis/feedback 级联清干净；新数据与 leadStates 保留', async () => {
    await db.notes.bulkAdd([note('old', 40 * DAY), note('fresh', 2 * DAY)]);
    await db.comments.bulkAdd([
      comment('c-old-1', 'old', 40 * DAY), comment('c-old-2', 'old', 40 * DAY),
      comment('c-fresh', 'fresh', 2 * DAY),
    ]);
    await db.analyses.bulkAdd([analysis('a-old-1', 'c-old-1'), analysis('a-fresh', 'c-fresh')]);
    await db.feedback.bulkAdd([
      { id: 'f-old', productId: PID, commentKey: 'c-old-1', analysisId: 'a-old-1', correctedGroup: 'need', note: null, createdAt: iso(35 * DAY) },
      { id: 'f-fresh', productId: PID, commentKey: 'c-fresh', analysisId: 'a-fresh', correctedGroup: null, note: '备注', createdAt: iso(1 * DAY) },
    ]);
    // leadStates 表示“已处理”，重分析不丢
    await db.leadStates.put({ id: `${PID}:c-fresh`, productId: PID, commentKey: 'c-fresh', handled: true, updatedAt: iso(1 * DAY) });

    const stats = await purgeExpired(db, NOW, 30);
    expect(stats.notes).toBe(1);
    expect(stats.analyses).toBe(1); // a-old-1 因评论消失成孤立被删
    expect(stats.feedback).toBe(1); // f-old 因 analysis 消失成孤立被删

    expect((await db.notes.toArray()).map((n) => n.noteKey)).toEqual(['fresh']);
    expect((await db.comments.toArray()).map((c) => c.commentKey)).toEqual(['c-fresh']);
    const orphanAnalyses = (await db.analyses.toArray()).filter((a) => !['c-fresh'].includes(a.commentKey));
    expect(orphanAnalyses.length).toBe(0);
    const orphanFeedback = (await db.feedback.toArray()).filter((f) => f.commentKey === 'c-old-1');
    expect(orphanFeedback.length).toBe(0);
    const states = await db.leadStates.toArray();
    expect(states.length).toBe(1);
    expect(states[0]!.handled).toBe(true);
  });

  it('评论单独过期也删，随附分析不残留', async () => {
    await db.notes.bulkAdd([note('fresh', 2 * DAY)]);
    await db.comments.bulkAdd([comment('c-stale', 'fresh', 35 * DAY)]);
    await db.analyses.bulkAdd([analysis('a-stale', 'c-stale')]);
    const stats = await purgeExpired(db, NOW, 30);
    expect(stats.comments).toBe(1);
    expect(await db.analyses.count()).toBe(0);
    expect(await db.notes.count()).toBe(1); // 笔记本身没过期就保留
  });

  it('终态 jobs 过期连 batches/usage 一起删；未过期保留', async () => {
    await db.jobs.bulkAdd([job('j1', 'completed', 45 * DAY), job('j2', 'failed', 10 * DAY)]);
    const batch = (id: string, jobId: string): Batch => ({
      id, jobId, index: 0, status: 'failed', cacheKeys: [], commentKeys: [], attemptCount: 1,
      inputHash: 'hhhhhhhh', startedAt: null, completedAt: null, errorCode: 'AI_TIMEOUT',
    });
    const usage = (id: string, jobId: string): Usage => ({
      id, jobId, batchId: null, attemptIndex: 0, status: 'failed', modelId: 'm', providerRequestId: null,
      inputTokens: null, outputTokens: null, estimatedCny: null, priceVerifiedAt: null, durationMs: 100, createdAt: iso(45 * DAY),
    });
    await db.batches.bulkAdd([batch('b1', 'j1'), batch('b2', 'j2')]);
    await db.usage.bulkAdd([usage('u1', 'j1'), usage('u2', 'j2')]);
    const stats = await purgeExpired(db, NOW, 30);
    expect(stats.jobs).toBe(1);
    expect((await db.jobs.toArray()).map((j) => j.id)).toEqual(['j2']);
    expect((await db.batches.toArray()).map((b) => b.id)).toEqual(['b2']);
    expect((await db.usage.toArray()).map((u) => u.id)).toEqual(['u2']);
  });

  it('活跃任务存在时拒绝清理（先取消）', async () => {
    await db.jobs.add(job('j-live', 'analyzing', 1 * DAY));
    await expect(purgeExpired(db, NOW, 30)).rejects.toThrow('活跃任务');
    expect(await db.jobs.count()).toBe(1); // 未做任何改动
  });
});
