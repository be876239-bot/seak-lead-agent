import { browser } from 'wxt/browser';
import { AppError } from '../domain/errors';
import { buildRequest, ResponseSchema, type MessageType } from './protocol';

/** 侧边栏 → 后台敏感命令：失败以 AppError 抛出，携带后台的 code/retryable。 */
export async function sendRequest<T>(type: MessageType, payload: unknown): Promise<T> {
  const req = buildRequest(type, payload);
  let raw: unknown;
  try {
    raw = await browser.runtime.sendMessage(req);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AppError('UNKNOWN', `后台无响应：${detail.slice(0, 200)}`, true);
  }
  const res = ResponseSchema.safeParse(raw);
  if (!res.success) throw new AppError('UNKNOWN', '后台返回了非法响应');
  if (!res.data.ok) {
    const e = res.data.error;
    throw new AppError(e?.code ?? 'UNKNOWN', e?.message ?? '后台处理失败', e?.retryable ?? false);
  }
  return res.data.data as T;
}
