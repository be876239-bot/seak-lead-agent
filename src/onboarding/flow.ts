export const ONBOARDING_FLOW_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = 'onboarding.flowState.v1';

export const ONBOARDING_STEP_ORDER = [
  'configure-ai',
  'add-product',
  'search-keyword',
  'start-task',
  'review-leads',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_ORDER)[number];
export type OnboardingStatus = 'in_progress' | 'paused' | 'completed';

export type OnboardingState = {
  flowVersion: number;
  status: OnboardingStatus;
  completedStepIds: OnboardingStepId[];
  updatedAt: string;
};

export type OnboardingReadiness = {
  modelConfigured: boolean;
  productCount: number;
  /** True only when a non-empty API Key and model name have been saved. */
  credentialSaved?: boolean;
  /** Permission for the selected provider endpoint, not every endpoint offered by the provider. */
  providerPermissionGranted?: boolean;
};

const STEP_SET = new Set<string>(ONBOARDING_STEP_ORDER);

function timestamp(): string {
  return new Date().toISOString();
}

export function createOnboardingState(status: OnboardingStatus = 'in_progress'): OnboardingState {
  return {
    flowVersion: ONBOARDING_FLOW_VERSION,
    status,
    completedStepIds: [],
    updatedAt: timestamp(),
  };
}

export function parseOnboardingState(value: unknown): OnboardingState | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.flowVersion !== 'number' || !Array.isArray(raw.completedStepIds)) return null;
  if (!['in_progress', 'paused', 'completed'].includes(String(raw.status))) return null;
  const completedStepIds = [...new Set(raw.completedStepIds.filter(
    (id): id is OnboardingStepId => typeof id === 'string' && STEP_SET.has(id),
  ))];
  // Preserve known progress across a flow revision; unknown step IDs are safely discarded.
  return {
    flowVersion: ONBOARDING_FLOW_VERSION,
    status: raw.status as OnboardingStatus,
    completedStepIds,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : timestamp(),
  };
}

export function currentOnboardingStep(state: OnboardingState | null): OnboardingStepId | null {
  if (!state || state.status !== 'in_progress') return null;
  const completed = new Set(state.completedStepIds);
  return ONBOARDING_STEP_ORDER.find((id) => !completed.has(id)) ?? null;
}

export function reconcileOnboardingState(
  state: OnboardingState,
  readiness: OnboardingReadiness,
): OnboardingState {
  if (state.status !== 'in_progress') return state;
  const completed = new Set(state.completedStepIds);
  if (readiness.modelConfigured) completed.add('configure-ai');
  if (readiness.productCount > 0) completed.add('add-product');
  const completedStepIds = ONBOARDING_STEP_ORDER.filter((id) => completed.has(id));
  const status = completedStepIds.length === ONBOARDING_STEP_ORDER.length ? 'completed' : 'in_progress';
  return { ...state, completedStepIds, status, updatedAt: timestamp() };
}

export function completeOnboardingStep(
  state: OnboardingState,
  stepId: OnboardingStepId,
): OnboardingState {
  if (state.status !== 'in_progress') return state;
  const completed = new Set(state.completedStepIds);
  completed.add(stepId);
  const completedStepIds = ONBOARDING_STEP_ORDER.filter((id) => completed.has(id));
  const status = completedStepIds.length === ONBOARDING_STEP_ORDER.length ? 'completed' : 'in_progress';
  return { ...state, completedStepIds, status, updatedAt: timestamp() };
}

export function pauseOnboarding(state: OnboardingState | null): OnboardingState {
  return { ...(state ?? createOnboardingState()), status: 'paused', updatedAt: timestamp() };
}

export function resumeOnboarding(state: OnboardingState | null): OnboardingState {
  if (!state) return createOnboardingState();
  if (state.status === 'completed') return createOnboardingState();
  return { ...state, status: 'in_progress', updatedAt: timestamp() };
}

export function restartOnboarding(): OnboardingState {
  return createOnboardingState();
}
