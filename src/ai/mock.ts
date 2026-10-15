import { AppError } from '../domain/errors';
import type { ClassificationInput, ProfileInput } from '../privacy/ai-payload';
import type { AIProvider, AIResponse, RepairTurn } from './provider';

export type MockScript = {
  profile?: (input: ProfileInput) => unknown;
  classification?: (input: ClassificationInput) => unknown;
  /** 按调用序列抛出错误（每项为 code/message/retryable），用尽后走正常脚本。 */
  failures?: { code: 'AI_AUTH' | 'AI_RATE_LIMIT' | 'AI_TIMEOUT' | 'AI_INVALID_OUTPUT' | 'AI_PAYLOAD_TOO_LARGE' | 'CANCELLED'; message?: string; retryable?: boolean }[];
};

/**
 * 测试/开发专用 Provider。必须显式构造并注入；
 * 正式配置缺 Key 时 getProvider 报 AI_AUTH，绝不静默回退到 mock。
 */
export class MockProvider implements AIProvider {
  private callIndex = 0;

  constructor(private script: MockScript = {}) {}

  private nextFailure(): void {
    const f = this.script.failures?.[this.callIndex];
    this.callIndex += 1;
    if (f) throw new AppError(f.code, f.message ?? `mock 故障：${f.code}`, f.retryable ?? false);
  }

  async generateProfile(input: ProfileInput, _signal?: AbortSignal, _repair?: RepairTurn): Promise<AIResponse> {
    this.nextFailure();
    if (!this.script.profile) throw new AppError('UNKNOWN', 'mock 未配置 profile 脚本');
    return {
      value: this.script.profile(input),
      model: 'mock-model',
      usage: { inputTokens: null, outputTokens: null },
      providerRequestId: `mock-${this.callIndex}`,
    };
  }

  async classifyComments(input: ClassificationInput, _signal?: AbortSignal, _repair?: RepairTurn): Promise<AIResponse> {
    this.nextFailure();
    if (this.script.classification) {
      return {
        value: this.script.classification(input),
        model: 'mock-model',
        usage: { inputTokens: null, outputTokens: null },
        providerRequestId: `mock-${this.callIndex}`,
      };
    }
    // 默认脚本：逐条回显请求 ID，全部 unknown，不编造证据。
    return {
      value: {
        results: input.items.map((it) => ({
          commentId: it.commentId,
          relevance: 'unknown',
          need: 'unknown',
          purchaseIntent: 'unknown',
          speakerRole: 'unknown',
          intentTarget: 'unknown',
          productFit: 'unknown',
          needSummary: '信息不足',
          evidence: [],
          reason: 'mock 默认输出',
          uncertainty: 'mock 未提供判断',
        })),
      },
      model: 'mock-model',
      usage: { inputTokens: null, outputTokens: null },
      providerRequestId: `mock-${this.callIndex}`,
    };
  }
}
