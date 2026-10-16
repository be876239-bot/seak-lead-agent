import type {
  Analysis, Batch, Comment, Job, Note, Product, ProductProfile, ProductSourceBlock, Usage,
} from '../domain/schemas';
import type { ErrorCode as Code } from '../domain/errors';
import { AppError } from '../domain/errors';
import { contextHash, dedupeComments, hash64 } from '../domain/identity';
import { RULE_VERSION, groupDecision } from '../domain/classification';
import { buildCacheKey, CACHE_RULE_VERSION, filterUncached } from './cache';
import { LOCK_NAME, type LockHandle, type TaskLockManager } from './lock';
import { commentEstimate, planCommentBatches } from '../ai/batching';
import {
  buildClassificationInput, buildProfileInput, classificationOverheadChars,
  type ClassificationInput, type ProfileInput,
} from '../privacy/ai-payload';
import { COMMENT_PROMPT_VERSION, PROFILE_PROMPT_VERSION } from '../ai/prompts';
import { validateClassificationOutput, validateProfileOutput, type ValidatedResult } from '../ai/validate-result';
import type { AIProvider, AIResponse, RepairTurn } from '../ai/provider';
import type { Repositories } from '../storage/repositories';

export type RunnerDeps = {
  repos: Repositories;
  provider: AIProvider;
  lock: TaskLockManager;
  providerName: string;
  modelId: string;
  /** 可重试错误的自动重试延迟；集成测试注入 0 以免变慢。 */
  retryDelayMs?: number;
};

const DEFAULT_RETRY_DELAY_MS = 1500;

export type ProgressInfo = {
  jobId: string;
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
};

type Candidate = { comment: Comment; cacheKey: string; contextHash: string };

const nowIso = () => new Date().toISOString();

function ensureAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const detail = err instanceof Error ? `${err.name}:${err.message}` : String(err);
  return new AppError('UNKNOWN', `未预期的内部错误：${detail.slice(0, 200)}`);
}

function abortedCode(handle: LockHandle): Code {
  const reason = handle.signal.reason as { code?: Code } | undefined;
  return reason?.code === 'CANCELLED' ? 'CANCELLED' : 'LOCK_HELD';
}

/** 外显错误摘要：校验类报错正文含引文（评论原文），只保留"："前的说明段；其余 message 均为自撰文案可完整外显。 */
function safeErrSummary(e: AppError): string {
  return (e.code === 'AI_INVALID_OUTPUT' ? (e.message.split('：')[0] ?? e.code) : e.message).slice(0, 140);
}

const claimText = (p: ProductProfile): string =>
  [p.name, p.category, p.summary, p.accessMethod, p.price, p.purchaseChannel]
    .map((c) => c.value ?? '')
    .concat(
      p.capabilities.map((c) => c.value ?? ''),
      p.targetAudience.map((c) => c.value ?? ''),
      p.needsServed.map((c) => c.value ?? ''),
      p.exclusions.map((c) => c.value ?? ''),
    )
    .join('\u0001');

function buildCandidates(
  deps: RunnerDeps, product: Product, note: Note, comments: Comment[],
): { candidates: Candidate[]; parentLookup: Map<string, Comment> } {
  const parentLookup = new Map(comments.map((c) => [c.commentKey, c]));
  const productContext = claimText(product.profile);
  const noteContext = `${note.title}\u0001${note.bodyExcerpt}`;
  const candidates = comments.map((c) => {
    const ch = contextHash({
      productContext,
      noteContext,
      parentContext: c.parentKey ? parentLookup.get(c.parentKey)?.text ?? '' : '',
    });
    return {
      comment: c,
      contextHash: ch,
      cacheKey: buildCacheKey({
        productId: product.id, profileVersion: product.profileVersion, commentKey: c.commentKey,
        contextHash: ch, provider: deps.providerName, modelId: deps.modelId,
        promptVersion: COMMENT_PROMPT_VERSION, ruleVersion: CACHE_RULE_VERSION,
      }),
    };
  });
  return { candidates, parentLookup };
}

function mkUsage(ctx: {
  jobId: string; batchId: string | null; deps: RunnerDeps;
}): (u: Omit<Usage, 'id' | 'jobId' | 'batchId' | 'modelId' | 'createdAt' | 'estimatedCny' | 'priceVerifiedAt'>) => Usage {
  return (partial) => ({
    id: crypto.randomUUID(),
    jobId: ctx.jobId,
    batchId: ctx.batchId,
    modelId: ctx.deps.modelId,
    estimatedCny: null,
    priceVerifiedAt: null,
    createdAt: nowIso(),
    ...partial,
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 单批分类：可重试错误自动重试 1 次；格式无效修复 1 次；无静默无限重试。失败/无效尝试的用量即时落库。 */
async function classifyWithRepair(
  deps: RunnerDeps, jobId: string, row: Batch, input: ClassificationInput, handle: LockHandle,
  log?: (m: string) => void,
): Promise<{ resp: AIResponse; validated: ValidatedResult[]; durationMs: number }> {
  const mk = mkUsage({ jobId, batchId: row.id, deps });
  const delay = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let attemptIndex = 0;
  let repair: RepairTurn | undefined;
  let retryableRetried = false;

  for (;;) {
    const t0 = Date.now();
    let resp: AIResponse;
    try {
      resp = await deps.provider.classifyComments(input, handle.signal, repair);
    } catch (err) {
      const e = ensureAppError(err);
      await deps.repos.addUsage(mk({
        attemptIndex, status: e.code === 'CANCELLED' ? 'failed' : 'unknown',
        providerRequestId: null,
        inputTokens: null, outputTokens: null, durationMs: Date.now() - t0,
      }));
      if (e.code === 'CANCELLED') throw e;
      if (e.retryable && !retryableRetried && !handle.signal.aborted) {
        retryableRetried = true;
        attemptIndex += 1;
        log?.(`模型调用失败（${e.code}：${safeErrSummary(e)}），${Math.round(delay / 1000)} 秒后自动重试 1 次…`);
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
    attemptIndex += 1;
    try {
      return { resp, validated: validateClassificationOutput(resp.value, input), durationMs: Date.now() - t0 };
    } catch (err) {
      const e = ensureAppError(err);
      // 调用成功但输出无效：供应商可能已计费，如实记 unknown；修复仅一次
      await deps.repos.addUsage(mk({
        attemptIndex: attemptIndex - 1, status: 'unknown',
        providerRequestId: resp.providerRequestId ?? null,
        inputTokens: null, outputTokens: null, durationMs: Date.now() - t0,
      }));
      if (e.code !== 'AI_INVALID_OUTPUT' || repair) throw e;
      log?.(`批次输出校验未通过（${safeErrSummary(e)}），发起修复重发（最多 1 次）…`);
      repair = { errorSummary: e.message, badOutput: safeJson(resp.value) };
    }
  }
}

type Outcome = { cancelled: boolean; interrupted: boolean; completedItems: number; failedItems: number; firstError: Code | null };

async function executeRows(
  deps: RunnerDeps,
  ctx: { jobId: string; product: Product; note: Note; handle: LockHandle },
  rows: Batch[],
  parentLookup: Map<string, Comment>,
  candidateByCommentKey: Map<string, Candidate>,
  onProgress?: (p: ProgressInfo) => void,
  log?: (m: string) => void,
): Promise<Outcome> {
  const outcome: Outcome = { cancelled: false, interrupted: false, completedItems: 0, failedItems: 0, firstError: null };
  const total = rows.length;
  let done = 0;
  let failed = 0;

  const stopRemaining = async (reason: 'interrupted' | 'cancelled') => {
    for (const r of rows) {
      if (r.status === 'pending' || r.status === 'running') {
        r.status = 'interrupted';
        await deps.repos.updateBatch(r.id, { status: 'interrupted' });
      }
    }
    if (reason === 'cancelled') outcome.cancelled = true;
    else outcome.interrupted = true;
  };

  for (const row of rows) {
    if (row.status === 'completed') { done += 1; continue; }
    if (ctx.handle.signal.aborted) { await stopRemaining(abortedCode(ctx.handle) === 'CANCELLED' ? 'cancelled' : 'interrupted'); break; }
    try {
      await deps.lock.assertOwned(ctx.handle);
    } catch {
      await stopRemaining('interrupted');
      outcome.firstError ??= 'LOCK_HELD';
      break;
    }

    const rowComments = row.commentKeys.map((k) => parentLookup.get(k));
    if (rowComments.some((c) => !c)) {
      row.status = 'failed';
      failed += 1;
      outcome.firstError ??= 'STORAGE_ERROR';
      await deps.repos.updateBatch(row.id, { status: 'failed', errorCode: 'STORAGE_ERROR' });
      continue;
    }
    const comments = rowComments as Comment[];

    // 缓存复查：重试或并发任务可能已完成本批，不再调用 AI
    const existing = await deps.repos.existingCacheKeys(row.cacheKeys);
    if (row.cacheKeys.length > 0 && row.cacheKeys.every((k) => existing.has(k))) {
      await deps.repos.commitBatch({ batchId: row.id, analyses: [], usage: [] });
      row.status = 'completed';
      done += 1;
      outcome.completedItems += comments.length;
      log?.(`批次 ${row.index + 1}/${total} 缓存命中（${comments.length} 条），不调用模型`);
      continue;
    }

    await deps.repos.updateBatch(row.id, { status: 'running', startedAt: nowIso() });
    const budget =
      classificationOverheadChars(ctx.product.profile, ctx.note) +
      comments.reduce((n, c) => n + commentEstimate(c, parentLookup), 0);
    const { input } = buildClassificationInput(ctx.product.profile, ctx.note, comments, parentLookup, budget);
    log?.(`批次 ${row.index + 1}/${total} 已提交模型（${comments.length} 条，约 ${budget} 字符），等待返回…`);

    try {
      const { resp, validated, durationMs } = await classifyWithRepair(deps, ctx.jobId, row, input, ctx.handle, log);
      const mk = mkUsage({ jobId: ctx.jobId, batchId: row.id, deps });
      const successUsage = mk({
        attemptIndex: 0, status: 'success',
        providerRequestId: resp.providerRequestId ?? null,
        inputTokens: resp.usage.inputTokens, outputTokens: resp.usage.outputTokens, durationMs,
      });
      const analyses: Analysis[] = validated.map((v) => {
        const commentKey = input.idMap.find((m) => m.tempId === v.decision.commentId)?.commentKey ?? v.decision.commentId;
        const cand = candidateByCommentKey.get(commentKey);
        return {
          id: crypto.randomUUID(),
          cacheKey: cand?.cacheKey ?? row.cacheKeys[0]!,
          productId: ctx.product.id,
          profileVersion: ctx.product.profileVersion,
          commentKey,
          contextHash: cand?.contextHash ?? `ctx:${hash64(commentKey)}`,
          decision: v.decision,
          group: groupDecision(v.decision, v.hasSelfEvidence),
          modelId: resp.model,
          promptVersion: COMMENT_PROMPT_VERSION,
          ruleVersion: RULE_VERSION,
          createdAt: nowIso(),
        };
      });
      await deps.repos.commitBatch({ batchId: row.id, analyses, usage: [successUsage] });
      row.status = 'completed';
      done += 1;
      outcome.completedItems += comments.length;
      log?.(`批次 ${row.index + 1}/${total} 完成：耗时 ${(durationMs / 1000).toFixed(1)} 秒`
        + `${resp.usage.inputTokens != null ? `，tokens ${resp.usage.inputTokens}/${resp.usage.outputTokens ?? '?'}` : '（模型未回报 token）'}`);
    } catch (err) {
      const e = ensureAppError(err);
      // 失败尝试的用量先落库（AI 可能已计费但未保存结果）
      if (e.code === 'CANCELLED') {
        row.status = 'interrupted';
        await deps.repos.updateBatch(row.id, { status: 'interrupted' });
        await stopRemaining('cancelled');
        break;
      }
      row.status = 'failed';
      failed += 1;
      outcome.failedItems += comments.length;
      outcome.firstError ??= e.code;
      await deps.repos.updateBatch(row.id, { status: 'failed', errorCode: e.code });
      log?.(`批次 ${row.index + 1}/${total} 失败：${e.code}（${safeErrSummary(e)}）`);
      if (e.code === 'AI_AUTH') {
        await stopRemaining('interrupted');
        break;
      }
    }
    onProgress?.({ jobId: ctx.jobId, totalBatches: total, completedBatches: done, failedBatches: failed });
  }
  return outcome;
}

function jobFinalStatus(outcome: Outcome, rows: Batch[]): { status: Job['status']; errorCode: Code | null } {
  if (outcome.cancelled) return { status: 'cancelled', errorCode: 'CANCELLED' };
  if (outcome.interrupted) return { status: 'interrupted', errorCode: outcome.firstError };
  const allDone = rows.every((r) => r.status === 'completed');
  if (allDone) return { status: 'completed', errorCode: null };
  const anyCompleted = rows.some((r) => r.status === 'completed');
  const anyFailed = rows.some((r) => r.status === 'failed');
  if (anyCompleted || !anyFailed) return { status: 'partial', errorCode: outcome.firstError };
  return { status: 'failed', errorCode: outcome.firstError };
}

export async function runCommentsJob(
  deps: RunnerDeps,
  spec: {
    productId: string; note: Note; comments: Comment[]; jobId?: string; tabId?: number | null;
    onProgress?: (p: ProgressInfo) => void; log?: (m: string) => void;
  },
): Promise<Job> {
  const jobId = spec.jobId ?? crypto.randomUUID();
  const job: Job = {
    id: jobId, kind: 'comments', status: 'created', ownerId: '', generation: 0,
    productId: spec.productId, profileVersion: null, tabId: spec.tabId ?? null, noteKey: spec.note.noteKey,
    provider: deps.providerName, modelId: deps.modelId, promptVersion: COMMENT_PROMPT_VERSION,
    totalItems: 0, completedItems: 0, failedItems: 0,
    createdAt: nowIso(), updatedAt: nowIso(), errorCode: null,
  };
  // Job 行先建后跑：面板随时可轮询到 created/failed，锁冲突也留痕
  if (await deps.repos.getJob(jobId)) await deps.repos.updateJob(jobId, job);
  else await deps.repos.createJob(job);

  let handle: LockHandle | null = null;
  try {
    const product = await deps.repos.getProduct(spec.productId);
    if (!product) throw new AppError('STORAGE_ERROR', '产品不存在');
    const comments = dedupeComments(spec.comments);
    for (const c of comments) {
      if (c.noteKey !== spec.note.noteKey) throw new AppError('PAGE_CHANGED', '评论与笔记不匹配，拒绝把旧快照写入新笔记');
    }
    handle = await deps.lock.acquire(LOCK_NAME, jobId);

    const { candidates, parentLookup } = buildCandidates(deps, product, spec.note, comments);
    const existing = await deps.repos.existingCacheKeys(candidates.map((c) => c.cacheKey));
    const uncached = filterUncached(existing, candidates);
    const batches = planCommentBatches(uncached, parentLookup, product.profile, spec.note);

    await deps.repos.updateJob(jobId, {
      status: 'analyzing', ownerId: handle.ownerId, generation: handle.generation,
      profileVersion: product.profileVersion, totalItems: uncached.length,
    });
    job.status = 'analyzing'; job.ownerId = handle.ownerId; job.generation = handle.generation;
    job.profileVersion = product.profileVersion; job.totalItems = uncached.length;

    const rows: Batch[] = batches.map((b, i) => ({
      id: crypto.randomUUID(), jobId, index: i, status: 'pending',
      cacheKeys: b.cacheKeys, commentKeys: b.comments.map((c) => c.commentKey),
      attemptCount: 0, inputHash: hash64(JSON.stringify(b.cacheKeys)),
      startedAt: null, completedAt: null, errorCode: null,
    }));
    if (rows.length) await deps.repos.addBatches(rows);
    spec.log?.(`批次规划：${uncached.length} 条需模型分析（共 ${rows.length} 批，逐批串行提交）`
      + `，${comments.length - uncached.length} 条已有结果走缓存不产生费用`);

    const candidateByCommentKey = new Map(candidates.map((c) => [c.comment.commentKey, c]));
    const outcome = rows.length
      ? await executeRows(deps, { jobId, product, note: spec.note, handle }, rows, parentLookup, candidateByCommentKey, spec.onProgress, spec.log)
      : { cancelled: false, interrupted: false, completedItems: 0, failedItems: 0, firstError: null as Code | null };
    const fin = jobFinalStatus(outcome, rows);
    await deps.repos.updateJob(jobId, {
      status: fin.status, errorCode: fin.errorCode,
      completedItems: outcome.completedItems, failedItems: outcome.failedItems,
    });
    return { ...job, status: fin.status, errorCode: fin.errorCode, completedItems: outcome.completedItems, failedItems: outcome.failedItems };
  } catch (err) {
    const e = ensureAppError(err);
    const status: Job['status'] = e.code === 'CANCELLED' ? 'cancelled' : 'failed';
    await deps.repos.updateJob(jobId, { status, errorCode: e.code });
    throw e;
  } finally {
    if (handle) await deps.lock.release(handle);
  }
}

/** 手动重试：仅重跑 failed/interrupted 批次，completed 批次绝不重跑。 */
export async function retryCommentsJob(
  deps: RunnerDeps, jobId: string,
  onProgress?: (p: ProgressInfo) => void, log?: (m: string) => void,
): Promise<Job> {
  const job = await deps.repos.getJob(jobId);
  if (!job || job.kind !== 'comments') throw new AppError('STORAGE_ERROR', '任务不存在');
  if (!['failed', 'partial', 'cancelled', 'interrupted'].includes(job.status)) {
    throw new AppError('UNKNOWN', '仅失败、部分完成或中断的任务支持手动重试');
  }
  const product = await deps.repos.getProduct(job.productId!);
  const note = await deps.repos.getNote(job.noteKey!);
  if (!product || !note) throw new AppError('STORAGE_ERROR', '任务上下文缺失');

  const rows = await deps.repos.batchesForJob(jobId);
  const retryable = rows.filter((r) => r.status === 'failed' || r.status === 'interrupted');
  if (!retryable.length) throw new AppError('UNKNOWN', '没有失败或中断的批次可重试');
  log?.(`重试计划：${retryable.length} 个失败或中断的批次将重新提交模型`);
  for (const r of retryable) {
    r.status = 'pending';
    r.errorCode = null;
    await deps.repos.updateBatch(r.id, { status: 'pending', errorCode: null });
  }

  const handle = await deps.lock.acquire(LOCK_NAME, jobId);
  try {
    await deps.repos.updateJob(jobId, {
      status: 'analyzing', ownerId: handle.ownerId, generation: handle.generation, errorCode: null,
    });
    const allComments = await deps.repos.getComments(rows.flatMap((r) => r.commentKeys));
    const parentKeys = allComments.map((c) => c.parentKey).filter((k): k is string => !!k);
    const parents = await deps.repos.getComments(parentKeys);
    const merged = [...allComments, ...parents];
    const { candidates, parentLookup } = buildCandidates(deps, product, note, merged);
    const candidateByCommentKey = new Map(candidates.map((c) => [c.comment.commentKey, c]));
    const outcome = await executeRows(deps, { jobId, product, note, handle }, rows, parentLookup, candidateByCommentKey, onProgress, log);
    const fin = jobFinalStatus(outcome, rows);
    await deps.repos.updateJob(jobId, {
      status: fin.status, errorCode: fin.errorCode,
      completedItems: job.completedItems + outcome.completedItems,
      failedItems: outcome.failedItems,
    });
    return { ...job, status: fin.status, errorCode: fin.errorCode };
  } finally {
    await deps.lock.release(handle);
  }
}

/** 产品画像生成（T10）：来源块 → DTO → 模型 → 校验（修复一次）→ 保存。 */
export async function runProfileGeneration(
  deps: RunnerDeps,
  spec: {
    inputUrl: string; finalUrl: string; blocks: ProductSourceBlock[];
    existingProductId?: string; jobId?: string; log?: (m: string) => void;
  },
): Promise<Product> {
  const jobId = spec.jobId ?? crypto.randomUUID();
  const job: Job = {
    id: jobId, kind: 'product', status: 'created', ownerId: '', generation: 0,
    productId: spec.existingProductId ?? null, profileVersion: null, tabId: null, noteKey: null,
    provider: deps.providerName, modelId: deps.modelId, promptVersion: PROFILE_PROMPT_VERSION,
    totalItems: 1, completedItems: 0, failedItems: 0,
    createdAt: nowIso(), updatedAt: nowIso(), errorCode: null,
  };
  if (await deps.repos.getJob(jobId)) await deps.repos.updateJob(jobId, job);
  else await deps.repos.createJob(job);
  const mk = mkUsage({ jobId, batchId: null, deps });

  let handle: LockHandle | null = null;
  try {
    handle = await deps.lock.acquire(LOCK_NAME, jobId);
    await deps.repos.updateJob(jobId, { status: 'analyzing', ownerId: handle.ownerId, generation: handle.generation });
    const input: ProfileInput = buildProfileInput(spec.blocks.map((b) => ({ id: b.id, text: b.text })));

    let profile!: ProductProfile;
    let resp!: AIResponse;
    const retryDelay = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    let attemptIndex = 0;
    let repair: RepairTurn | undefined;
    let retryableRetried = false;
    let lastCallMs = 0;
    for (;;) {
      const t0 = Date.now();
      try {
        resp = await deps.provider.generateProfile(input, handle.signal, repair);
      } catch (err) {
        const e = ensureAppError(err);
        await deps.repos.addUsage(mk({
          attemptIndex, status: e.code === 'CANCELLED' ? 'failed' : 'unknown',
          providerRequestId: null,
          inputTokens: null, outputTokens: null, durationMs: Date.now() - t0,
        }));
        if (e.code === 'CANCELLED' || !(e.retryable && !retryableRetried)) throw e;
        retryableRetried = true;
        attemptIndex += 1;
        spec.log?.(`模型调用失败（${e.code}：${safeErrSummary(e)}），${Math.round(retryDelay / 1000)} 秒后自动重试 1 次…`);
        if (retryDelay > 0) await new Promise((r) => setTimeout(r, retryDelay));
        continue;
      }
      attemptIndex += 1;
      lastCallMs = Date.now() - t0;
      try {
        profile = validateProfileOutput(resp.value, input.blocks);
        spec.log?.(`模型返回画像：耗时 ${(lastCallMs / 1000).toFixed(1)} 秒，引文校验通过`);
        break;
      } catch (err) {
        const e = ensureAppError(err);
        await deps.repos.addUsage(mk({
          attemptIndex: attemptIndex - 1, status: 'unknown',
          providerRequestId: resp.providerRequestId ?? null,
          inputTokens: null, outputTokens: null, durationMs: Date.now() - t0,
        }));
        if (e.code !== 'AI_INVALID_OUTPUT' || repair) throw e;
        spec.log?.(`画像输出校验未通过（${safeErrSummary(e)}），发起修复重发（最多 1 次）…`);
        repair = { errorSummary: e.message, badOutput: safeJson(resp.value) };
      }
    }
    await deps.repos.addUsage(mk({
      attemptIndex: attemptIndex - 1, status: 'success',
      inputTokens: resp.usage.inputTokens, outputTokens: resp.usage.outputTokens, durationMs: lastCallMs,
      providerRequestId: resp.providerRequestId ?? null,
    }));
    const product = spec.existingProductId
      ? await deps.repos.replaceProfile(spec.existingProductId, profile, spec.blocks)
      : await deps.repos.createProduct({
          inputUrl: spec.inputUrl, finalUrl: spec.finalUrl, profile,
          sourceBlocks: spec.blocks, modelId: resp.model, promptVersion: PROFILE_PROMPT_VERSION,
        });
    await deps.repos.updateJob(jobId, {
      status: 'completed', productId: product.id, profileVersion: product.profileVersion, completedItems: 1,
    });
    return product;
  } catch (err) {
    const e = ensureAppError(err);
    const status: Job['status'] = e.code === 'CANCELLED' ? 'cancelled' : 'failed';
    await deps.repos.updateJob(jobId, { status, errorCode: e.code, failedItems: 1 });
    throw e;
  } finally {
    if (handle) await deps.lock.release(handle);
  }
}
