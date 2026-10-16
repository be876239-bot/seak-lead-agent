import type { Analysis, Claim, Comment, Decision, Feedback, Group, Job, LeadState, Usage } from '../domain/schemas';
import { groupDecision, RULE_VERSION } from '../domain/classification';

export const GROUP_ORDER: Group[] = ['high_intent', 'need', 'review', 'excluded'];
export const GROUP_TITLES: Record<Group, string> = {
  high_intent: '高意向', need: '有需求', review: '口碑/讨论', excluded: '排除项',
};

/** 枚举值以英文存库、属协议一部分不能改；界面一律映射为中文展示。 */
export function intentShortCn(d: Decision): '意向本产品' | '意向该品类' | '无意向' {
  if (d.intentTarget === 'our_product') return '意向本产品';
  if (d.intentTarget === 'category' || d.intentTarget === 'competitor') return '意向该品类';
  return '无意向';
}
export const PRODUCT_FIT_CN: Record<Decision['productFit'], string> = {
  supported: '本产品可支持', unsupported: '本产品不支持', unknown: '未知',
};

export const STATUS_LABELS: Record<Claim['status'], string> = {
  observed: '事实', inferred: '推断', unknown: '未知', user_edited: '人工编辑',
};

export type LeadView = {
  comment: Comment;
  analysis: Analysis;
  /** 当前生效分组：人工纠正优先于模型结果。 */
  group: Group;
  /** 模型+规则给出的分组，永远不被改写。 */
  modelGroup: Group;
  source: 'model' | 'human';
  correction: Feedback | null;
  handled: boolean;
};

export function buildLeadGroups(input: {
  analyses: Analysis[];
  comments: Comment[];
  feedback: Feedback[];
  leadStates: LeadState[];
}): Record<Group, LeadView[]> {
  const byComment = new Map(input.comments.map((c) => [c.commentKey, c]));
  const latestCorrection = new Map<string, Feedback>();
  for (const f of input.feedback) {
    if (f.correctedGroup === null) continue;
    const prev = latestCorrection.get(f.analysisId);
    if (!prev || f.createdAt > prev.createdAt) latestCorrection.set(f.analysisId, f);
  }
  const handledKeys = new Set(input.leadStates.filter((s) => s.handled).map((s) => `${s.productId}:${s.commentKey}`));
  const out: Record<Group, LeadView[]> = { high_intent: [], need: [], review: [], excluded: [] };
  for (const a of input.analyses) {
    const comment = byComment.get(a.commentKey);
    if (!comment) continue;
    const correction = latestCorrection.get(a.id) ?? null;
    // 规则升级免费重算：存储分组是旧规则版本时，展示层按当前规则重判，不重新调用模型。
    const ruleGroup: Group = a.ruleVersion === RULE_VERSION ? a.group : groupDecision(a.decision, true);
    const group: Group = correction ? correction.correctedGroup! : ruleGroup;
    out[group].push({
      comment, analysis: a, group, modelGroup: ruleGroup,
      source: correction ? 'human' : 'model', correction,
      handled: handledKeys.has(`${a.productId}:${a.commentKey}`),
    });
  }
  for (const g of GROUP_ORDER) out[g].sort((x, y) => y.comment.capturedAt.localeCompare(x.comment.capturedAt));
  return out;
}

export function profileUnknownLabels(profile: {
  name: Claim; category: Claim; summary: Claim; accessMethod: Claim; price: Claim; purchaseChannel: Claim;
}): string[] {
  const pairs: [string, Claim][] = [
    ['名称', profile.name], ['类别', profile.category], ['概述', profile.summary],
    ['获取方式', profile.accessMethod], ['价格', profile.price], ['购买渠道', profile.purchaseChannel],
  ];
  return pairs.filter(([, c]) => c.status === 'unknown').map(([label]) => label);
}

export function jobPhaseLabel(job: Job): string {
  switch (job.status) {
    case 'created': return '准备中';
    case 'collecting': return '读取页面中';
    case 'analyzing': return `AI 分析中 ${job.completedItems}/${job.totalItems}`;
    case 'completed': return '已完成';
    case 'partial': return `部分完成（${job.completedItems}/${job.totalItems}，失败 ${job.failedItems}）`;
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    case 'interrupted': return '已中断';
  }
}

export const ACTIVE_JOB_STATUSES: Job['status'][] = ['created', 'collecting', 'analyzing'];
export const isJobActive = (job: Job | null): boolean => !!job && ACTIVE_JOB_STATUSES.includes(job.status);
export const isRetryableJob = (job: Job | null): boolean =>
  !!job && ['failed', 'partial', 'cancelled', 'interrupted'].includes(job.status);

/** 只允许合法 http(s) 链接渲染为可点开的 a 标签。 */
export function safeExternalUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export type UsageSummary = {
  calls: number; success: number; failed: number; unknown: number;
  /** 供应商未回报 token 的 success 调用存在时为 null（明确未知，绝不用字符数冒充）。 */
  inputTokens: number | null;
  outputTokens: number | null;
};

export function summarizeUsage(usages: Usage[]): UsageSummary {
  const out: UsageSummary = { calls: usages.length, success: 0, failed: 0, unknown: 0, inputTokens: 0, outputTokens: 0 };
  let inTok = 0;
  let outTok = 0;
  let tokensComplete = true;
  for (const u of usages) {
    if (u.status === 'success') out.success += 1;
    else if (u.status === 'failed') out.failed += 1;
    else out.unknown += 1;
    if (u.inputTokens === null || u.outputTokens === null) {
      if (u.status === 'success') tokensComplete = false;
    } else {
      inTok += u.inputTokens;
      outTok += u.outputTokens;
    }
  }
  out.inputTokens = tokensComplete && out.success > 0 ? inTok : null;
  out.outputTokens = tokensComplete && out.success > 0 ? outTok : null;
  return out;
}

export type PriceConfig = { inputPerMTokens: number; outputPerMTokens: number; verifiedAt: string };

/** 只有配置了单价与核验日期、且 token 已知，才给出估价。 */
export function estimateCny(summary: UsageSummary, price: PriceConfig | null): number | null {
  if (!price || !price.verifiedAt) return null;
  if (summary.inputTokens === null || summary.outputTokens === null) return null;
  const cny = (summary.inputTokens / 1e6) * price.inputPerMTokens + (summary.outputTokens / 1e6) * price.outputPerMTokens;
  return Math.round(cny * 1e4) / 1e4;
}
