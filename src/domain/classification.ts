import type { Decision, Group } from '../domain/schemas';

export const RULE_VERSION = 'group-v1';

/**
 * DEVELOPMENT.md 10.4 有序规则。
 * hasSelfEvidence=false 时不满足高意向的“当前评论证据”条件，自然降级。
 */
export function groupDecision(d: Decision, hasSelfEvidence: boolean): Group {
  if (d.relevance === 'unrelated' || d.speakerRole === 'seller' || d.productFit === 'unsupported' || d.need === 'none') {
    return 'excluded';
  }
  if (d.relevance === 'unknown' || d.relevance === 'adjacent' || d.need === 'unknown' || d.productFit === 'unknown' || d.uncertainty !== null) {
    return 'review';
  }
  const needOk = d.need === 'explicit' || d.need === 'implicit';
  const paidIntent = d.purchaseIntent === 'explicit_buy' || d.purchaseIntent === 'price_or_access';
  if (d.relevance === 'direct' && needOk && d.productFit === 'supported' && d.speakerRole === 'seeker' && paidIntent && hasSelfEvidence) {
    return 'high_intent';
  }
  if (d.relevance === 'direct' && needOk && d.productFit === 'supported') {
    return 'need';
  }
  return 'review';
}

/** 竞品/品类信号展示要求：可以高意向，但必须标注并非本产品。 */
export function needsTargetBadge(d: Decision): 'competitor' | 'category' | null {
  if (d.intentTarget === 'competitor') return 'competitor';
  if (d.intentTarget === 'category') return 'category';
  return null;
}
