import type { OnboardingStepId } from './flow';

/**
 * Stable, UI-independent destinations for the onboarding journey.
 * A UI adapter maps these logical locations to the application's actual routes/tabs.
 */
export type OnboardingLocationId =
  | 'ai-settings'
  | 'product-setup'
  | 'search-workflow'
  | 'lead-review';

/**
 * Stable semantic target names. UI adapters map these to DOM selectors or native UI refs.
 * Keep these IDs stable when the visual design changes.
 */
export type OnboardingTargetId =
  | 'model-save'
  | 'product-url'
  | 'search-keyword'
  | 'discovery-start'
  | 'lead-list';

export type OnboardingStepDefinition = {
  location: OnboardingLocationId;
  target: OnboardingTargetId;
  title: string;
  description: string;
};

export const ONBOARDING_STEPS: Record<OnboardingStepId, OnboardingStepDefinition> = {
  'configure-ai': {
    location: 'ai-settings',
    target: 'model-save',
    title: '检查 AI 配置',
    description: '在设置区域填写 API Key 和模型名称，点击“保存”，再点击“授权模型域名”并允许访问。建议连接测试成功后，返回这里检查配置。引导不会显示或额外保存你的 Key。',
  },
  'add-product': {
    location: 'product-setup',
    target: 'product-url',
    title: '添加一个产品',
    description: '粘贴产品官网链接并生成产品画像。已有产品会自动跳过这一步；完成后返回这里检查产品记录。',
  },
  'search-keyword': {
    location: 'search-workflow',
    target: 'search-keyword',
    title: '复制关键词并手动搜索',
    description: '选择一个搜索方向，复制关键词，再切到已登录的小红书页面手动搜索。回到扩展后，勾选已搜索并看到结果。插件不会替你提交搜索。',
  },
  'start-task': {
    location: 'search-workflow',
    target: 'discovery-start',
    title: '启动第一次任务',
    description: '确认小红书标签页显示对应搜索结果，设置帖子数量，然后启动任务。只有任务启动成功后，这一步才会完成。',
  },
  'review-leads': {
    location: 'lead-review',
    target: 'lead-list',
    title: '查看线索和证据',
    description: '查看意向判断、需求证据、不确定点和处理状态。没有发现高意向线索也不影响完成新手引导。',
  },
};
