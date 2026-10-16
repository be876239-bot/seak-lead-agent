import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../src/domain/schemas';
import { SeekLeadDb } from '../../src/storage/db';
import { Repositories } from '../../src/storage/repositories';
import { LOCK_HEARTBEAT_MS, LOCK_NAME, LOCK_TTL_MS, TaskLockManager } from '../../src/analysis/lock';

// 心跳回调内的 IDB 续租走真实宏任务，fake clock 推进后需等它落地
const flushReal = () => new Promise<void>((r) => setTimeout(r, 20));

const runningJob = (id: string): Job => ({  id, kind: 'comments', status: 'analyzing', ownerId: 'owner-x', generation: 0,
  productId: crypto.randomUUID(), profileVersion: 1, tabId: 1, noteKey: 'xhs:note1',
  provider: 'bailian', modelId: 'qwen3.8-flash', promptVersion: 'comment-v1',
  totalItems: 10, completedItems: 3, failedItems: 0,
  createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', errorCode: null,
});

describe('TaskLockManager（T19）', () => {
  let db: SeekLeadDb;
  let repos: Repositories;

  beforeEach(() => {
    // fake-indexeddb 依赖真实 setImmediate/setTimeout 完成事务，只 fake Date 与 interval
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
    db = new SeekLeadDb(`lock-test-${crypto.randomUUID()}`);
    repos = new Repositories(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it('两个面板（管理器实例）只有一个获得锁', async () => {
    const m1 = new TaskLockManager(repos);
    const m2 = new TaskLockManager(repos);
    const h = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    expect(h.generation).toBe(0);
    await expect(m2.acquire(LOCK_NAME, crypto.randomUUID())).rejects.toMatchObject({ code: 'LOCK_HELD' });
    // 未过期时第二面板始终拿不到
    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS - 1000);
    await expect(m2.acquire(LOCK_NAME, crypto.randomUUID())).rejects.toMatchObject({ code: 'LOCK_HELD' });
    expect(h.signal.aborted).toBe(false);
  });

  it('同面板重复 acquire 也被拒绝', async () => {
    const m1 = new TaskLockManager(repos);
    await m1.acquire(LOCK_NAME, crypto.randomUUID());
    await expect(m1.acquire(LOCK_NAME, crypto.randomUUID())).rejects.toMatchObject({ code: 'LOCK_HELD' });
  });

  it('租约过期后新 owner 接管（generation 递增），旧 owner 提交被拒绝', async () => {
    const m1 = new TaskLockManager(repos);
    const m2 = new TaskLockManager(repos);
    const stale = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    // 模拟持锁面板冻结：清掉其心跳定时器，租约自然过期
    vi.clearAllTimers();
    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS + 1000);
    const taken = await m2.acquire(LOCK_NAME, crypto.randomUUID());
    expect(taken.generation).toBe(stale.generation + 1);
    // 旧句柄提交必须失败
    await expect(m1.assertOwned(stale)).rejects.toMatchObject({ code: 'LOCK_HELD' });
    // 新句柄可正常提交
    await m2.assertOwned(taken);
  });

  it('心跳每 5 秒续租，60 秒内无接管者', async () => {
    const m1 = new TaskLockManager(repos);
    const m2 = new TaskLockManager(repos);
    await m1.acquire(LOCK_NAME, crypto.randomUUID());
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS);
    }
    await expect(m2.acquire(LOCK_NAME, crypto.randomUUID())).rejects.toMatchObject({ code: 'LOCK_HELD' });
  });

  it('租约已过期但无人接管时，旧 owner 也不能复活租约提交', async () => {
    const manager = new TaskLockManager(repos);
    const handle = await manager.acquire(LOCK_NAME, crypto.randomUUID());
    vi.clearAllTimers();
    vi.setSystemTime(Date.now() + LOCK_TTL_MS + 1);
    await expect(manager.assertOwned(handle)).rejects.toMatchObject({ code: 'LOCK_HELD' });
    expect(handle.signal.aborted).toBe(true);
  });

  it('续租丢失后 signal 被 abort 且禁止提交', async () => {
    const m1 = new TaskLockManager(repos);
    const handle = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    // 外部直接把锁判给别的 owner（模拟接管）
    const raw = await db.locks.get(LOCK_NAME)!;
    await db.locks.put({ ...raw!, ownerId: crypto.randomUUID(), generation: raw!.generation + 1, leaseExpiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString() });
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS);
    await flushReal();
    expect(handle.signal.aborted).toBe(true);
    await expect(m1.assertOwned(handle)).rejects.toMatchObject({ code: 'LOCK_HELD' });
  });

  it('cancel：abort 信号、释放锁，第二面板可立即获得', async () => {
    const m1 = new TaskLockManager(repos);
    const m2 = new TaskLockManager(repos);
    const handle = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    await m1.cancel(handle);
    expect(handle.signal.aborted).toBe(true);
    expect(handle.signal.reason).toMatchObject({ code: 'CANCELLED' });
    const second = await m2.acquire(LOCK_NAME, crypto.randomUUID());
    expect(second.signal.aborted).toBe(false);
  });

  it('release 后同面板可再次 acquire（新 generation）', async () => {
    const m1 = new TaskLockManager(repos);
    const first = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    await m1.release(first);
    const second = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    expect(second.generation).toBe(first.generation + 1);
  });

  it('启动恢复：遗留 running 任务标 interrupted，open batch 同步，过期锁清理', async () => {
    const jobId = crypto.randomUUID();
    await repos.createJob(runningJob(jobId));
    await repos.addBatches([{
      id: crypto.randomUUID(), jobId, index: 0, status: 'running',
      cacheKeys: ['k1'], commentKeys: ['c1'], attemptCount: 1,
      inputHash: 'abcdefgh', startedAt: '2026-10-15T00:00:00Z', completedAt: null, errorCode: null,
    }]);
    await db.locks.put({ name: LOCK_NAME, ownerId: 'dead-owner', generation: 3, jobId, leaseExpiresAt: '2020-01-01T00:00:00Z' });
    const m = new TaskLockManager(repos);
    const ids = await m.recoverInterrupted();
    expect(ids).toEqual([jobId]);
    expect((await db.jobs.get(jobId))!.status).toBe('interrupted');
    const batch = (await db.batches.toArray())[0]!;
    expect(batch.status).toBe('interrupted');
    expect(await db.locks.get(LOCK_NAME)).toBeUndefined();
    // 恢复后可正常拿锁
    const h = await m.acquire(LOCK_NAME, crypto.randomUUID());
    expect(h.generation).toBe(0);
  });

  it('释放后残留心跳不会误 abort 新句柄', async () => {
    const m1 = new TaskLockManager(repos);
    const h1 = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    await m1.release(h1);
    const h2 = await m1.acquire(LOCK_NAME, crypto.randomUUID());
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS * 4);
    expect(h2.signal.aborted).toBe(false);
    await m1.assertOwned(h2);
  });
});
