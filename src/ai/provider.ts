import type { ProfileInput, ClassificationInput } from '../privacy/ai-payload';

export type AIResponse = {
  value: unknown;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  providerRequestId?: string;
};

export type RepairTurn = { errorSummary: string; badOutput: string };

export interface AIProvider {
  generateProfile(input: ProfileInput, signal: AbortSignal, repair?: RepairTurn): Promise<AIResponse>;
  classifyComments(input: ClassificationInput, signal: AbortSignal, repair?: RepairTurn): Promise<AIResponse>;
}
