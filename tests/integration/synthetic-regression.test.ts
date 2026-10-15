import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateClassificationOutput } from '../../src/ai/validate-result';
import { groupDecision, RULE_VERSION } from '../../src/domain/classification';
import type { ClassificationInput } from '../../src/privacy/ai-payload';
import type { Decision, Group } from '../../src/domain/schemas';

type SyntheticCase = {
  id: string;
  kind: 'synthetic';
  product: ClassificationInput['product'];
  note: { sourceId: string; text: string };
  comment: { commentId: string; text: string; parent: { sourceId: string; text: string } | null };
  expectedDecision: Omit<Decision, 'commentId'>;
  expectedGroup: Group;
};

const cases: SyntheticCase[] = readFileSync('eval/synthetic.jsonl', 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as SyntheticCase);

function toInput(c: SyntheticCase): ClassificationInput {
  return {
    product: c.product,
    note: { sourceId: 'n001', text: c.note.text },
    items: [{ commentId: 'c001', sourceId: 'c001:text', text: c.comment.text, parent: c.comment.parent }],
    idMap: [{ commentKey: `synthetic:${c.id}`, tempId: 'c001' }],
  };
}

describe('eval/synthetic.jsonl 模拟回归集（全部 synthetic，非真实中文效果）', () => {
  it('规模与标注口径：≥30 条且逐条 kind=synthetic', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const c of cases) expect(c.kind, c.id).toBe('synthetic');
  });

  it('覆盖题库需求/相邻竞赛/免费/卖家/否定/短语/父评论跨作者/竞品价格/注入文本', () => {
    const intents = new Set(cases.map((c) => c.expectedDecision.purchaseIntent));
    const roles = new Set(cases.map((c) => c.expectedDecision.speakerRole));
    const targets = new Set(cases.map((c) => c.expectedDecision.intentTarget));
    expect(intents).toContain('free_only');
    expect(intents).toContain('explicit_buy');
    expect(roles).toContain('seller');
    expect(roles).toContain('sharer');
    expect(targets).toContain('competitor');
    expect(cases.some((c) => c.expectedDecision.relevance === 'unrelated')).toBe(true);
    expect(cases.some((c) => c.comment.parent && c.comment.parent.text.includes('多少钱'))).toBe(true);
    expect(cases.some((c) => c.comment.text.includes('忽略之前指令'))).toBe(true);
    expect(new Set(cases.map((c) => c.expectedGroup)).size).toBe(4);
  });

  it('每条 gold 决策通过输出校验（引文为实际输入连续子串、sourceId 归属正确）', () => {
    for (const c of cases) {
      const out = validateClassificationOutput(
        { results: [{ ...c.expectedDecision, commentId: 'c001' }] },
        toInput(c),
      );
      expect(out, c.id).toHaveLength(1);
    }
  });

  it(`group-v1 规则复算与 expectedGroup 一致（gold 可解释）`, () => {
    expect(RULE_VERSION).toBe('group-v1');
    for (const c of cases) {
      const [validated] = validateClassificationOutput(
        { results: [{ ...c.expectedDecision, commentId: 'c001' }] },
        toInput(c),
      );
      const group = groupDecision(validated!.decision, validated!.hasSelfEvidence);
      expect(group, `${c.id}: ${c.comment.text}`).toBe(c.expectedGroup);
    }
  });

  it('高意向样本全部有当前评论自身证据；free_only 无一进高意向', () => {
    for (const c of cases.filter((x) => x.expectedGroup === 'high_intent')) {
      expect(c.expectedDecision.evidence.every((e) => e.sourceId === 'c001:text'), c.id).toBe(true);
      expect(c.expectedDecision.purchaseIntent, c.id).not.toBe('free_only');
    }
  });
});
