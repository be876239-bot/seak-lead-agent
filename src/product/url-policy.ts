import { AppError } from '../domain/errors';

export type ParsedProductUrl = { url: URL; origin: string };

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes(':')) return false;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const mapped = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return false;
}

export function parseProductUrl(raw: string): ParsedProductUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError('URL_INVALID', '请输入有效的 http(s) 链接');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('URL_INVALID', '仅允许 http/https 协议');
  }
  if (url.username || url.password) {
    throw new AppError('URL_INVALID', '不允许链接中携带账号密码');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new AppError('URL_PRIVATE_BLOCKED', '不允许本机地址');
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new AppError('URL_PRIVATE_BLOCKED', '不允许私有或回环地址');
  }
  return { url, origin: url.origin };
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
