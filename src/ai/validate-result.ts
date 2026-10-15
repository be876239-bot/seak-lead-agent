import { z } from 'zod';
import { AppError } from '../domain/errors';
import {
  DecisionSchema,
  ProductProfileSchema,
  type Decision,
} from '../domain/schemas';
import type { ClassificationInput } from '../privacy/ai-payload';

/** 规范化空白后的连续子串校验（针对打码、截断后的实际输入文本）。 */
export function isNormalizedSubstring(quote: string, text: string): boolean {
  const q = quote.replace(/\s+/g, '');
  const t = text.replace(/\s+/g, '');
  return q.length > 0 && t.includes(q);
}

export type ValidatedResult = {
  decision: Decision;
  /** 是否有当前评论自身文本的证据（高意向必要条件，进入分组而非校验失败）。 */
  hasSelfEvidence: boolean;
};

function fail(summary: string): never {
  throw new AppError('AI_INVALID_OUTPUT', summary);
}

export function validateProfileOutput(value: unknown, blocks: readonly { id: string; text: string }[]): z.infer<typeof ProductProfileSchema> {
  let profile;
  try {
    profile = ProductProfileSchema.parse(value);
  } catch (err) {
    fail(`产品画像 JSON 不符合 profile schema：${err instanceof z.ZodError ? err.issues.slice(0, 5).map((i) => `${i.path.join('.')}:${i.code}`).join('; ') : 'unknown'}`);
  }
  const byId = new Map(blocks.map((b) => [b.id, b.text]));
  const claims = [
    profile.name, profile.category, profile.summary, profile.accessMethod, profile.price, profile.purchaseChannel,
    ...profile.capabilities, ...profile.targetAudience, ...profile.needsServed, ...profile.exclusions,
  ];
  for (const c of claims) {
    if (c.status === 'user_edited') fail('模型输出不允许 user_edited 状态');
    if (c.status === 'observed' && c.evidence.length === 0) fail('observed 事实缺少来源证据');
    for (const ev of c.evidence) {
      const text = byId.get(ev.sourceId);
      if (text === undefined) fail(`证据 sourceId 不属于来源块：${ev.sourceId}`);
      else if (!isNormalizedSubstring(ev.quote, text)) fail(`证据引文不是来源块连续原文：${ev.sourceId}`);
    }
  }
  return profile;
}

export function validateClassificationOutput(value: unknown, input: ClassificationInput): ValidatedResult[] {
  const obj = z.strictObject({ results: z.array(z.unknown()) }).safeParse(value);
  if (!obj.success) fail('分类输出必须是 {"results":[...]} 且无额外顶层字段');

  const requested = input.items.map((i) => i.commentId);
  const seen = new Set<string>();
  const out: ValidatedResult[] = [];
  const noteText = input.note.text;

  for (const raw of obj.data.results) {
    let decision: Decision;
    try {
      decision = DecisionSchema.parse(raw);
    } catch (err) {
      const detail = err instanceof z.ZodError ? err.issues.slice(0, 5).map((i) => `${i.path.join('.')}:${i.code}`).join('; ') : 'unknown';
      fail(`结果项不符合 schema：${detail}`);
    }
    if (seen.has(decision.commentId)) fail(`重复的 commentId：${decision.commentId}`);
    seen.add(decision.commentId);

    const item = input.items.find((i) => i.commentId === decision.commentId);
    if (!item) fail(`返回了未请求的 commentId：${decision.commentId}`);

    const allowed = new Map<string, string>([
      [`${item.commentId}:text`, item.text],
      ['n001', noteText],
    ]);
    if (item.parent) allowed.set(item.parent.sourceId, item.parent.text);

    let hasSelfEvidence = false;
    for (const ev of decision.evidence) {
      const text = allowed.get(ev.sourceId);
      if (text === undefined) fail(`commentId ${decision.commentId} 引用了不属于其上下文的证据：${ev.sourceId}`);
      if (!isNormalizedSubstring(ev.quote, text)) fail(`commentId ${decision.commentId} 引文不是原文连续子串：${ev.sourceId}`);
      if (ev.sourceId === `${item.commentId}:text`) hasSelfEvidence = true;
    }
    out.push({ decision, hasSelfEvidence });
  }

  for (const id of requested) {
    if (!seen.has(id)) fail(`缺少请求的 commentId：${id}`);
  }
  if (out.length !== requested.length) fail('返回条数与请求条数不一致');
  return out;
}

export type { ClassificationInput };
