import { browser } from 'wxt/browser';

export type PresetId = 'bailian';

export const PROVIDER_PRESETS: Record<PresetId, { label: string; baseUrl: string; defaultModel: string; origins: string[] }> = {
  bailian: {
    label: '阿里云百炼（OpenAI 兼容）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-flash',
    origins: ['https://dashscope.aliyuncs.com/*'],
  },
};

export type Credential = {
  presetId: PresetId;
  apiKey: string;
  model: string;
  remember: boolean;
};

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
