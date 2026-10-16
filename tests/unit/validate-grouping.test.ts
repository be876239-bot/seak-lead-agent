import { describe, expect, it } from 'vitest';
import { isNormalizedSubstring, validateClassificationOutput, validateProfileOutput } from '../../src/ai/validate-result';
import { groupDecision, needsTargetBadge, RULE_VERSION } from '../../src/domain/classification';
import type { ClassificationInput } from '../../src/privacy/ai-payload';
import type { Decision, Group } from '../../src/domain/schemas';
import { LIMITS } from '../../src/domain/limits';

function input(): ClassificationInput {
  return {
    product: { name: '题库', category: '竞赛备考', summary: null, capabilities: [], targetAudience: [], needsServed: [], exclusions: [], accessMethod: '邀请码解锁', price: null },
    note: { sourceId: 'n001', text: '浙江网络安全知识挑战赛备考题库分享' },
    items: [
      { commentId: 'c001', sourceId: 'c001:text', text: '这个题库多少钱，在哪开通？', parent: null },
      { commentId: 'c002', sourceId: 'c002:text', text: '可以聊聊', parent: { sourceId: 'p001', text: '我们也有这个需求，愿意付费！' } },
    ],
    idMap: [{ commentKey: 'k1', tempId: 'c001' }, { commentKey: 'k2', tempId: 'c002' }],
  };
}

const base: Omit<Decision, 'commentId'> = {
  relevance: 'direct', need: 'explicit', purchaseIntent: 'price_or_access',
  speakerRole: 'seeker', intentTarget: 'category', productFit: 'supported',
  needSummary: '询问价格与开通', evidence: [{ sourceId: 'c001:text', quote: '这个题库多少钱，在哪开通？' }],
  reason: '明确问价', uncertainty: null,
};

function results(extra: unknown[] = [], mutate?: (d: Decision) => Decision) {
  const list = [
    { ...base, commentId: 'c001' },
    { ...base, commentId: 'c002', evidence: [{ sourceId: 'p001', quote: '我们也有这个需求，愿意付费！' }] },
  ].map((d) => (mutate ? mutate(d as Decision) : d));
  return { results: [...list, ...extra] };
}

describe('validateClassificationOutput', () => {
  it('RULE_VERSION 为 group-v2', () => {
    expect(RULE_VERSION).toBe('group-v2');
  });
  it('合法输出通过；父评论证据不算自身证据', () => {
    const out = validateClassificationOutput(results(), input());
    expect(out).toHaveLength(2);
    expect(out[0]!.hasSelfEvidence).toBe(true);
    expect(out[1]!.hasSelfEvidence).toBe(false);
  });
  it('引文按规范化空白匹配（跨换行空格）', () => {
    const out = validateClassificationOutput(
      results([], (d) => (d.commentId === 'c001' ? { ...d, evidence: [{ sourceId: 'c001:text', quote: '这个题库 多少钱' }] } : d)),
      input(),
    );
    expect(out[0]!.hasSelfEvidence).toBe(true);
    expect(isNormalizedSubstring('多少钱，在哪', '这个题库多少钱，在哪开通？')).toBe(true);
    expect(isNormalizedSubstring('', 'abc')).toBe(false);
  });
  it('省略号分节引文：各段按序逐字命中即通过；乱序或捏造段拒绝', () => {
    const text = '这个题库多少钱，在哪开通？支持考研和公考两个方向。';
    expect(isNormalizedSubstring('题库多少钱 …… 在哪开通', text)).toBe(true);
    expect(isNormalizedSubstring('支持考研 … 公考两个方向', text)).toBe(true);
    expect(isNormalizedSubstring('在哪开通…题库多少钱', text)).toBe(false);
    expect(isNormalizedSubstring('题库多少钱……不存在的片段', text)).toBe(false);
    expect(isNormalizedSubstring('……', text)).toBe(false);
  });
  it('缺 ID / 多 ID / 重复 ID 均拒绝', () => {
    expect(() => validateClassificationOutput({ results: [results().results[1]!] }, input())).toThrowError(/缺少请求的 commentId/);
    expect(() => validateClassificationOutput(results([{ ...base, commentId: 'c099' }]), input())).toThrowError(/未请求/);
    expect(() => validateClassificationOutput(results([{ ...base, commentId: 'c001' }]), input())).toThrowError(/重复/);
  });
  it('跨评论引用拒绝', () => {
    expect(() => validateClassificationOutput(
      results([], (d) => (d.commentId === 'c002' ? { ...d, evidence: [{ sourceId: 'c001:text', quote: '这个题库多少钱，在哪开通？' }] } : d)),
      input(),
    )).toThrowError(/不属于其上下文/);
  });
  it('捏造引文拒绝', () => {
    expect(() => validateClassificationOutput(
      results([], (d) => ({ ...d, evidence: [{ sourceId: 'c001:text', quote: '我要马上购买' }] })),
      input(),
    )).toThrowError(/不是原文连续段/);
  });
  it('未知顶层字段、results 之外的键拒绝（strict）', () => {
    expect(() => validateClassificationOutput({ ...results(), debug: true }, input())).toThrowError(/无额外顶层字段/);
  });
  it('结果项缺字段或含未知字段拒绝', () => {
    const bad = { results: [{ commentId: 'c001' }, { ...base, commentId: 'c002', extraKey: 1 }] };
    expect(() => validateClassificationOutput(bad, input())).toThrowError(/schema/);
  });
  it('错误摘要不泄露评论正文以外数据？——消息仅含 ID 与原因', () => {
    try {
      validateClassificationOutput(results([{ ...base, commentId: 'c003' }]), input());
    } catch (err) {
      expect((err as Error).message).toContain('c003');
    }
  });
});

describe('validateProfileOutput', () => {
  const blocks = [{ id: 'b01', url: 'https://x.com/', text: '2026 挑战赛题库上线，价格 99 元，邀请码解锁。', fetchedAt: '2026-10-15T00:00:00.000Z' }];
  const claim = (v: string | null, status: string, ev: { sourceId: string; quote: string }[] = []) => ({ value: v, status, evidence: ev });
  function profile(over: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      name: claim('挑战赛题库', 'observed', [{ sourceId: 'b01', quote: '挑战赛题库上线' }]),
      category: claim('备考题库', 'observed', [{ sourceId: 'b01', quote: '题库' }]),
      summary: claim('服务浙江挑战赛练习', 'inferred'),
      capabilities: [], targetAudience: [], needsServed: [], exclusions: [],
      accessMethod: claim('邀请码解锁', 'observed', [{ sourceId: 'b01', quote: '邀请码解锁' }]),
      price: claim('99 元', 'observed', [{ sourceId: 'b01', quote: '价格 99 元' }]),
      purchaseChannel: claim(null, 'unknown'),
      searchSuggestions: ['浙江网络安全挑战赛题库'],
      ...over,
    };
  }
  it('合法画像通过', () => {
    expect(validateProfileOutput(profile(), blocks).price.value).toBe('99 元');
  });
  it('observed 无证据拒绝', () => {
    expect(() => validateProfileOutput(profile({ price: claim('99 元', 'observed') }), blocks)).toThrowError(/observed/);
  });
  it('证据 sourceId 不属于来源块拒绝；捏造引文拒绝', () => {
    expect(() => validateProfileOutput(profile({ price: claim('99 元', 'observed', [{ sourceId: 'b99', quote: 'x' }]) }), blocks)).toThrowError(/不属于来源块/);
    expect(() => validateProfileOutput(profile({ price: claim('99 元', 'observed', [{ sourceId: 'b01', quote: '价格 199 元' }]) }), blocks)).toThrowError(/连续段/);
  });
  it('unknown 必须 null（schema refine）', () => {
    expect(() => validateProfileOutput(profile({ purchaseChannel: claim('私信', 'unknown') }), blocks)).toThrowError();
  });
  it('模型不得输出 user_edited', () => {
    expect(() => validateProfileOutput(profile({ summary: claim('x', 'user_edited') }), blocks)).toThrowError(/user_edited/);
  });
  it('未知字段拒绝（strictObject）', () => {
    expect(() => validateProfileOutput({ ...profile(), bonus: 1 }, blocks)).toThrowError();
  });
  it('列表条数与文本上限执行', () => {
    const many = Array.from({ length: LIMITS.maxProfileList + 1 }, () => claim('a', 'inferred'));
    expect(() => validateProfileOutput(profile({ capabilities: many }), blocks)).toThrowError();
  });
});

describe('groupDecision（group-v2 有序规则，2026-10-16 用户指示降门槛）', () => {
  const d = (over: Partial<Decision> = {}): Decision => ({ ...base, commentId: 'c001', ...over });
  it('卖家、无关、不适配、无需求优先排除', () => {
    expect(groupDecision(d({ speakerRole: 'seller' }), true)).toBe('excluded');
    expect(groupDecision(d({ relevance: 'unrelated' }), true)).toBe('excluded');
    expect(groupDecision(d({ productFit: 'unsupported' }), true)).toBe('excluded');
    expect(groupDecision(d({ need: 'none' }), true)).toBe('excluded');
  });
  it('模型标记不确定与判不了的字段进 review', () => {
    expect(groupDecision(d({ uncertainty: '可能指别的考试' }), true)).toBe('review');
    expect(groupDecision(d({ productFit: 'unknown' }), true)).toBe('review');
    expect(groupDecision(d({ need: 'unknown' }), true)).toBe('review');
    expect(groupDecision(d({ relevance: 'unknown' }), true)).toBe('review');
  });
  it('问价且上下文匹配 → high_intent', () => {
    expect(groupDecision(d(), true)).toBe('high_intent');
  });
  it('v2 高意向不再要求当前评论自身证据', () => {
    expect(groupDecision(d(), false)).toBe('high_intent');
  });
  it('相邻领域可支持有需求 → need（v2 不再压 review）', () => {
    expect(groupDecision(d({ relevance: 'adjacent' }), true)).toBe('need');
  });
  it('free_only 禁止高意向', () => {
    expect(groupDecision(d({ purchaseIntent: 'free_only' }), true)).toBe('need');
  });
  it('角色不确定不判高意向', () => {
    expect(groupDecision(d({ speakerRole: 'unknown' }), true)).toBe('need');
  });
  it('求资料（solution_seeking）+直接相关+需求方 → high_intent（v2 纳入付费信号）', () => {
    expect(groupDecision(d({ purchaseIntent: 'solution_seeking' }), true)).toBe('high_intent');
  });
  it('竞品信号可高意向但需徽章，不得声称想买本产品', () => {
    const comp = d({ intentTarget: 'competitor', purchaseIntent: 'explicit_buy' });
    expect(groupDecision(comp, true)).toBe('high_intent');
    expect(needsTargetBadge(comp)).toBe('competitor');
    expect(needsTargetBadge(d())).toBe('category');
  });
  it('sharer 不高意向，按规则归 need（非排除）', () => {
    expect(groupDecision(d({ speakerRole: 'sharer', purchaseIntent: 'none', need: 'implicit' }), true)).toBe('need');
  });
  it('分组枚举完整', () => {
    const groups: Group[] = ['high_intent', 'need', 'review', 'excluded'];
    expect(groups).toContain(groupDecision(d(), true));
  });
});
