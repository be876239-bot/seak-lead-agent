import { AppError } from '../domain/errors';
import type { Repositories } from '../storage/repositories';

export const LOCK_NAME = 'seeklead-global';
export const LOCK_TTL_MS = 60_000;
export const LOCK_HEARTBEAT_MS = 5_000;

export type LockHandle = {
  readonly name: string;
  readonly jobId: string;
  readonly ownerId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
};

type Entry = {
  handle: LockHandle;
  ac: AbortController;
  timer: ReturnType<typeof setInterval> | null;
  lost: boolean;
};

/**
 * 全局独占任务锁：5 秒心跳续租、60 秒租约；租约丢失即 abort 并禁止提交。
 * 跨面板互斥由 IndexedDB locks 表的事务化租约实现；不依赖页面 unload。
 */
export class TaskLockManager {
  private entries = new Map<string, Entry>();

  constructor(private repos: Repositories) {}

  async acquire(name: string, jobId: string): Promise<LockHandle> {
    const local = this.entries.get(name);
    if (local && !local.lost) throw new AppError('LOCK_HELD', '本面板已有任务持锁');
    if (local) this.entries.delete(name);
    const ownerId = crypto.randomUUID();
    const got = await this.repos.acquireLock(name, ownerId, jobId, LOCK_TTL_MS);
    if (!got) throw new AppError('LOCK_HELD', '其他面板持锁且租约未过期');
    const ac = new AbortController();
    const entry: Entry = {
      handle: { name, jobId, ownerId, generation: got.generation, signal: ac.signal },
      ac, timer: null, lost: false,
    };
    entry.timer = setInterval(() => { void this.tryRenew(entry); }, LOCK_HEARTBEAT_MS);
    this.entries.set(name, entry);
    return entry.handle;
  }

  private async tryRenew(entry: Entry): Promise<void> {
    const ok = await this.repos.renewLock(entry.handle.name, entry.handle.ownerId, entry.handle.generation, LOCK_TTL_MS);
    if (!ok) this.markLost(entry, 'LOCK_HELD', '任务租约丢失');
  }

  private markLost(entry: Entry, code: 'LOCK_HELD' | 'CANCELLED', message: string): void {
    if (entry.lost) return;
    entry.lost = true;
    if (entry.timer) clearInterval(entry.timer);
    entry.ac.abort(new AppError(code, message));
  }

  /** 提交前所有权校验：校验 owner+generation 并顺带续租；过期旧 owner 被拒绝。 */
  async assertOwned(handle: LockHandle): Promise<void> {
    const entry = this.entries.get(handle.name);
    if (!entry || entry.handle !== handle) throw new AppError('LOCK_HELD', '非当前持锁句柄');
    if (entry.lost) throw new AppError('LOCK_HELD', '租约已丢失，禁止提交');
    const ok = await this.repos.renewLock(handle.name, handle.ownerId, handle.generation, LOCK_TTL_MS);
    if (!ok) {
      this.markLost(entry, 'LOCK_HELD', '锁已被其他 owner 接管');
      throw new AppError('LOCK_HELD', '锁已被其他 owner 接管，禁止提交');
    }
  }

  /** 用户取消：中止在途请求并释放锁；Job 终态由 runner 负责写 cancelled。 */
  async cancel(handle: LockHandle): Promise<void> {
    const entry = this.entries.get(handle.name);
    if (!entry || entry.handle !== handle) return;
    this.markLost(entry, 'CANCELLED', '用户取消任务');
    this.entries.delete(handle.name);
    await this.repos.releaseLock(handle.name, handle.ownerId, handle.generation);
  }

  async release(handle: LockHandle): Promise<void> {
    const entry = this.entries.get(handle.name);
    if (!entry || entry.handle !== handle) return;
    if (entry.timer) clearInterval(entry.timer);
    this.entries.delete(handle.name);
    await this.repos.releaseLock(handle.name, handle.ownerId, handle.generation);
  }

  /** 启动恢复：把上次进程遗留的 collecting/analyzing 任务标 interrupted，清过期锁。不依赖 unload。 */
  async recoverInterrupted(): Promise<string[]> {
    return this.repos.markInterruptedOnRecovery();
  }
}
