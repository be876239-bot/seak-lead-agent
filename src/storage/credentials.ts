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

async function ensureSessionAccessLevel() {
  const storage = browser.storage.session as unknown as {
    setAccessLevel?: (level: string) => Promise<void>;
  };
  await storage.setAccessLevel?.('TRUSTED_CONTEXTS');
}

export async function saveCredential(cred: Credential): Promise<void> {
  await ensureSessionAccessLevel();
  if (cred.remember) {
    await browser.storage.local.set({ [KEY]: cred });
    await browser.storage.session.remove(KEY);
  } else {
    await browser.storage.session.set({ [KEY]: cred });
    await browser.storage.local.remove(KEY);
  }
}

export async function loadCredential(): Promise<Credential | null> {
  const inSession = await browser.storage.session.get(KEY);
  if (inSession[KEY]) return inSession[KEY] as Credential;
  const inLocal = await browser.storage.local.get(KEY);
  return (inLocal[KEY] as Credential) ?? null;
}

export async function clearCredential(): Promise<void> {
  await browser.storage.session.remove(KEY);
  await browser.storage.local.remove(KEY);
}
