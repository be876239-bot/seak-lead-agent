import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from '../domain/errors';
import { BatchSchema, CommentSchema, JobSchema, NoteSchema, ProductSourceBlockSchema } from '../domain/schemas';
import { LIMITS } from '../domain/limits';

export const PROTOCOL_VERSION = 1;

export const MessageType = z.enum([
  'XHS_CLICK_NOTE', 'XHS_CLOSE_NOTE', 'XHS_SEARCH_STATE',
  'XHS_DISCOVER', 'XHS_GUARD', 'DISCOVERY_START', 'DISCOVERY_CONTROL',
  'XHS_GET_STATUS',
  'XHS_START_SESSION',
  'XHS_GET_SNAPSHOT',
  'XHS_STOP_SESSION',
  'PRODUCT_READ_RENDERED',
  'PRODUCT_CANCEL_READ',
  'PRODUCT_CREATE',
  'NOTE_ANALYZE',
  'JOB_GET',
  'JOB_CANCEL',
  'JOB_RETRY',
]);
export type MessageType = z.infer<typeof MessageType>;

const RequestId = z.string().min(1).max(64);

export const RequestSchema = z.discriminatedUnion('type', [
  z.object({protocol:z.literal(PROTOCOL_VERSION),requestId:RequestId,type:z.literal('XHS_CLOSE_NOTE'),payload:z.object({expectedNoteKey:z.string().regex(/^xhs:[0-9a-z]{24}$/)})}),
  z.object({protocol:z.literal(PROTOCOL_VERSION),requestId:RequestId,type:z.literal('XHS_SEARCH_STATE'),payload:z.object({})}),
  z.object({protocol:z.literal(PROTOCOL_VERSION),requestId:RequestId,type:z.literal('XHS_CLICK_NOTE'),payload:z.object({expectedSearchUrl:z.string().url().max(LIMITS.maxUrlChars),expectedNoteKey:z.string().regex(/^xhs:[0-9a-z]{24}$/)})}),
  z.object({ protocol:z.literal(PROTOCOL_VERSION), requestId:RequestId, type:z.literal('XHS_DISCOVER'), payload:z.object({}) }),
  z.object({ protocol:z.literal(PROTOCOL_VERSION), requestId:RequestId, type:z.literal('XHS_GUARD'), payload:z.object({}) }),
  z.object({protocol:z.literal(PROTOCOL_VERSION),requestId:RequestId,type:z.literal('DISCOVERY_START'),payload:z.object({jobId:z.string().uuid(),productId:z.string().uuid(),tabId:z.number().int().nonnegative(),direction:z.string().min(1).max(200)})}),
  z.object({protocol:z.literal(PROTOCOL_VERSION),requestId:RequestId,type:z.literal('DISCOVERY_CONTROL'),payload:z.object({jobId:z.string().uuid(),action:z.enum(['pause','stop','continue'])})}),
  z.object({ protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('XHS_GET_STATUS'), payload: z.object({}) }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('XHS_START_SESSION'),
    payload: z.object({ expectedNoteKey: z.string().min(1).max(256) }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('XHS_GET_SNAPSHOT'),
    payload: z.object({ sessionId: z.string().min(1).max(64), expectedNoteKey: z.string().min(1).max(256), cursor: z.string().max(256).nullable(), advance: z.boolean().optional() }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('XHS_STOP_SESSION'),
    payload: z.object({ sessionId: z.string().min(1).max(64) }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('PRODUCT_READ_RENDERED'),
    payload: z.object({ jobId: z.string().uuid(), url: z.string().url().max(LIMITS.maxUrlChars) }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('PRODUCT_CANCEL_READ'),
    payload: z.object({ jobId: z.string().uuid() }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('PRODUCT_CREATE'),
    payload: z.object({
      jobId: z.string().uuid(), url: z.string().url().max(LIMITS.maxUrlChars),
      existingProductId: z.string().uuid().optional(),
    }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('NOTE_ANALYZE'),
    payload: z.object({ jobId: z.string().uuid(), tabId: z.number().int().nonnegative(), productId: z.string().uuid() }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('JOB_GET'),
    payload: z.object({ jobId: z.string().uuid() }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('JOB_CANCEL'),
    payload: z.object({ jobId: z.string().uuid() }),
  }),
  z.object({
    protocol: z.literal(PROTOCOL_VERSION), requestId: RequestId, type: z.literal('JOB_RETRY'),
    payload: z.object({ jobId: z.string().uuid() }),
  }),
]);
export type Request = z.infer<typeof RequestSchema>;

export const XhsStatusPayload = z.object({
  noteKey: z.string().max(256).nullable(),
  parserVersion: z.string().max(64),
  supported: z.boolean(),
  blocked: z.boolean(),
});
export type XhsStatusPayload = z.infer<typeof XhsStatusPayload>;

export const SnapshotPayload = z.object({
  sessionId: z.string().max(64),
  noteKey: z.string().max(256),
  parserVersion: z.string().max(64),
  capturedAt: z.iso.datetime(),
  note: NoteSchema.nullable(),
  comments: z.array(CommentSchema).max(LIMITS.maxSessionComments),
  hasMoreLoaded: z.boolean(),
  truncated: z.boolean(),
  nextCursor: z.string().max(256).nullable(),
  endOfList: z.boolean().optional(),
  loadingReplies: z.boolean().optional(),
  activityVersion:z.number().int().nonnegative().optional(),
  atBottom:z.boolean().optional(),
  loadingComments:z.boolean().optional(),
  displayedCommentCount:z.number().int().nonnegative().nullable().optional(),
});
export type SnapshotPayload = z.infer<typeof SnapshotPayload>;

export const ProductReadRenderedPayload = z.object({
  jobId: z.string().uuid(),
  finalUrl: z.string().url().max(LIMITS.maxUrlChars).nullable(),
  blocks: z.array(ProductSourceBlockSchema).max(LIMITS.maxProductPages),
  truncated: z.boolean(),
  pendingOrigin: z.string().max(LIMITS.maxUrlChars).nullable(),
});

export const JobGetPayload = z.object({
  job: JobSchema.nullable(),
  batches: z.array(BatchSchema).max(LIMITS.maxSessionComments),
});
export type JobGetPayload = z.infer<typeof JobGetPayload>;

export const ResponseErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string().max(500),
  retryable: z.boolean(),
});
export type ResponseError = z.infer<typeof ResponseErrorSchema> & { code: ErrorCode };

export const ResponseSchema = z.object({
  requestId: RequestId,
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: ResponseErrorSchema.optional(),
});
export type Response = z.infer<typeof ResponseSchema>;

export function buildRequest<T extends MessageType>(
  type: T,
  payload: unknown,
): Request {
  const req = { protocol: PROTOCOL_VERSION, requestId: crypto.randomUUID(), type, payload };
  return RequestSchema.parse(req);
}

export function buildOk(requestId: string, data?: unknown): Response {
  return { requestId, ok: true, data };
}

export function buildError(requestId: string, error: ResponseError): Response {
  return { requestId, ok: false, error };
}
