import { redactText } from '../privacy/redact';

export const ERROR_CODES = [
  'PERMISSION_DENIED',
  'URL_INVALID',
  'URL_PRIVATE_BLOCKED',
  'PAGE_UNSUPPORTED',
  'PAGE_CHANGED',
  'PAGE_BLOCKED',
  'PAGE_UNREACHABLE',
  'PARSE_FAILED',
  'SNAPSHOT_EXPIRED',
  'LOCK_HELD',
  'AI_AUTH',
  'AI_RATE_LIMIT',
  'AI_TIMEOUT',
  'AI_INVALID_OUTPUT',
  'AI_PAYLOAD_TOO_LARGE',
  'CANCELLED',
  'STORAGE_ERROR',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Retain useful failure context for local diagnostics while masking secrets,
 * contact details, and URL query strings before storing or displaying it.
 */
export function safeDiagnosticMessage(err: unknown): string {
  const raw = err instanceof Error ? err.name + ': ' + err.message : String(err);
  return redactText(raw)
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;&]+/gi, '$1[已隐藏]')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[已隐藏的 API Key]')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[查询参数已隐藏]')
    .slice(0, 500);
}

export function toErrorPayload(err: unknown): { code: ErrorCode; message: string; retryable: boolean } {
  if (err instanceof AppError) return { code: err.code, message: err.message, retryable: err.retryable };
  return { code: 'UNKNOWN', message: '未预期的内部错误', retryable: false };
}
