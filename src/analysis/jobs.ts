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
const capturing = new Map<string, { cancelled: boolean }>();

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

export function registerAnalysisHandlers(): void {
  registerSensitiveHandler('PRODUCT_CREATE', async (req) => {
    if (req.type !== 'PRODUCT_CREATE') throw new Error('类型错误');
    const { jobId, url, existingProductId } = req.payload;
    const deps = await makeDeps();
    await upsertJob({ ...baseJob(deps, jobId), productId: existingProductId ?? null });
    try {
      const sources = await collectProductSources(url, jobId, undefined,
        (jid, u) => readRenderedProduct(jid, u));
      const product = await runProfileGeneration(deps, {
        jobId, inputUrl: sources.inputUrl, finalUrl: sources.finalUrl,
        blocks: sources.blocks, existingProductId,
      });
      return { jobId, productId: product.id };
    } catch (err) {
      await markFailedIfOpen(jobId, toErrorPayload(err).code);
      throw err;
    }
  });

  registerSensitiveHandler('NOTE_ANALYZE', async (req) => {
    if (req.type !== 'NOTE_ANALYZE') throw new Error('类型错误');
    const { jobId, tabId, productId } = req.payload;
    const deps = await makeDeps();
    const product = await analysisRepos.getProduct(productId);
    if (!product) throw new AppError('STORAGE_ERROR', '产品不存在');
    await upsertJob({
      ...baseJob(deps, jobId), kind: 'comments', tabId, productId,
      totalItems: 0, promptVersion: COMMENT_PROMPT_VERSION,
    });
    const flag = { cancelled: false };
    capturing.set(jobId, flag);
    void (async () => {
      const snap = await captureNote(tabId);
      if (flag.cancelled) {
        await analysisRepos.updateJob(jobId, { status: 'cancelled', errorCode: 'CANCELLED' });
        return;
      }
      await analysisRepos.putNote(snap.note);
      await analysisRepos.putComments(snap.comments);
      await runCommentsJob(deps, { productId, note: snap.note, comments: snap.comments, jobId, tabId });
    })().catch(async (err) => {
      await markFailedIfOpen(jobId, toErrorPayload(err).code);
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
      await analysisRepos.updateJob(jobId, { status: 'cancelled', errorCode: 'CANCELLED' });
      return { cancelling: true };
    }
    return { cancelling: false };
  });

  registerSensitiveHandler('JOB_RETRY', async (req) => {
    if (req.type !== 'JOB_RETRY') throw new Error('类型错误');
    const deps = await makeDeps();
    void retryCommentsJob(deps, req.payload.jobId).catch(async (err) => {
      await markFailedIfOpen(req.payload.jobId, toErrorPayload(err).code);
    });
    return { jobId: req.payload.jobId };
  });
}
