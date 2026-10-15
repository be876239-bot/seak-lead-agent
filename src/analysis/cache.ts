import { hash64 } from '../domain/identity';

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
