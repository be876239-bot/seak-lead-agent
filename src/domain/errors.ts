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

export function toErrorPayload(err: unknown): { code: ErrorCode; message: string; retryable: boolean } {
  if (err instanceof AppError) return { code: err.code, message: err.message, retryable: err.retryable };
  return { code: 'UNKNOWN', message: '未预期的内部错误', retryable: false };
}
