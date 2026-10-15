import { describe, expect, it } from 'vitest';
import type { Analysis, Comment, Feedback, Group, LeadState, Usage } from '../../src/domain/schemas';
import {
  buildLeadGroups, estimateCny, isJobActive, isRetryableJob, jobPhaseLabel, profileUnknownLabels,
  safeExternalUrl, summarizeUsage,
} from '../../src/ui/logic';

const PID = '11111111-1111-4111-8111-111111111111';

function comment(id: string, capturedAt: string): Comment {
  return {
    commentKey: `n:c${id}`, noteKey: 'n', platformCommentId: null, parentKey: null,
    text: `评论${id}`, authorDisplayName: null, authorLocalKey: null, profileUrl: null,
    publishedText: null, publishedAt: null, likeCount: null,
    capturedAt, identityQuality: 'weak', truncated: false,
  };
}

function analysis(id: string, commentKey: string, group: Group): Analysis {
  return {
    id, cacheKey: `${id}padpadpadpad`, productId: PID, profileVersion: 1, commentKey,
    contextHash: 'aaaaaaaa', decision: {
      commentId: 't1', relevance: 'direct', need: 'explicit', purchaseIntent: 'explicit_buy',
      speakerRole: 'seeker', intentTarget: 'our_product', productFit: 'supported',
      needSummary: '询价', evidence: [], reason: 'r', uncertainty: null,
    },
    group, modelId: 'm', promptVersion: 'p', ruleVersion: 'group-v1', createdAt: '2026-10-15T00:00:00Z',
  };
}

const claim = (status: 'observed' | 'inferred' | 'unknown') => ({
  value: status === 'unknown' ? null : 'x', status, evidence: [],
});

describe('buildLeadGroups', () => {
  it('人工纠正改变生效分组但不改写模型分组，且取最新一条纠正', () => {
    const a = analysis('a'.repeat(36).slice(0, 36) as string, 'n:c1', 'high_intent');
    const fbOld: Feedback = {
      id: 'f1'.padEnd(36, '0').slice(0, 36) as string, productId: PID, commentKey: 'n:c1',
      analysisId: a.id, correctedGroup: 'excluded', note: '旧：先改成排除', createdAt: '2026-10-15T01:00:00Z',
    };
    const fbNew: Feedback = { ...fbOld, id: 'f2'.padEnd(36, '0').slice(0, 36) as string, correctedGroup: 'need', note: '新：其实是有需求', createdAt: '2026-10-15T02:00:00Z' };
    const groups = buildLeadGroups({ analyses: [a], comments: [comment('1', '2026-10-15T00:00:00Z')], feedback: [fbOld, fbNew], leadStates: [] });
    expect(groups.high_intent.length).toBe(0);
    expect(groups.need.length).toBe(1);
    const view = groups.need[0]!;
    expect(view.modelGroup).toBe('high_intent');
    expect(view.source).toBe('human');
    expect(view.correction!.note).toBe('新：其实是有需求');
    // 只留备注不改正分组（correctedGroup=null）不算纠正
  });

  it('correctedGroup 为 null 的备注不影响分组；缺失评论的分析被跳过；handled 按产品+评论键', () => {
    const a1 = analysis('a'.repeat(36), 'n:c1', 'high_intent');
    const a2 = analysis('b'.repeat(36), 'n:missing', 'need');
    const note: Feedback = {
      id: 'f3'.padEnd(36, '0').slice(0, 36) as string, productId: PID, commentKey: 'n:c1',
      analysisId: a1.id, correctedGroup: null, note: '仅备注', createdAt: '2026-10-15T03:00:00Z',
    };
    const states: LeadState[] = [
      { id: `${PID}:n:c1`, productId: PID, commentKey: 'n:c1', handled: true, updatedAt: '2026-10-15T03:00:00Z' },
      { id: `other:${PID}:n:c1`.slice(0, 60), productId: '2'.repeat(36), commentKey: 'n:c1', handled: true, updatedAt: '2026-10-15T03:00:00Z' },
    ];
    const groups = buildLeadGroups({ analyses: [a1, a2], comments: [comment('1', '2026-10-15T00:00:00Z')], feedback: [note], leadStates: states });
    expect(groups.high_intent.length).toBe(1);
    expect(groups.high_intent[0]!.source).toBe('model');
    expect(groups.high_intent[0]!.handled).toBe(true);
    expect(groups.need.length).toBe(0); // a2 评论缺失被跳过
  });

  it('同组内按评论时间倒序', () => {
    const a1 = analysis('c'.repeat(36), 'n:c1', 'excluded');
    const a2 = analysis('d'.repeat(36), 'n:c2', 'excluded');
    const groups = buildLeadGroups({
      analyses: [a1, a2],
      comments: [comment('1', '2026-10-10T00:00:00Z'), comment('2', '2026-10-12T00:00:00Z')],
      feedback: [], leadStates: [],
    });
    expect(groups.excluded.map((v) => v.comment.text)).toEqual(['评论2', '评论1']);
  });
});

describe('画像完整度与任务标签', () => {
  it('仅列出 unknown 字段；observed/inferred/user_edited 均算已知', () => {
    const labels = profileUnknownLabels({
      name: claim('observed'), category: claim('unknown'), summary: claim('inferred'),
      accessMethod: claim('unknown'), price: { value: '待定', status: 'user_edited', evidence: [] },
      purchaseChannel: claim('unknown'),
    });
    expect(labels).toEqual(['类别', '获取方式', '购买渠道']);
  });

  it('jobPhaseLabel 带进度；活跃/可重试判定', () => {
    const job = (status: string, completedItems = 0, totalItems = 0) => ({
      id: 'j', kind: 'comments', status, ownerId: '', generation: 0, productId: PID, profileVersion: null,
      tabId: null, noteKey: null, provider: 'mock', modelId: 'm', promptVersion: 'p',
      totalItems, completedItems, failedItems: 0, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', errorCode: null,
    }) as never;
    expect(jobPhaseLabel(job('analyzing', 15, 26))).toContain('15/26');
    expect(isJobActive(job('created'))).toBe(true);
    expect(isJobActive(job('completed'))).toBe(false);
    expect(isRetryableJob(job('partial'))).toBe(true);
    expect(isRetryableJob(job('completed'))).toBe(false);
  });
});

describe('safeExternalUrl', () => {
  it('只放行 http(s)，拒绝 javascript:/data:/非法串', () => {
    expect(safeExternalUrl('https://www.xiaohongshu.com/explore/abc')).toContain('xiaohongshu');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,x')).toBeNull();
    expect(safeExternalUrl('不是链接')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe('用量汇总与估价（T22 UI）', () => {
  const usage = (over: Partial<Usage>): Usage => ({
    id: crypto.randomUUID(), jobId: 'j', batchId: null, attemptIndex: 0, status: 'success',
    modelId: 'm', providerRequestId: null, inputTokens: 100, outputTokens: 50,
    estimatedCny: null, priceVerifiedAt: null, durationMs: 10, createdAt: '2026-10-15T00:00:00Z', ...over,
  });

  it('token 全部回报才累计；有 success 未回报即整体标为未知，不用字符数冒充', () => {
    const s1 = summarizeUsage([usage({}), usage({ inputTokens: 200, outputTokens: 30 })]);
    expect(s1.inputTokens).toBe(300);
    expect(s1.outputTokens).toBe(80);
    const s2 = summarizeUsage([usage({}), usage({ inputTokens: null, outputTokens: null })]);
    expect(s2.inputTokens).toBeNull();
    expect(s2.calls).toBe(2);
    expect(s2.success).toBe(2);
  });

  it('失败/未知计数单列；仅 failed 时 token 为 null 且不计调用成功', () => {
    const s = summarizeUsage([
      usage({ status: 'failed', inputTokens: null, outputTokens: null }),
      usage({ status: 'unknown', inputTokens: null, outputTokens: null }),
    ]);
    expect(s.success).toBe(0);
    expect(s.failed).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.inputTokens).toBeNull();
  });

  it('估价需单价+核验日期+已知 token 三者齐备', () => {
    const ok = summarizeUsage([usage({ inputTokens: 1_000_000, outputTokens: 500_000 })]);
    expect(estimateCny(ok, null)).toBeNull();
    expect(estimateCny(ok, { inputPerMTokens: 2, outputPerMTokens: 8, verifiedAt: '' })).toBeNull();
    expect(estimateCny(ok, { inputPerMTokens: 2, outputPerMTokens: 8, verifiedAt: '2026-10-01' })).toBe(6);
    const unknown = summarizeUsage([usage({ inputTokens: null, outputTokens: null })]);
    expect(estimateCny(unknown, { inputPerMTokens: 2, outputPerMTokens: 8, verifiedAt: '2026-10-01' })).toBeNull();
  });
});
