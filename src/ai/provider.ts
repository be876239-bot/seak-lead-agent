import type { ProfileInput, ClassificationInput } from '../privacy/ai-payload';

export type AIResponse = {
  value: unknown;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  providerRequestId?: string;
};

export interface AIProvider {
  generateProfile(input: ProfileInput, signal: AbortSignal): Promise<AIResponse>;
  classifyComments(input: ClassificationInput, signal: AbortSignal): Promise<AIResponse>;
}
