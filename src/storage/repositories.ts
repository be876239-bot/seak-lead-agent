import type {
  Analysis, Batch, Comment, Feedback, Job, Note, Product, ProductProfile, Usage,
} from '../domain/schemas';
import { AppError } from '../domain/errors';
import type { SeekLeadDb } from './db';

const nowIso = () => new Date().toISOString();

function upsertProfileClaims(profile: ProductProfile, edited: Partial<ProductProfile>): ProductProfile {
  return { ...profile, ...edited };
}

export class Repositories {
  constructor(private db: SeekLeadDb) {}

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

  async deleteProduct(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.products, this.db.analyses, this.db.leadStates, this.db.feedback], async () => {
      await this.db.analyses.where('productId').equals(id).delete();
      await this.db.leadStates.where('productId').equals(id).delete();
      await this.db.feedback.where('productId').equals(id).delete();
      await this.db.products.delete(id);
    });
  }

  // ---- notes / comments ----
  async putNote(note: Note): Promise<void> {
    await this.db.notes.put(note);
  }

  async putComments(comments: Comment[]): Promise<void> {
    await this.db.comments.bulkPut(comments);
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

  async updateJob(id: string, patch: Partial<Job>): Promise<void> {
    await this.db.jobs.update(id, { ...patch, updatedAt: nowIso() });
  }

  async addBatches(batches: Batch[]): Promise<void> {
    await this.db.batches.bulkAdd(batches);
  }

  async updateBatch(id: string, patch: Partial<Batch>): Promise<void> {
    await this.db.batches.update(id, patch);
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
      if (!existing || existing.ownerId !== ownerId || existing.generation !== generation) return false;
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
        await this.db.jobs.update(job.id, { status: 'interrupted', updatedAt: nowIso() });
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
