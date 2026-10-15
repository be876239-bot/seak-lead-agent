import { browser } from 'wxt/browser';

export type JobLogEvent = { jobId: string; level: 'info' | 'error'; message: string; at: string };

const PUSH_TYPE = 'SEEKLEAD_JOB_LOG';
export const LOG_FLAG_KEY = 'ui.logPanel';

/** 后台侧：向所有扩展页面广播一条任务日志。面板未打开时无接收者，静默丢弃。 */
export function emitJobLog(jobId: string, message: string, level: JobLogEvent['level'] = 'info'): void {
  const event: JobLogEvent = { jobId, level, message, at: new Date().toISOString() };
  void browser.runtime.sendMessage({ type: PUSH_TYPE, event }).catch(() => {});
}

/** 面板侧：请求在后台受理前就失败（如未授权、缺 Key）时，本地也进日志框。 */
const localListeners = new Set<(e: JobLogEvent) => void>();

export function emitLocalJobLog(jobId: string, message: string, level: JobLogEvent['level'] = 'info'): void {
  const event: JobLogEvent = { jobId, level, message, at: new Date().toISOString() };
  for (const l of localListeners) l(event);
}

/** 面板侧订阅；返回取消订阅函数。 */
export function subscribeJobLog(onEvent: (e: JobLogEvent) => void): () => void {
  const listener = (raw: unknown): undefined => {
    if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === PUSH_TYPE) {
      onEvent((raw as { event: JobLogEvent }).event);
    }
    return undefined;
  };
  browser.runtime.onMessage.addListener(listener);
  localListeners.add(onEvent);
  return () => {
    browser.runtime.onMessage.removeListener(listener);
    localListeners.delete(onEvent);
  };
}

export async function isLogPanelEnabled(): Promise<boolean> {
  const r = await browser.storage.local.get(LOG_FLAG_KEY);
  return r[LOG_FLAG_KEY] === true;
}

export async function setLogPanelEnabled(on: boolean): Promise<void> {
  await browser.storage.local.set({ [LOG_FLAG_KEY]: on });
}

export function watchLogPanelEnabled(onChange: (enabled: boolean) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>) => {
    if (LOG_FLAG_KEY in changes) onChange(changes[LOG_FLAG_KEY]?.newValue === true);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
