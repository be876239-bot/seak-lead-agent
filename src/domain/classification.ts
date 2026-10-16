import type { Decision, Group } from '../domain/schemas';

export const RULE_VERSION = 'group-v2';

/**
 * DEVELOPMENT.md 10.4 有序规则（group-v2，2026-10-16 用户指示降门槛，见 D007）。
 * hasSelfEvidence 参数保留但 v2 不再作为高意向硬条件；旧结果展示时按本函数免费重算。
 */
export function groupDecision(d: Decision, hasSelfEvidence: boolean): Group {
  void hasSelfEvidence;
  if (d.relevance === 'unrelated' || d.speakerRole === 'seller' || d.productFit === 'unsupported' || d.need === 'none') {
    return 'excluded';
  }
  if (d.uncertainty !== null) return 'review';
  const needOk = d.need === 'explicit' || d.need === 'implicit';
  if (!needOk || d.productFit !== 'supported' || d.relevance === 'unknown') return 'review';
  const paidIntent =
    d.purchaseIntent === 'explicit_buy' || d.purchaseIntent === 'price_or_access' || d.purchaseIntent === 'solution_seeking';
  if (d.relevance === 'direct' && d.speakerRole === 'seeker' && paidIntent) {
    return 'high_intent';
  }
  return 'need';
}

/** 竞品/品类信号展示要求：可以高意向，但必须标注并非本产品。 */
export function needsTargetBadge(d: Decision): 'competitor' | 'category' | null {
  if (d.intentTarget === 'competitor') return 'competitor';
  if (d.intentTarget === 'category') return 'category';
  return null;
}
