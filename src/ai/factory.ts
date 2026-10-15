import { AppError } from '../domain/errors';
import { BailianProvider } from './bailian';
import type { AIProvider } from './provider';

export type ProviderConfig = { apiKey: string; baseUrl: string; model: string };

/**
 * 生产装配入口：缺 Key 立即 AI_AUTH，绝不静默回退到 mock。
 * MockProvider 只允许测试/开发代码显式构造注入，不经此工厂。
 */
export function getProvider(cfg: ProviderConfig): AIProvider {
  if (!cfg.apiKey) throw new AppError('AI_AUTH', '未配置 API Key，请先在设置页保存');
  return new BailianProvider(cfg);
}
