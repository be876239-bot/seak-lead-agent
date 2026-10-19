import { describe, expect, it } from 'vitest';
import { explainError } from '../../src/ui/error-copy';

describe('plain-language error explanations', () => {
  it('explains a missing search card in everyday Chinese and preserves the checkpoint', () => {
    const result = explainError('候选帖子当前不在已加载搜索DOM中；队列保留，请正常加载原结果后继续', 'PAGE_CHANGED');
    expect(result.title).toContain('网页和任务记录对不上');
    expect(result.impact).toContain('检查点');
    expect(result.nextStep).toContain('继续上次任务');
    expect(result.technicalDetails).toContain('搜索DOM');
  });

  it('explains model authentication failures without exposing the API key', () => {
    const result = explainError('AI_AUTH: API Key=sk-abcdefghijklmnopqrstuvwxyz123456', 'AI_AUTH');
    expect(result.title).toContain('AI 服务授权失败');
    expect(result.nextStep).toContain('API Key');
    expect(result.technicalDetails).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result.technicalDetails).toContain('[已隐藏');
  });

  it('infers common errors when the caller has only a message', () => {
    expect(explainError('小红书要求登录或安全验证').code).toBe('PAGE_BLOCKED');
    expect(explainError('未授予该网站权限').code).toBe('PERMISSION_DENIED');
    expect(explainError('AI 请求超时').code).toBe('AI_TIMEOUT');
    expect(explainError('Failed to fetch').code).toBe('PAGE_UNREACHABLE');
    expect(explainError('请先粘贴产品页链接').code).toBe('URL_INVALID');
  });

  it('uses a safe fallback for unknown errors while retaining short technical context', () => {
    const result = explainError('Unexpected handler failure at step 4');
    expect(result.title).toBe('这一步没有完成');
    expect(result.impact).toContain('不会删除历史线索');
    expect(result.technicalDetails).toContain('Unexpected handler failure');
  });

  it('caps technical detail length', () => {
    const result = explainError('x'.repeat(1000));
    expect(result.technicalDetails).toHaveLength(600);
  });
});
