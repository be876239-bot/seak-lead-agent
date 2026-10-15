import { browser } from 'wxt/browser';
import { RequestSchema, buildError, buildOk, type Request, type Response } from './protocol';
import { AppError, toErrorPayload } from '../domain/errors';
import { PROVIDER_PRESETS, type PresetId } from '../storage/credentials';

/** 敏感后台命令只接受扩展自身页面（侧边栏）发起，拒绝 content script。 */
export function isTrustedSender(sender: { id?: string; url?: string; tabId?: number }): boolean {
  if (sender.id !== browser.runtime.id) return false;
  if (typeof sender.tabId === 'number') return false;
  return !!sender.url?.startsWith(browser.runtime.getURL(''));
}

/**
 * 用户点击触发的按需授权：必须直接来自用户手势，不在网络请求之后。
 * 只申请具体 origin，不扩权。
 */
export async function requestOriginForUrl(url: string): Promise<boolean> {
  const origin = new URL(url).origin + '/*';
  return browser.permissions.request({ origins: [origin] });
}

export async function requestProviderOrigin(presetId: PresetId): Promise<boolean> {
  const preset = PROVIDER_PRESETS[presetId];
  return browser.permissions.request({ origins: preset.origins });
}

export async function hasOriginPermission(url: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [new URL(url).origin + '/*'] });
}

type Handler = (req: Request, sender: { id?: string; url?: string; tabId?: number }) => Promise<unknown>;

const sensitiveHandlers = new Map<string, Handler>();

export function registerSensitiveHandler(type: string, handler: Handler): void {
  sensitiveHandlers.set(type, handler);
}

export async function handleBackgroundMessage(
  raw: unknown,
  sender: { id?: string; url?: string; tabId?: number },
): Promise<Response> {
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return buildError('unknown', { code: 'UNKNOWN', message: '非法消息', retryable: false });
  }
  const req = parsed.data;
  if (!isTrustedSender(sender)) {
    const err = new AppError('PERMISSION_DENIED', '该命令只能由扩展页面发起');
    return buildError(req.requestId, toErrorPayload(err));
  }
  const handler = sensitiveHandlers.get(req.type);
  if (!handler) {
    return buildError(req.requestId, { code: 'UNKNOWN', message: '不支持的消息类型', retryable: false });
  }
  try {
    return buildOk(req.requestId, await handler(req, sender));
  } catch (err) {
    return buildError(req.requestId, toErrorPayload(err));
  }
}
