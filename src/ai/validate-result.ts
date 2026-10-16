import { z } from 'zod';
import { AppError } from '../domain/errors';
import {
  DecisionSchema,
  ProductProfileSchema,
  type Decision,
} from '../domain/schemas';
import type { ClassificationInput } from '../privacy/ai-payload';
import { redactText } from '../privacy/redact';

/**
 * 引文允许标准省略号（… / ...）分节：拆出的每个片段必须是来源块中按序出现的连续原文，
 * 全部片段按顺序命中才通过——拼接真实原文可以，捏造或乱序拼贴不行。
 */
const ELLIPSIS_RE = /(?:\.{3,}|…+|⋯+)/;

/** 空白不敏感 + 全角/半角兼容形不敏感（NFKC 只统一字形，不允许改写内容）。 */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

export function isNormalizedSubstring(quote: string, text: string): boolean {
  const t = norm(text);
  const parts = quote.split(ELLIPSIS_RE).map(norm).filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  let pos = 0;
  for (const p of parts) {
    const idx = t.indexOf(p, pos);
    if (idx === -1) return false;
    pos = idx + p.length;
  }
  return true;
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
      else if (!isNormalizedSubstring(ev.quote, text)) fail(`证据引文不是来源块原文连续段（可用“…”按序省略中间内容）：${ev.sourceId}「${ev.quote.slice(0, 80)}」`);
    }
  }
  // 输出字段同样是非可信文本；保留结构并在持久化前再次脱敏。
  for (const c of claims) {
    if (c.value !== null) c.value = redactText(c.value);
    for (const ev of c.evidence) ev.quote = redactText(ev.quote);
  }
  profile.searchSuggestions = profile.searchSuggestions.map(redactText);
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
      if (!isNormalizedSubstring(ev.quote, text)) fail(`commentId ${decision.commentId} 引文不是原文连续段（可用“…”按序省略中间内容）：${ev.sourceId}「${ev.quote.slice(0, 80)}」`);
      if (ev.sourceId === `${item.commentId}:text`) hasSelfEvidence = true;
    }
    decision.needSummary = redactText(decision.needSummary);
    decision.reason = redactText(decision.reason);
    decision.uncertainty = decision.uncertainty === null ? null : redactText(decision.uncertainty);
    for (const ev of decision.evidence) ev.quote = redactText(ev.quote);
    out.push({ decision, hasSelfEvidence });
  }

  for (const id of requested) {
    if (!seen.has(id)) fail(`缺少请求的 commentId：${id}`);
  }
  if (out.length !== requested.length) fail('返回条数与请求条数不一致');
  return out;
}

export type { ClassificationInput };
