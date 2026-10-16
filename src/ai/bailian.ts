import { AppError } from '../domain/errors';
import { LIMITS } from '../domain/limits';
import type { ClassificationInput, ProfileInput } from '../privacy/ai-payload';
import { buildCommentMessages, buildProfileMessages, appendRepair, type ChatMessage } from './prompts';
import type { AIProvider, AIResponse, RepairTurn } from './provider';
import { redactText } from '../privacy/redact';

export type BailianConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type ChatCompletionBody = {
  id?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/** 从错误响应体提取可读详情：优先 JSON 的 error.message，否则取纯文本前段；仅用于日志与报错，不含请求头。 */
function errorDetail(raw: string): string {
  try {
    const j = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const m = j.error?.message ?? j.message;
    if (m) return String(m).replace(/\s+/g, ' ').slice(0, 160);
  } catch { /* 非 JSON 错误体 */ }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export class BailianProvider implements AIProvider {
  constructor(private cfg: BailianConfig) {}

  private async chat(messages: ChatMessage[], signal: AbortSignal): Promise<AIResponse> {
    if (!this.cfg.apiKey) throw new AppError('AI_AUTH', '未配置 API Key');
    const controller = new AbortController();
    let externalAbort = false;
    const onExternal = () => { externalAbort = true; controller.abort(); };
    if (signal.aborted) throw new AppError('CANCELLED', '任务已取消');
    signal.addEventListener('abort', onExternal, { once: true });
    const timer = setTimeout(() => controller.abort(), LIMITS.aiTimeoutMs);
    let res: Response;
    let responseText: string;
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          response_format: { type: 'json_object' },
          enable_thinking: false,
        }),
        signal: controller.signal,
      });
      responseText = await res.text();
      if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
    } catch (err) {
      if (externalAbort) throw new AppError('CANCELLED', '任务已取消');
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError('AI_TIMEOUT', `模型请求超时（>${LIMITS.aiTimeoutMs / 1000}s）`, true);
      }
      // 保留底层报错（如 Failed to fetch / net:: 错误名），否则真机上无法区分断网、权限失效与服务拒绝
      const raw = redactText((err instanceof Error ? `${err.name}: ${err.message}` : String(err)).replaceAll(this.cfg.apiKey, '【Key 已隐藏】'));
      throw new AppError('AI_TIMEOUT', `网络或模型服务连接失败（${raw.slice(0, 120)}），可稍后重试`, true);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onExternal);
    }

    if (!res.ok) {
      const detail = redactText(errorDetail(responseText.replaceAll(this.cfg.apiKey, '【Key 已隐藏】')));
      const tail = detail ? `：${detail}` : '';
      if (res.status === 401 || res.status === 403) throw new AppError('AI_AUTH', `模型鉴权失败，请检查 API Key 与模型权限（HTTP ${res.status}${tail}）`);
      if (res.status === 429) throw new AppError('AI_RATE_LIMIT', `模型限流，请稍后重试（HTTP 429${tail}）`, true);
      if (res.status === 413) throw new AppError('AI_PAYLOAD_TOO_LARGE', `请求体超出模型限制，请缩小批次后重试（HTTP 413${tail}）`, true);
      if (res.status >= 500) throw new AppError('AI_TIMEOUT', `模型服务异常（HTTP ${res.status}${tail}），可重试`, true);
      throw new AppError('UNKNOWN', `模型请求失败（HTTP ${res.status}${tail}）`);
    }

    let body: ChatCompletionBody;
    try {
      body = JSON.parse(responseText) as ChatCompletionBody;
    } catch {
      throw new AppError('AI_INVALID_OUTPUT', '模型返回体不是合法 JSON');
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AppError('AI_INVALID_OUTPUT', '模型未返回内容');
    }
    let value: unknown;
    try {
      value = JSON.parse(stripCodeFence(content));
    } catch {
      throw new AppError('AI_INVALID_OUTPUT', '模型输出无法解析为 JSON');
    }
    return {
      value,
      model: this.cfg.model,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
      },
      providerRequestId: body.id,
    };
  }

  /** 容忍个别模型在 JSON 外套 Markdown 代码围栏；协议仍要求纯 JSON。 */
  generateProfile(input: ProfileInput, signal: AbortSignal, repair?: RepairTurn): Promise<AIResponse> {
    const msgs = buildProfileMessages(input);
    return this.chat(repair ? appendRepair(msgs, repair.errorSummary, repair.badOutput) : msgs, signal);
  }

  classifyComments(input: ClassificationInput, signal: AbortSignal, repair?: RepairTurn): Promise<AIResponse> {
    const msgs = buildCommentMessages(input);
    return this.chat(repair ? appendRepair(msgs, repair.errorSummary, repair.badOutput) : msgs, signal);
  }
}

export function stripCodeFence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(t);
  return m ? m[1]!.trim() : t;
}
