import { getProvider } from '../ai/factory';
import { COMMENT_PROMPT_VERSION, PROFILE_PROMPT_VERSION } from '../ai/prompts';
import { AppError, toErrorPayload } from '../domain/errors';
import type { Job } from '../domain/schemas';
import { registerSensitiveHandler } from '../messaging/handlers';
import { readRenderedProduct } from '../product/render-reader';
import { collectProductSources } from '../product/service';
import { loadCredential, resolveBaseUrl } from '../storage/credentials';
import { getDb } from '../storage/db';
import { Repositories } from '../storage/repositories';
import { emitJobLog } from '../ui/joblog';
import { captureNote } from '../xhs/capture';
import { TaskLockManager } from './lock';
import { retryCommentsJob, runCommentsJob, runProfileGeneration, type RunnerDeps } from './runner';

/** 后台共享单例：启动恢复与全部任务协调共用同一 Repositories / TaskLockManager。 */
export const analysisRepos = new Repositories(getDb());
export const analysisLock = new TaskLockManager(analysisRepos);

const nowIso = () => new Date().toISOString();

async function makeDeps(): Promise<RunnerDeps> {
  const cred = await loadCredential();
  if (!cred || !cred.apiKey.trim()) throw new AppError('AI_AUTH', '未配置 API Key，请先在设置页保存');
  const baseUrl = resolveBaseUrl(cred);
  const provider = getProvider({ apiKey: cred.apiKey.trim(), baseUrl, model: cred.model });
  return { repos: analysisRepos, provider, lock: analysisLock, providerName: cred.presetId, modelId: cred.model };
}

async function upsertJob(job: Job): Promise<void> {
  if (await analysisRepos.getJob(job.id)) await analysisRepos.updateJob(job.id, job);
  else await analysisRepos.createJob(job);
}

const TERMINAL: Job['status'][] = ['completed', 'partial', 'failed', 'cancelled', 'interrupted'];

/** 采集阶段（尚未持锁）的可取消标记；进入 runner 后由锁句柄负责取消。 */
const capturing = new Map<string, { cancelled: boolean; controller?: AbortController }>();

function baseJob(deps: RunnerDeps, id: string): Job {
  return {
    id, kind: 'product', status: 'created', ownerId: '', generation: 0,
    productId: null, profileVersion: null, tabId: null, noteKey: null,
    provider: deps.providerName, modelId: deps.modelId, promptVersion: PROFILE_PROMPT_VERSION,
    totalItems: 1, completedItems: 0, failedItems: 0,
    createdAt: nowIso(), updatedAt: nowIso(), errorCode: null,
  };
}

async function markFailedIfOpen(jobId: string, code: string): Promise<void> {
  const job = await analysisRepos.getJob(jobId);
  if (!job || TERMINAL.includes(job.status)) return;
  await analysisRepos.updateJob(jobId, {
    status: code === 'CANCELLED' ? 'cancelled' : 'failed',
    errorCode: code as Job['errorCode'],
  });
}

function failLog(jobId: string, err: unknown): void {
  const e = toErrorPayload(err);
  // 校验类报错正文含引文原文（可能是评论文本）：日志只保留"："前的说明，不外泄正文
  const detail = e.code === 'AI_INVALID_OUTPUT' ? (e.message.split('：')[0] ?? e.code) : e.message.slice(0, 200);
  emitJobLog(jobId, `失败：${e.code} ${detail}`, 'error');
}

export function registerAnalysisHandlers(): void {
  registerSensitiveHandler('PRODUCT_CREATE', async (req) => {
    if (req.type !== 'PRODUCT_CREATE') throw new Error('类型错误');
    const { jobId, url, existingProductId } = req.payload;
    const deps = await makeDeps();
    await upsertJob({ ...baseJob(deps, jobId), productId: existingProductId ?? null });
    const controller = new AbortController();
    const flag = { cancelled: false, controller };
    capturing.set(jobId, flag);
    emitJobLog(jobId, `任务开始（模型 ${deps.modelId}）；读取产品页 ${new URL(url).host}`);
    try {
      const sources = await collectProductSources(url, jobId, controller.signal,
        (jid, u) => readRenderedProduct(jid, u, controller.signal));
      if (flag.cancelled) throw new AppError('CANCELLED', '产品读取已取消');
      emitJobLog(jobId,
        `页面读取完成：${sources.blocks.length} 个来源块 / ${sources.totalChars} 字符`
        + `${sources.renderUsed ? '（含渲染兜底）' : ''}${sources.truncated ? '（已截断）' : ''}${sources.degraded ? '（降级读取）' : ''}`);
      emitJobLog(jobId, '提交模型生成产品画像（格式错误最多修复一次）');
      const product = await runProfileGeneration(deps, {
        jobId, inputUrl: sources.inputUrl, finalUrl: sources.finalUrl,
        blocks: sources.blocks, existingProductId,
        log: (m) => emitJobLog(jobId, m),
      });
      emitJobLog(jobId, `画像已保存（产品 ${product.id}，画像版本 ${product.profileVersion}）`);
      return { jobId, productId: product.id };
    } catch (err) {
      failLog(jobId, err);
      await markFailedIfOpen(jobId, toErrorPayload(err).code);
      throw err;
    } finally {
      capturing.delete(jobId);
    }
  });

  registerSensitiveHandler('NOTE_ANALYZE', async (req) => {
    if (req.type !== 'NOTE_ANALYZE') throw new Error('类型错误');
    const { jobId, tabId, productId } = req.payload;
    const deps = await makeDeps();
    const product = await analysisRepos.getProduct(productId);
    if (!product) throw new AppError('STORAGE_ERROR', '产品不存在');
    await upsertJob({
      ...baseJob(deps, jobId), kind: 'comments', tabId, productId, status: 'collecting',
      totalItems: 0, promptVersion: COMMENT_PROMPT_VERSION,
    });
    emitJobLog(jobId, `任务开始（模型 ${deps.modelId}）；增量采集当前笔记评论（正常滚动，最多500条）`);
    const controller = new AbortController();
    const flag = { cancelled: false, controller };
    capturing.set(jobId, flag);
    void (async () => {
      const snap = await captureNote(tabId, {
        autoLoad: true, signal: controller.signal,
        onDelta: (note, comments) => analysisRepos.saveCaptureDelta(jobId, note, comments, controller.signal),
        onProgress: async (collection) => {
          if (flag.cancelled) return;
          await analysisRepos.updateJob(jobId, { collection });
          if (collection.stopReason) emitJobLog(jobId, `采集停止：${collection.stopReason}；累计${collection.discoveredCount}条（不代表全部评论）`);
        },
      });
      if (flag.cancelled) {
        emitJobLog(jobId, '采集阶段被取消');
        await analysisRepos.updateJob(jobId, { status: 'cancelled', errorCode: 'CANCELLED' });
        return;
      }
      emitJobLog(jobId, `已累计保存 ${snap.comments.length} 条评论${snap.truncated ? '（达到安全上限）' : ''}；停止原因：${snap.stopReason ?? '快照'}，不承诺全部评论`);
      const job = await runCommentsJob(deps, {
        productId, note: snap.note, comments: snap.comments, jobId, tabId,
        log: (m) => emitJobLog(jobId, m),
        onProgress: (p) => emitJobLog(jobId,
          `批次进度：${p.completedBatches + p.failedBatches}/${p.totalBatches}`
          + `（成功 ${p.completedBatches}，失败 ${p.failedBatches}）`),
      });
      emitJobLog(jobId, `任务结束：${job.status}${job.errorCode ? `（${job.errorCode}）` : ''}`);
    })().catch((err) => {
      failLog(jobId, err);
      return markFailedIfOpen(jobId, toErrorPayload(err).code);
    }).finally(() => {
      capturing.delete(jobId);
    });
    return { jobId };
  });

  registerSensitiveHandler('JOB_GET', async (req) => {
    if (req.type !== 'JOB_GET') throw new Error('类型错误');
    const job = await analysisRepos.getJob(req.payload.jobId);
    const batches = job ? await analysisRepos.batchesForJob(job.id) : [];
    return { job, batches };
  });

  registerSensitiveHandler('JOB_CANCEL', async (req) => {
    if (req.type !== 'JOB_CANCEL') throw new Error('类型错误');
    const { jobId } = req.payload;
    const handle = analysisLock.findHandleByJob(jobId);
    if (handle) {
      await analysisLock.cancel(handle);
      return { cancelling: true };
    }
    const flag = capturing.get(jobId);
    if (flag) {
      flag.cancelled = true;
      flag.controller?.abort();
      const job = await analysisRepos.getJob(jobId);
      await analysisRepos.updateJob(jobId, { status: 'cancelled', errorCode: 'CANCELLED',
        ...(job?.collection ? { collection: { ...job.collection, loading: false, stopReason: 'cancelled' as const } } : {}),
      });
      return { cancelling: true };
    }
    return { cancelling: false };
  });

  registerSensitiveHandler('JOB_RETRY', async (req) => {
    if (req.type !== 'JOB_RETRY') throw new Error('类型错误');
    const deps = await makeDeps();
    emitJobLog(req.payload.jobId, '手动重试：只重跑失败或中断的批次');
    void retryCommentsJob(deps, req.payload.jobId, (p) => {
      emitJobLog(req.payload.jobId,
        `批次进度：${p.completedBatches + p.failedBatches}/${p.totalBatches}`
        + `（成功 ${p.completedBatches}，失败 ${p.failedBatches}）`);
    }, (m) => emitJobLog(req.payload.jobId, m)).then((job) => {
      emitJobLog(req.payload.jobId, `任务结束：${job.status}${job.errorCode ? `（${job.errorCode}）` : ''}`);
    }).catch((err) => {
      failLog(req.payload.jobId, err);
      return markFailedIfOpen(req.payload.jobId, toErrorPayload(err).code);
    });
    return { jobId: req.payload.jobId };
  });
}
