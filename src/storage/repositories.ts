import Dexie from 'dexie';
import type {
  Analysis, Batch, Comment, Feedback, Job, LeadState, Note, Product, ProductProfile, Usage,
} from '../domain/schemas';
import { AppError } from '../domain/errors';
import type { SeekLeadDb } from './db';

const nowIso = () => new Date().toISOString();

function upsertProfileClaims(profile: ProductProfile, edited: Partial<ProductProfile>): ProductProfile {
  return { ...profile, ...edited };
}

export class Repositories {
  constructor(private db: SeekLeadDb) {}

  /** 在写结果的同一事务中检查租约，防止检查后被其他面板接管。 */
  async withOwnedLock<T>(
    handle: { name: string; ownerId: string; generation: number; signal: AbortSignal },
    write: () => Promise<T>,
  ): Promise<T> {
    return this.db.transaction('rw', [this.db.locks, this.db.products, this.db.analyses, this.db.usage, this.db.batches], async () => {
      if (handle.signal.aborted) {
        const reason = handle.signal.reason;
        throw reason instanceof AppError ? reason : new AppError('CANCELLED', '任务已取消');
      }
      const lease = await this.db.locks.get(handle.name);
      if (!lease || lease.ownerId !== handle.ownerId || lease.generation !== handle.generation || !(Date.parse(lease.leaseExpiresAt) > Date.now())) {
        throw new AppError('LOCK_HELD', '任务租约已失效，禁止提交');
      }
      return write();
    });
  }

  // ---- products ----
  async createProduct(input: {
    inputUrl: string; finalUrl: string; profile: ProductProfile;
    sourceBlocks: Product['sourceBlocks']; modelId: string; promptVersion: string;
  }): Promise<Product> {
    const product: Product = {
      id: crypto.randomUUID(),
      inputUrl: input.inputUrl,
      finalUrl: input.finalUrl,
      profileVersion: 1,
      profile: input.profile,
      sourceBlocks: input.sourceBlocks,
      modelId: input.modelId,
      promptVersion: input.promptVersion,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.db.products.add(product);
    return product;
  }

  async replaceProfile(id: string, profile: ProductProfile, sourceBlocks?: Product['sourceBlocks']): Promise<Product> {
    return this.db.transaction('rw', this.db.products, async () => {
      const existing = await this.db.products.get(id);
      if (!existing) throw new AppError('STORAGE_ERROR', '产品不存在');
      const updated: Product = {
        ...existing, profile, profileVersion: existing.profileVersion + 1, updatedAt: nowIso(),
        sourceBlocks: sourceBlocks ?? existing.sourceBlocks,
      };
      await this.db.products.put(updated);
      return updated;
    });
  }

  async applyUserEdit(id: string, edited: Partial<ProductProfile>): Promise<Product> {
    const existing = await this.db.products.get(id);
    if (!existing) throw new AppError('STORAGE_ERROR', '产品不存在');
    return this.replaceProfile(id, upsertProfileClaims(existing.profile, edited));
  }

  async deleteProduct(id: string): Promise<void> {    await this.db.transaction('rw', [this.db.products, this.db.analyses, this.db.leadStates, this.db.feedback], async () => {
      // analyses 无单列 productId 索引，用复合索引范围删除；feedback 同理走扫描（MVP 数据量小）
      await this.db.analyses.where('[productId+commentKey]').between([id, Dexie.minKey], [id, Dexie.maxKey]).delete();
      await this.db.leadStates.where('productId').equals(id).delete();
      const fbIds = (await this.db.feedback.toArray()).filter((f) => f.productId === id).map((f) => f.id);
      await this.db.feedback.bulkDelete(fbIds);
      await this.db.products.delete(id);
    });
  }

  /** 清除全部业务数据（不含 Key——Key 在 storage.local/session，单独清除入口）。 */
  async clearAllBusinessData(): Promise<void> {
    await this.db.transaction('rw', [
      this.db.products, this.db.notes, this.db.comments, this.db.analyses,
      this.db.leadStates, this.db.feedback, this.db.jobs, this.db.batches, this.db.usage,
    ], async () => {
      await Promise.all([
        this.db.products.clear(), this.db.notes.clear(), this.db.comments.clear(), this.db.analyses.clear(),
        this.db.leadStates.clear(), this.db.feedback.clear(), this.db.jobs.clear(), this.db.batches.clear(), this.db.usage.clear(),
      ]);
    });
  }

  // ---- notes / comments ----
  async putNote(note: Note): Promise<void> {
    await this.db.notes.put(note);
  }

  async getNote(noteKey: string): Promise<Note | null> {
    return (await this.db.notes.get(noteKey)) ?? null;
  }

  async putComments(comments: Comment[]): Promise<void> {
    await this.db.comments.bulkPut(comments);
  }

  /** 每轮采集立即落库；与取消状态共用事务，取消确认后不再接受该任务的写入。 */
  async saveCaptureDelta(jobId: string, note: Note, comments: Comment[], signal: AbortSignal): Promise<void> {
    await this.db.transaction('rw', [this.db.jobs, this.db.notes, this.db.comments], async () => {
      const job = await this.db.jobs.get(jobId);
      if (signal.aborted || job?.status !== 'collecting') throw new AppError('CANCELLED', '采集已停止，不再写入评论');
      if (job.noteKey && job.noteKey !== note.noteKey) throw new AppError('PAGE_CHANGED', '采集笔记已变化');
      if (comments.some((c) => c.noteKey !== note.noteKey)) throw new AppError('PAGE_CHANGED', '拒绝混入其他笔记评论');
      await this.db.notes.put(note);
      await this.db.comments.bulkPut(comments);
      await this.db.jobs.update(jobId, { noteKey: note.noteKey, updatedAt: nowIso() });
    });
  }

  // ---- analyses: 唯一 cacheKey，重复不覆盖 ----
  async insertAnalysisIfAbsent(analysis: Analysis): Promise<boolean> {
    try {
      await this.db.analyses.add(analysis);
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'ConstraintError') return false;
      throw err;
    }
  }

  /** 批次原子提交：一个事务写 analyses、usage，并把 batch 标为 completed；任一失败整体回滚。 */
  async commitBatch(input: {
    batchId: string;
    analyses: Analysis[];
    usage: Usage[];
  }): Promise<void> {
    await this.db.transaction('rw', [this.db.analyses, this.db.usage, this.db.batches], async () => {
      const batch = await this.db.batches.get(input.batchId);
      if (!batch) throw new AppError('STORAGE_ERROR', '批次不存在');
      for (const analysis of input.analyses) {
        const exists = await this.db.analyses.where('cacheKey').equals(analysis.cacheKey).first();
        if (!exists) await this.db.analyses.add(analysis);
      }
      await this.db.usage.bulkAdd(input.usage);
      await this.db.batches.put({ ...batch, status: 'completed', completedAt: nowIso() });
    });
  }

  // ---- lead states / feedback ----
  async setLeadHandled(productId: string, commentKey: string, handled: boolean): Promise<void> {
    const id = `${productId}:${commentKey}`;
    await this.db.leadStates.put({ id, productId, commentKey, handled, updatedAt: nowIso() });
  }

  async addFeedback(fb: Omit<Feedback, 'id' | 'createdAt'>): Promise<Feedback> {
    const record: Feedback = { ...fb, id: crypto.randomUUID(), createdAt: nowIso() };
    await this.db.feedback.add(record);
    return record;
  }

  // ---- jobs / batches ----
  async createJob(job: Job): Promise<void> {
    await this.db.jobs.add(job);
  }

  async getJob(id: string): Promise<Job | null> {
    return (await this.db.jobs.get(id)) ?? null;
  }

  async updateJob(id: string, patch: Partial<Job>): Promise<void> {
    await this.db.jobs.update(id, { ...patch, updatedAt: nowIso() });
  }

  async addBatches(batches: Batch[]): Promise<void> {
    await this.db.batches.bulkAdd(batches);
  }

  async updateBatch(id: string, patch: Partial<Batch>): Promise<void> {
    await this.db.batches.update(id, patch);
  }

  async batchesForJob(jobId: string): Promise<Batch[]> {
    const rows = await this.db.batches.where('jobId').equals(jobId).toArray();
    return rows.sort((a, b) => a.index - b.index);
  }

  // ---- queries for analysis runner ----
  async getProduct(id: string): Promise<Product | null> {
    return (await this.db.products.get(id)) ?? null;
  }

  async getComments(keys: readonly string[]): Promise<Comment[]> {
    return this.db.comments.where('commentKey').anyOf([...keys]).toArray();
  }

  /** 已存在分析的 cacheKey 子集（先查缓存，无新评论不调用 AI）。 */
  async existingCacheKeys(keys: readonly string[]): Promise<Set<string>> {
    const found = await this.db.analyses.where('cacheKey').anyOf([...keys]).toArray();
    return new Set(found.map((a) => a.cacheKey));
  }

  /** 失败/取消尝试的用量单独落库（AI 可能已计费但未保存结果，如实记录）。 */
  async addUsage(usage: Usage): Promise<void> {
    await this.db.usage.add(usage);
  }

  async analysesForProduct(productId: string): Promise<Analysis[]> {
    const rows = await this.db.analyses.where('[productId+commentKey]')
      .between([productId, Dexie.minKey], [productId, Dexie.maxKey])
      .toArray();
    return rows;
  }

  // ---- 面板只读查询（T23–T25） ----
  async listProducts(): Promise<Product[]> {
    const rows = await this.db.products.toArray();
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async commentsForNote(noteKey: string): Promise<Comment[]> {
    return this.db.comments.where('noteKey').equals(noteKey).toArray();
  }

  async analysesFor(productId: string, commentKeys: readonly string[]): Promise<Analysis[]> {
    if (!commentKeys.length) return [];
    return this.db.analyses.where('[productId+commentKey]')
      .anyOf([...commentKeys].map((k) => [productId, k] as [string, string]))
      .toArray();
  }

  async feedbackForProduct(productId: string): Promise<Feedback[]> {
    // feedback 无 productId 索引（MVP 数据量小，全表扫描）
    return (await this.db.feedback.toArray()).filter((f) => f.productId === productId);
  }

  async leadStatesForProduct(productId: string): Promise<LeadState[]> {
    return this.db.leadStates.where('productId').equals(productId).toArray();
  }

  async usageForJob(jobId: string): Promise<Usage[]> {
    return this.db.usage.where('jobId').equals(jobId).toArray();
  }

  async allUsage(): Promise<Usage[]> {
    return this.db.usage.toArray();
  }

  // ---- locks（T19 使用；接口在此定义并测试） ----
  async acquireLock(name: string, ownerId: string, jobId: string, ttlMs: number): Promise<{ generation: number } | null> {
    return this.db.transaction('rw', this.db.locks, async () => {
      const existing = await this.db.locks.get(name);
      if (existing && new Date(existing.leaseExpiresAt).getTime() > Date.now()) return null;
      const generation = existing ? existing.generation + 1 : 0;
      await this.db.locks.put({
        name, ownerId, generation, jobId,
        leaseExpiresAt: new Date(Date.now() + ttlMs).toISOString(),
      });
      return { generation };
    });
  }

  async renewLock(name: string, ownerId: string, generation: number, ttlMs: number): Promise<boolean> {
    return this.db.transaction('rw', this.db.locks, async () => {
      const existing = await this.db.locks.get(name);
      if (!existing || existing.ownerId !== ownerId || existing.generation !== generation
        || !(Date.parse(existing.leaseExpiresAt) > Date.now())) return false;
      await this.db.locks.put({
        ...existing,
        leaseExpiresAt: new Date(Date.now() + ttlMs).toISOString(),
      });
      return true;
    });
  }

  async releaseLock(name: string, ownerId: string, generation: number): Promise<boolean> {
    return this.db.transaction('rw', this.db.locks, async () => {
      const existing = await this.db.locks.get(name);
      if (!existing || existing.ownerId !== ownerId || existing.generation !== generation) return false;
      await this.db.locks.put({ ...existing, leaseExpiresAt: new Date(0).toISOString() });
      return true;
    });
  }

  /** 过期锁的 running 任务启动时标记 interrupted（供 T19 恢复流程使用） */
  async markInterruptedOnRecovery(): Promise<string[]> {
    return this.db.transaction('rw', [this.db.jobs, this.db.batches, this.db.locks], async () => {
      const running = await this.db.jobs.filter((j) => j.status === 'collecting' || j.status === 'analyzing').toArray();
      const ids: string[] = [];
      for (const job of running) {
        await this.db.jobs.update(job.id, { status: 'interrupted', updatedAt: nowIso(), ...(job.discovery?{discovery:{...job.discovery,status:'paused' as const,phase:'任务已暂停',reason:'后台已中断，请检查页面后手动继续；不会自动恢复'}}:{}) });
        const openBatches = await this.db.batches.where('jobId').equals(job.id)
          .filter((b) => b.status === 'running' || b.status === 'pending').toArray();
        for (const b of openBatches) {
          await this.db.batches.update(b.id, { status: 'interrupted' });
        }
        ids.push(job.id);
      }
      await this.db.locks.filter((l) => new Date(l.leaseExpiresAt).getTime() <= Date.now()).delete();
      return ids;
    });
  }
}
