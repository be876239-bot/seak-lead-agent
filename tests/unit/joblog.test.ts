import { describe, expect, it, vi } from 'vitest';

const listeners = new Set<(raw: unknown) => unknown>();
const storageData: Record<string, unknown> = {};

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      onMessage: {
        addListener: (l: (raw: unknown) => unknown) => listeners.add(l),
        removeListener: (l: (raw: unknown) => unknown) => listeners.delete(l),
      },
    },
    storage: {
      local: {
        get: async (k: string) => (k in storageData ? { [k]: storageData[k] } : {}),
        set: async (o: Record<string, unknown>) => Object.assign(storageData, o),
      },
    },
  },
}));

import {
  emitJobLog, emitLocalJobLog, isLogPanelEnabled, setLogPanelEnabled, subscribeJobLog,
} from '../../src/ui/joblog';

describe('joblog', () => {
  it('后台推送经 runtime 监听进入订阅者，非日志消息被忽略', () => {
    const seen: unknown[] = [];
    const off = subscribeJobLog((e) => seen.push(e));
    emitJobLog('j1', '步骤一');
    for (const l of listeners) l({ type: 'SOMETHING_ELSE', protocol: 1 });
    for (const l of listeners) l({ type: 'SEEKLEAD_JOB_LOG', event: { jobId: 'j1', level: 'info', message: '步骤一', at: 't' } });
    expect(seen).toHaveLength(1);
    off();
    for (const l of listeners) l({ type: 'SEEKLEAD_JOB_LOG', event: { jobId: 'j1', level: 'info', message: '再来', at: 't' } });
    expect(seen).toHaveLength(1);
  });

  it('本地日志只进面板订阅者', () => {
    const seen: unknown[] = [];
    const off = subscribeJobLog((e) => seen.push(e));
    emitLocalJobLog('j2', '启动失败：AI_AUTH 未配置', 'error');
    expect(seen).toHaveLength(1);
    off();
    emitLocalJobLog('j2', '不该收到');
    expect(seen).toHaveLength(1);
  });

  it('日志框开关默认关闭，读写 storage.local', async () => {
    expect(await isLogPanelEnabled()).toBe(false);
    await setLogPanelEnabled(true);
    expect(await isLogPanelEnabled()).toBe(true);
  });
});
