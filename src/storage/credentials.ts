import { browser } from 'wxt/browser';

export type PresetId = 'bailian';

export const PROVIDER_PRESETS: Record<PresetId, {
  label: string; baseUrl: string; defaultModel: string; origins: string[]; endpoints: { label: string; baseUrl: string }[];
}> = {
  bailian: {
    label: '阿里云百炼（OpenAI 兼容）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-flash',
    origins: ['https://dashscope.aliyuncs.com/*', 'https://dashscope-intl.aliyuncs.com/*'],
    endpoints: [
      { label: '国内（默认）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { label: '国际站', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
    ],
  },
};

export type Credential = {
  presetId: PresetId;
  apiKey: string;
  model: string;
  remember: boolean;
  baseUrl?: string;
};

/** DEVELOPMENT.md 4.2：AI 请求只允许供应商预设域名，不接受任意 Base URL。 */
export function isAllowedBaseUrl(presetId: PresetId, baseUrl: string): boolean {
  return PROVIDER_PRESETS[presetId].endpoints.some((e) => e.baseUrl === baseUrl);
}

export function resolveBaseUrl(cred: { presetId: PresetId; baseUrl?: string }): string {
  const preset = PROVIDER_PRESETS[cred.presetId];
  return cred.baseUrl && isAllowedBaseUrl(cred.presetId, cred.baseUrl) ? cred.baseUrl : preset.baseUrl;
}

const KEY = 'crd' as const;

// storage.session 默认即 TRUSTED_CONTEXTS（仅扩展自身可读），无需也不应调用 setAccessLevel：
// Chrome 要求参数为 { accessLevel } 对象，传字符串会直接抛错导致保存失败。
function sessionArea() {
  return browser.storage.session as
    { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void>; remove: (k: string) => Promise<void> } | undefined;
}

export async function saveCredential(cred: Credential): Promise<void> {
  if (cred.remember) {
    await browser.storage.local.set({ [KEY]: cred });
    await sessionArea()?.remove(KEY);
  } else {
    const session = sessionArea();
    if (!session) throw new Error('此浏览器不支持会话存储：请勾选“记住 Key”或改用 Chrome/Edge 最新版本');
    await session.set({ [KEY]: cred });
    await browser.storage.local.remove(KEY);
  }
}

export async function loadCredential(): Promise<Credential | null> {
  try {
    const inSession = await sessionArea()?.get(KEY);
    if (inSession?.[KEY]) return inSession[KEY] as Credential;
  } catch {
    // 会话区不可用时仍回落到本地存储
  }
  const inLocal = await browser.storage.local.get(KEY);
  return (inLocal[KEY] as Credential) ?? null;
}

export async function clearCredential(): Promise<void> {
  try { await sessionArea()?.remove(KEY); } catch { /* 忽略 */ }
  await browser.storage.local.remove(KEY);
}
