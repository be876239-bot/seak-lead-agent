import { describe, expect, it } from 'vitest';
import {
  ClaimSchema,
  CommentSchema,
  DecisionSchema,
  ProductProfileSchema,
} from '../../src/domain/schemas';
import { RequestSchema, ResponseSchema, buildRequest } from '../../src/messaging/protocol';
import { AppError, safeDiagnosticMessage, toErrorPayload } from '../../src/domain/errors';

const claim = (over = {}) => ({ value: 'x', status: 'observed', evidence: [], ...over });

describe('domain schemas', () => {
  it('unknown claim 必须 value=null，其他必须非 null', () => {
    expect(ClaimSchema.safeParse(claim({ status: 'unknown', value: null })).success).toBe(true);
    expect(ClaimSchema.safeParse(claim({ status: 'unknown', value: '猜的价格' })).success).toBe(false);
    expect(ClaimSchema.safeParse(claim({ value: null })).success).toBe(false);
  });

  it('拒绝非法枚举与缺字段', () => {
    const decision = {
      commentId: 'c001', relevance: 'direct', need: 'explicit', purchaseIntent: 'explicit_buy',
      speakerRole: 'seeker', intentTarget: 'category', productFit: 'supported',
      needSummary: '问价', evidence: [], reason: '明确询问价格', uncertainty: null,
    };
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
    expect(DecisionSchema.safeParse({ ...decision, relevance: 'maybe' }).success).toBe(false);
    const { reason: _r, ...missing } = decision;
    expect(DecisionSchema.safeParse(missing).success).toBe(false);
    expect(DecisionSchema.safeParse({ ...decision, extraField: 1 }).success).toBe(false);
  });

  it('拒绝超长输入', () => {
    expect(CommentSchema.safeParse({
      commentKey: 'k', noteKey: 'n', platformCommentId: null, parentKey: null,
      text: 'a'.repeat(2001), authorDisplayName: null, authorLocalKey: null, profileUrl: null,
      publishedText: null, publishedAt: null, likeCount: null,
      capturedAt: '2026-10-15T00:00:00Z', identityQuality: 'strong', truncated: false,
    }).success).toBe(false);
    expect(ProductProfileSchema.safeParse({
      schemaVersion: 2, name: claim(), category: claim(), summary: claim(),
      capabilities: [], targetAudience: [], needsServed: [], exclusions: [],
      accessMethod: claim(), price: claim({ status: 'unknown', value: null }), purchaseChannel: claim(),
      searchSuggestions: [],
    }).success).toBe(false);
  });
});

describe('messaging protocol', () => {
  it('拒绝未知消息 type', () => {
    expect(RequestSchema.safeParse({
      protocol: 1, requestId: 'r1', type: 'XHS_AUTO_SCROLL', payload: {},
    }).success).toBe(false);
  });

  it('拒绝协议版本不符与缺 requestId', () => {
    expect(RequestSchema.safeParse({ protocol: 2, requestId: 'r1', type: 'XHS_GET_STATUS', payload: {} }).success).toBe(false);
    expect(RequestSchema.safeParse({ protocol: 1, type: 'XHS_GET_STATUS', payload: {} }).success).toBe(false);
  });

  it('合法请求可构造并解析', () => {
    const req = buildRequest('XHS_START_SESSION', { expectedNoteKey: 'xhs:note-1' });
    expect(RequestSchema.safeParse(req).success).toBe(true);
  });

  it('响应 schema 约束错误码', () => {
    expect(ResponseSchema.safeParse({
      requestId: 'r1', ok: false, error: { code: 'PAGE_CHANGED', message: '换帖了', retryable: false },
    }).success).toBe(true);
    expect(ResponseSchema.safeParse({
      requestId: 'r1', ok: false, error: { code: 'NOT_A_CODE', message: 'x', retryable: false },
    }).success).toBe(false);
  });
});

describe('errors', () => {
  it('toErrorPayload 不泄露原始异常内容', () => {
    const payload = toErrorPayload(new Error('secret cookie=abc'));
    expect(payload.code).toBe('UNKNOWN');
    expect(payload.message).not.toContain('secret');
    const app = new AppError('AI_RATE_LIMIT', '限流', true);
    expect(toErrorPayload(app)).toEqual({ code: 'AI_RATE_LIMIT', message: '限流', retryable: true });
  });

  it('safeDiagnosticMessage 保留排错信息并隐藏凭据、联系方式与 URL 查询参数', () => {
    const detail = safeDiagnosticMessage(new TypeError(
      'HTTP 400 https://api.example.com/v1?token=secret apiKey=sk-abcdefghijklmnopqrstuvwxyz123456 buyer@example.com',
    ));
    expect(detail).toContain('HTTP 400');
    expect(detail).not.toContain('secret');
    expect(detail).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(detail).not.toContain('buyer@example.com');
    expect(detail).toContain('[已隐藏]');
    expect(detail).toContain('[查询参数已隐藏]');
  });
});
