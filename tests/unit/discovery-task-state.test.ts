import { expect, it } from 'vitest';
import type { Job } from '../../src/domain/schemas';
import { isBackgroundInterruptedDiscovery, isDiscoveryTaskBlockingStart } from '../../src/discovery/task-state';

function makeJob(status: Job['status'], discoveryStatus: 'running'|'paused'|'stopped'|'completed', reason: string|null) {
  return { status, discovery: { status: discoveryStatus, reason } } as Pick<Job, 'status'|'discovery'>;
}

it('后台重启留下的中断任务不阻止启动新任务', () => {
  const job = makeJob('interrupted', 'paused', '后台已中断，请检查页面后手动继续；不会自动恢复');
  expect(isBackgroundInterruptedDiscovery(job)).toBe(true);
  expect(isDiscoveryTaskBlockingStart(job)).toBe(false);
});

it('用户暂停的任务仍可恢复，但不阻止开始新任务', () => {
  const job = makeJob('interrupted', 'paused', '用户暂停；已保存结果保留');
  expect(isBackgroundInterruptedDiscovery(job)).toBe(false);
  expect(isDiscoveryTaskBlockingStart(job)).toBe(false);
});

it('真正运行中的任务仍阻止并发新任务', () => {
  expect(isDiscoveryTaskBlockingStart(makeJob('collecting', 'running', null))).toBe(true);
});

it('正常结束、已取消或不存在的任务不阻止新任务', () => {
  expect(isDiscoveryTaskBlockingStart(makeJob('completed', 'completed', null))).toBe(false);
  expect(isDiscoveryTaskBlockingStart(makeJob('cancelled', 'stopped', null))).toBe(false);
  expect(isDiscoveryTaskBlockingStart(null)).toBe(false);
});
