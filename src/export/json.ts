import type { Product } from '../domain/schemas';
import type { LeadView } from '../ui/logic';
import { GROUP_TITLES, safeExternalUrl } from '../ui/logic';

export const EXPORT_SCHEMA_VERSION = 1;

export type LeadsExportDocument = {
  schemaVersion: 1;
  exportedAt: string;
  scope: { productId: string | null; filter: string };
  product: {
    id: string; inputUrl: string; finalUrl: string;
    name: string | null; profileVersion: number; modelId: string;
  } | null;
  count: number;
  leads: {
    group: string; modelGroup: string; source: 'model' | 'human';
    correctionNote: string | null; handled: boolean;
    commentKey: string; commentText: string;
    noteKey: string; noteUrl: string | null;
    needSummary: string; reason: string; uncertainty: string | null;
    relevance: string; need: string; purchaseIntent: string;
    speakerRole: string; intentTarget: string; productFit: string;
    evidenceQuotes: string[];
    analyzedWith: { profileVersion: number; modelId: string; promptVersion: string; ruleVersion: string };
    createdAt: string;
  }[];
};

/** 只导出打码后的业务字段：不含 Key、锁、原始 DOM、作者昵称。 */
export function buildLeadsExport(args: {
  product: Product | null;
  views: LeadView[];
  noteUrls: Record<string, string | null>;
  filterLabel: string;
  exportedAt: string;
}): LeadsExportDocument {
  const { product, views, noteUrls } = args;
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: args.exportedAt,
    scope: { productId: product?.id ?? null, filter: args.filterLabel },
    product: product && {
      id: product.id, inputUrl: product.inputUrl, finalUrl: product.finalUrl,
      name: product.profile.name.value, profileVersion: product.profileVersion, modelId: product.modelId,
    },
    count: views.length,
    leads: views.map((v) => ({
      group: v.group, modelGroup: v.modelGroup, source: v.source,
      correctionNote: v.correction?.note ?? null, handled: v.handled,
      commentKey: v.comment.commentKey, commentText: v.comment.text,
      noteKey: v.comment.noteKey, noteUrl: noteUrls[v.comment.noteKey] ?? null,
      needSummary: v.analysis.decision.needSummary, reason: v.analysis.decision.reason,
      uncertainty: v.analysis.decision.uncertainty,
      relevance: v.analysis.decision.relevance, need: v.analysis.decision.need,
      purchaseIntent: v.analysis.decision.purchaseIntent, speakerRole: v.analysis.decision.speakerRole,
      intentTarget: v.analysis.decision.intentTarget, productFit: v.analysis.decision.productFit,
      evidenceQuotes: v.analysis.decision.evidence.map((e) => e.quote),
      analyzedWith: {
        profileVersion: v.analysis.profileVersion, modelId: v.analysis.modelId,
        promptVersion: v.analysis.promptVersion, ruleVersion: v.analysis.ruleVersion,
      },
      createdAt: v.analysis.createdAt,
    })),
  };
}

export function leadsToCsvRows(views: LeadView[], noteUrls: Record<string, string | null>): (string | number | null)[][] {
  const header = [
    '分组', '生效来源', '模型原判', '纠正备注', '已处理', '评论内容', '需求摘要',
    '意向对象', '产品匹配', '证据摘录', '理由', '不确定点', '原帖链接', '画像版本(分析时)', '分析时间',
  ];
  const rows = views.map((v) => [
    v.group, v.source === 'human' ? '人工纠正' : '模型', GROUP_TITLES[v.modelGroup],
    v.correction?.note ?? null, v.handled ? '是' : '否',
    v.comment.text, v.analysis.decision.needSummary,
    v.analysis.decision.intentTarget, v.analysis.decision.productFit,
    v.analysis.decision.evidence.map((e) => e.quote).join(' / '),
    v.analysis.decision.reason, v.analysis.decision.uncertainty ?? null,
    safeExternalUrl(noteUrls[v.comment.noteKey]) ?? '', v.analysis.profileVersion, v.analysis.createdAt,
  ]);
  return [header, ...rows];
}
