import type { Job } from '../domain/schemas';

/**
 * A recovered background task is persisted as interrupted/paused, but no
 * in-memory runner exists after the extension worker restarted.
 */
export function isBackgroundInterruptedDiscovery(
  job: Pick<Job, 'status' | 'discovery'> | null | undefined,
): boolean {
  return job?.status === 'interrupted'
    && job.discovery?.status === 'paused'
    && job.discovery.reason?.startsWith('后台已中断') === true;
}

/**
 * Only a running task should hide the "start new task" action.
 * A paused task is a saved checkpoint, not a live run; it may be left in the
 * task history while a new task starts. The background handler drains the
 * paused runner before replacing its in-memory slot.
 */
export function isDiscoveryTaskBlockingStart(
  job: Pick<Job, 'status' | 'discovery'> | null | undefined,
): boolean {
  return job?.discovery?.status === 'running'
    && job.status !== 'cancelled'
    && job.status !== 'completed';
}
