import { browser } from 'wxt/browser';
import { ONBOARDING_STORAGE_KEY, parseOnboardingState, type OnboardingState } from './flow';

export async function loadOnboardingState(): Promise<OnboardingState | null> {
  const values = await browser.storage.local.get(ONBOARDING_STORAGE_KEY);
  return parseOnboardingState(values[ONBOARDING_STORAGE_KEY]);
}

export async function saveOnboardingState(state: OnboardingState): Promise<void> {
  await browser.storage.local.set({ [ONBOARDING_STORAGE_KEY]: state });
}
