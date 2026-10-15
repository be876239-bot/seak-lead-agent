import { browser } from 'wxt/browser';
import type { SeekLeadDb } from './db';

export const RETENTION_DAYS_KEY = 'retention.days';
export const RETENTION_LAST_RUN_KEY = 'retention.lastRunDate';
export const RETENTION_CHOICES = [7, 30, 90] as const;
export const DEFAULT_RETENTION_DAYS = 30;

export type PurgeStats = {
  notes: number; comments: number; analyses: number; feedback: number;
  jobs: number; batches: number; usage: number;
};

export function cutoffIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export async function getRetentionDays(): Promise<number> {
  const r = await browser.storage.local.get(RETENTION_DAYS_KEY);
  const v = r[RETENTION_DAYS_KEY] as number | undefined;
  return v && (RETENTION_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_RETENTION_DAYS;
}

export async function hasActiveJobs(db: SeekLeadDb): Promise<boolean> {
  return (await db.jobs.filter(
    (j) => j.status === 'created' || j.status === 'collecting' || j.status === 'analyzing',
  ).count()) > 0;
}

/**
 * 过期业务数据清理：笔记/评论按 capturedAt；analysis/feedback 随评论级联且不留孤立；
 * 终态 jobs 连同 batches/usage 删除。leadStates 永久保留（重分析不丢已处理）。
 * 必须在启动恢复（interrupted）之后调用；活跃任务存在时拒绝执行。
 */
export async function purgeExpired(db: SeekLeadDb, nowMs: number, days: number): Promise<PurgeStats> {
  if (await hasActiveJobs(db)) throw new Error('存在活跃任务：请先取消或等待完成再清理');
  const cutoff = cutoffIso(nowMs, days);
  const stats: PurgeStats = { notes: 0, comments: 0, analyses: 0, feedback: 0, jobs: 0, batches: 0, usage: 0 };
  await db.transaction('rw', [
    db.notes, db.comments, db.analyses, db.feedback, db.jobs, db.batches, db.usage, db.leadStates, db.products,
  ], async () => {
    const oldNoteKeys = (await db.notes.where('capturedAt').below(cutoff).toArray()).map((n) => n.noteKey);
    stats.notes = oldNoteKeys.length;
    stats.comments = await db.comments.where('capturedAt').below(cutoff).delete()
      + await db.comments.where('noteKey').anyOf(oldNoteKeys).delete();
    await db.notes.bulkDelete(oldNoteKeys);

    const aliveKeys = new Set((await db.comments.toArray()).map((c) => c.commentKey));
    const orphanAnalyses = (await db.analyses.toArray()).filter((a) => !aliveKeys.has(a.commentKey));
    stats.analyses = orphanAnalyses.length;
    await db.analyses.bulkDelete(orphanAnalyses.map((a) => a.id));

    const aliveAnalyses = new Set((await db.analyses.toArray()).map((a) => a.id));
    const orphanFeedback = (await db.feedback.toArray())
      .filter((f) => !aliveAnalyses.has(f.analysisId) || !aliveKeys.has(f.commentKey));
    stats.feedback = orphanFeedback.length;
    await db.feedback.bulkDelete(orphanFeedback.map((f) => f.id));

    const deadJobs = await db.jobs.filter(
      (j) => new Date(j.updatedAt) < new Date(cutoff)
        && j.status !== 'created' && j.status !== 'collecting' && j.status !== 'analyzing',
    ).toArray();
    stats.jobs = deadJobs.length;
    for (const j of deadJobs) {
      stats.batches += await db.batches.where('jobId').equals(j.id).delete();
      stats.usage += await db.usage.where('jobId').equals(j.id).delete();
    }
    await db.jobs.bulkDelete(deadJobs.map((j) => j.id));
  });
  return stats;
}

const todayStr = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** 启动与每日首次使用触发：同一天内不重复清理；返回本次是否执行。 */
export async function ensureDailyRetention(db: SeekLeadDb): Promise<boolean> {
  const r = await browser.storage.local.get(RETENTION_LAST_RUN_KEY);
  if (r[RETENTION_LAST_RUN_KEY] === todayStr(Date.now())) return false;
  if (await hasActiveJobs(db)) return false;
  await purgeExpired(db, Date.now(), await getRetentionDays());
  await browser.storage.local.set({ [RETENTION_LAST_RUN_KEY]: todayStr(Date.now()) });
  return true;
}
