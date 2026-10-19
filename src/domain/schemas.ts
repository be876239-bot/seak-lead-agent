import { z } from 'zod';
import { LIMITS } from './limits';

export const UtcIso = z.iso.datetime();

export const DiscoveryTraceSchema=z.object({
  event:z.string().max(64),at:z.number(),taskId:z.string().max(64),runId:z.string().max(64),source:z.string().max(64),
  postIndex:z.number().int(),postKey:z.string().nullable(),postUrl:z.string().nullable(),phase:z.string(),
  taskState:z.string(),captureState:z.string(),analysisState:z.string(),pauseReason:z.string().nullable(),commentCount:z.number(),
  checkpoint:z.object({stage:z.string(),captureComplete:z.boolean(),analysisComplete:z.boolean()}),
  navigation:z.object({phase:z.string(),expectedNoteKey:z.string().nullable(),actualUrl:z.string().nullable(),resolvedPostKey:z.string().nullable(),hasNote:z.boolean().optional(),isSearch:z.boolean().optional(),matchesSearch:z.boolean().optional()}),
});
export type DiscoveryTrace=z.infer<typeof DiscoveryTraceSchema>;

export const EvidenceSchema = z.object({
  sourceId: z.string().min(1).max(64),
  quote: z.string().min(1).max(LIMITS.maxEvidenceQuoteChars),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ClaimStatus = z.enum(['observed', 'inferred', 'unknown', 'user_edited']);
export const ClaimSchema = z.object({
  value: z.string().max(LIMITS.maxClaimValueChars).nullable(),
  status: ClaimStatus,
  evidence: z.array(EvidenceSchema).max(LIMITS.maxClaimEvidence),
}).refine((c) => (c.status === 'unknown' ? c.value === null : c.value !== null), {
  message: 'unknown claim must have null value; others must have value',
});
export type Claim = z.infer<typeof ClaimSchema>;

const ClaimList = (max: number) => z.array(ClaimSchema).max(max);

export const ProductProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: ClaimSchema,
  category: ClaimSchema,
  summary: ClaimSchema,
  capabilities: ClaimList(LIMITS.maxProfileList),
  targetAudience: ClaimList(LIMITS.maxProfileList),
  needsServed: ClaimList(LIMITS.maxProfileList),
  exclusions: ClaimList(LIMITS.maxProfileList),
  accessMethod: ClaimSchema,
  price: ClaimSchema,
  purchaseChannel: ClaimSchema,
  searchSuggestions: z.array(z.string().min(1).max(120)).max(LIMITS.maxProfileList),
});
export type ProductProfile = z.infer<typeof ProductProfileSchema>;

export const ProductSourceBlockSchema = z.object({
  id: z.string().min(1).max(32),
  url: z.string().url().max(LIMITS.maxUrlChars),
  text: z.string().max(LIMITS.maxProductChars),
  fetchedAt: UtcIso,
});
export type ProductSourceBlock = z.infer<typeof ProductSourceBlockSchema>;

export const ProductSchema = z.object({
  id: z.string().uuid(),
  inputUrl: z.string().url().max(LIMITS.maxUrlChars),
  finalUrl: z.string().url().max(LIMITS.maxUrlChars),
  profileVersion: z.number().int().min(1),
  profile: ProductProfileSchema,
  sourceBlocks: z.array(ProductSourceBlockSchema).max(LIMITS.maxProductPages),
  modelId: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(64),
  createdAt: UtcIso,
  updatedAt: UtcIso,
});
export type Product = z.infer<typeof ProductSchema>;

export const NoteSchema = z.object({
  noteKey: z.string().min(1).max(256),
  sourceUrl: z.string().max(LIMITS.maxUrlChars),
  title: z.string().max(LIMITS.maxNoteChars),
  bodyExcerpt: z.string().max(LIMITS.maxNoteChars),
  capturedAt: UtcIso,
  parserVersion: z.string().min(1).max(64),
});
export type Note = z.infer<typeof NoteSchema>;

export const IdentityQuality = z.enum(['strong', 'weak']);
export const CommentSchema = z.object({
  commentKey: z.string().min(1).max(512),
  noteKey: z.string().min(1).max(256),
  platformCommentId: z.string().max(128).nullable(),
  parentKey: z.string().max(512).nullable(),
  /** 旧数据缺省时按 parentKey 判断；true + null 表示父关系未确认的回复。 */
  isReply: z.boolean().optional(),
  text: z.string().min(1).max(LIMITS.maxCommentChars),
  authorDisplayName: z.string().max(120).nullable(),
  authorLocalKey: z.string().max(256).nullable(),
  profileUrl: z.string().max(LIMITS.maxUrlChars).nullable(),
  /** IP 属地等页面明示的位置文本（脱敏后仅本地保存与导出，绝不进 AI DTO） */
  locationText: z.string().max(60).nullish(),
  publishedText: z.string().max(120).nullable(),
  publishedAt: UtcIso.nullable(),
  likeCount: z.number().int().min(0).nullable(),
  capturedAt: UtcIso,
  identityQuality: IdentityQuality,
  truncated: z.boolean(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const DecisionSchema = z.strictObject({
  commentId: z.string().min(1).max(32),
  relevance: z.enum(['direct', 'adjacent', 'unrelated', 'unknown']),
  need: z.enum(['explicit', 'implicit', 'none', 'unknown']),
  purchaseIntent: z.enum(['explicit_buy', 'price_or_access', 'solution_seeking', 'free_only', 'none', 'unknown']),
  speakerRole: z.enum(['seeker', 'seller', 'sharer', 'unknown']),
  intentTarget: z.enum(['our_product', 'category', 'competitor', 'unknown']),
  productFit: z.enum(['supported', 'unsupported', 'unknown']),
  needSummary: z.string().min(1).max(300),
  evidence: z.array(EvidenceSchema).max(LIMITS.maxDecisionEvidence),
  reason: z.string().min(1).max(500),
  uncertainty: z.string().max(500).nullable(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const Group = z.enum(['high_intent', 'need', 'review', 'excluded']);
export type Group = z.infer<typeof Group>;

export const AnalysisSchema = z.object({
  id: z.string().uuid(),
  cacheKey: z.string().min(16).max(128),
  productId: z.string().uuid(),
  profileVersion: z.number().int().min(1),
  commentKey: z.string().min(1).max(512),
  contextHash: z.string().min(8).max(128),
  decision: DecisionSchema,
  group: Group,
  modelId: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(64),
  ruleVersion: z.string().min(1).max(64),
  createdAt: UtcIso,
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const FeedbackSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  commentKey: z.string().min(1).max(512),
  analysisId: z.string().uuid(),
  correctedGroup: Group.nullable(),
  note: z.string().max(500).nullable(),
  createdAt: UtcIso,
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const LeadStateSchema = z.object({
  id: z.string().min(1).max(600),
  productId: z.string().uuid(),
  commentKey: z.string().min(1).max(512),
  handled: z.boolean(),
  updatedAt: UtcIso,
});
export type LeadState = z.infer<typeof LeadStateSchema>;

export const DiscoveryNavigationSchema=z.object({
  mode:z.literal('dom-click-v1'),sourceUrl:z.string().url().max(LIMITS.maxUrlChars),
  phase:z.enum(['search','opening','note','returning']),expectedNoteKey:z.string().max(256).nullable(),
});
export type DiscoveryNavigation=z.infer<typeof DiscoveryNavigationSchema>;

export const JobKind = z.enum(['product', 'comments', 'discovery']);
export const CaptureBudgetSchema = z.object({
  noteKey:z.string().min(1).max(256),
  displayedCommentCount:z.number().int().nonnegative().nullable().default(null),
  elapsedMs:z.number().min(0).max(LIMITS.captureHardDurationMs),
  rounds:z.number().int().min(0).max(LIMITS.captureHardRounds),
  durationMs:z.number().min(LIMITS.captureMaxDurationMs).max(LIMITS.captureHardDurationMs),
  maxRounds:z.number().int().min(LIMITS.captureMaxRounds).max(LIMITS.captureHardRounds),
  progressCount:z.number().int().min(0).max(LIMITS.maxSessionComments),
  lastProgressElapsedMs:z.number().min(0).max(LIMITS.captureHardDurationMs),
  extensionCount:z.number().int().min(0).max(LIMITS.maxSessionComments),
  lastExtensionElapsedMs:z.number().min(0).max(LIMITS.captureHardDurationMs),
});
export type CaptureBudget = z.infer<typeof CaptureBudgetSchema>;
export const ReplyLoadWarningsSchema=z.array(z.string().min(1).max(512)).max(LIMITS.maxReplyActions);
export const CaptureProgressSchema = z.object({
  replyLoadWarningCount:z.number().int().min(0).max(LIMITS.maxReplyActions).optional(),
  budget:CaptureBudgetSchema.optional(),
  discoveredCount: z.number().int().min(0).max(LIMITS.maxSessionComments),
  addedCount: z.number().int().min(0).max(LIMITS.maxSessionComments),
  topLevelCount: z.number().int().min(0).max(LIMITS.maxSessionComments).optional(),
  replyCount: z.number().int().min(0).max(LIMITS.maxSessionComments).optional(),
  unresolvedReplyCount: z.number().int().min(0).max(LIMITS.maxSessionComments).optional(),
  loadingReplies: z.boolean().optional(),
  /** Page-displayed comment total; informational because platform counting may differ from accessible DOM comments. */
  displayedCommentCount: z.number().int().nonnegative().nullable().optional(),
  countStatus: z.enum(['unknown','below_displayed_total','meets_or_exceeds_displayed_total']).optional(),
  loading: z.boolean(),
  stopReason: z.enum(['no_new', 'no_more', 'limit', 'time_limit', 'round_limit', 'cancelled', 'error']).nullable(),
});
export type CaptureProgress = z.infer<typeof CaptureProgressSchema>;
export const JobStatus = z.enum([
  'created', 'collecting', 'analyzing', 'completed', 'partial', 'failed', 'cancelled', 'interrupted',
]);
export const JobSchema = z.object({
  id: z.string().uuid(),
  kind: JobKind,
  status: JobStatus,
  ownerId: z.string().min(1).max(64),
  generation: z.number().int().min(0),
  productId: z.string().uuid().nullable(),
  profileVersion: z.number().int().min(1).nullable(),
  tabId: z.number().int().nullable(),
  noteKey: z.string().max(256).nullable(),
  provider: z.string().min(1).max(64),
  modelId: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(64),
  totalItems: z.number().int().min(0),
  completedItems: z.number().int().min(0),
  failedItems: z.number().int().min(0),
  createdAt: UtcIso,
  updatedAt: UtcIso,
  errorCode: z.string().max(64).nullable(),
  collection: CaptureProgressSchema.optional(),
  discovery: z.object({
    status:z.enum(['running','paused','stopped','completed']),index:z.number().int().min(0).max(100),total:z.number().int().min(0).max(100),
    comments:z.number().int().nonnegative(),currentComments:z.number().int().min(0).max(LIMITS.maxSessionComments),leads:z.number().int().nonnegative(),currentLeads:z.number().int().nonnegative(),
    navigation:DiscoveryNavigationSchema.optional(),
    completedNoteKeys:z.array(z.string().max(256)).max(100).optional(),
    partialPosts:z.number().int().min(0).max(100).optional(),
    post:z.object({stage:z.enum(['capturing','captured','completed','partial']),commentKeys:z.array(z.string().max(512)).max(LIMITS.maxSessionComments),captureBudget:CaptureBudgetSchema.optional(),replyLoadWarnings:ReplyLoadWarningsSchema.optional()}).optional(),
    trace:z.array(DiscoveryTraceSchema).max(200).optional(),
    targets:z.array(z.string().url().max(LIMITS.maxUrlChars)).max(100),sourceTabId:z.number().int().nonnegative(),
    phase:z.string().max(300),reason:z.string().max(500).nullable(),postElapsedMs:z.number().int().min(0).max(LIMITS.discoveryPostTimeoutMs).default(0),direction:z.string().max(200),
  }).optional(),
});
export type Job = z.infer<typeof JobSchema>;

export const BatchStatus = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted']);
export const BatchSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  index: z.number().int().min(0),
  status: BatchStatus,
  cacheKeys: z.array(z.string().max(128)).max(LIMITS.maxBatchItems),
  commentKeys: z.array(z.string().max(512)).max(LIMITS.maxBatchItems),
  attemptCount: z.number().int().min(0),
  inputHash: z.string().min(8).max(128),
  startedAt: UtcIso.nullable(),
  completedAt: UtcIso.nullable(),
  errorCode: z.string().max(64).nullable(),
});
export type Batch = z.infer<typeof BatchSchema>;

export const UsageSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  batchId: z.string().uuid().nullable(),
  attemptIndex: z.number().int().min(0),
  status: z.enum(['success', 'failed', 'unknown']),
  modelId: z.string().min(1).max(120),
  providerRequestId: z.string().max(120).nullable(),
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
  estimatedCny: z.number().min(0).nullable(),
  priceVerifiedAt: UtcIso.nullable(),
  durationMs: z.number().int().min(0),
  createdAt: UtcIso,
});
export type Usage = z.infer<typeof UsageSchema>;

export const LockSchema = z.object({
  name: z.string().min(1).max(64),
  ownerId: z.string().min(1).max(64),
  generation: z.number().int().min(0),
  jobId: z.string().uuid(),
  leaseExpiresAt: UtcIso,
});
export type Lock = z.infer<typeof LockSchema>;
