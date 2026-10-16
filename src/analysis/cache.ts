import { hash64 } from '../domain/identity';

/**
 * 缓存键固定使用初版规则版本：分组规则只影响本地展示归类，不影响模型判断结果。
 * 规则升级（RULE_VERSION 变化）若进入缓存键会导致全部历史付费结果失效重算，故解耦（D007）。
 */
export const CACHE_RULE_VERSION = 'group-v1';

export type CacheKeyParts = {
  productId: string;
  profileVersion: number;
  commentKey: string;
  contextHash: string;
  provider: string;
  modelId: string;
  promptVersion: string;
  ruleVersion: string;
};

/** 缓存键：只由稳定成分组成，不含捕获时间/随机 ID；任一成分变化即失效。 */
export function buildCacheKey(p: CacheKeyParts): string {
  const base = [
    p.productId, p.profileVersion, p.commentKey, p.contextHash,
    p.provider, p.modelId, p.promptVersion, p.ruleVersion,
  ].join('\u0001');
  return hash64(base) + hash64(base + '\u0001#2');
}

/** 已有分析（cacheKey 集合）之外的待处理条目；无新增即不调用 AI。 */
export function filterUncached<T extends { cacheKey: string }>(
  existing: ReadonlySet<string>,
  candidates: readonly T[],
): T[] {
  return candidates.filter((c) => !existing.has(c.cacheKey));
}
