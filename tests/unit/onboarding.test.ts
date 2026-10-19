import { describe, expect, it } from 'vitest';
import {
  completeOnboardingStep,
  createOnboardingState,
  currentOnboardingStep,
  parseOnboardingState,
  pauseOnboarding,
  reconcileOnboardingState,
  resumeOnboarding,
} from '../../src/onboarding/flow';

describe('onboarding flow state', () => {
  it('starts at AI setup when there is no prior progress', () => {
    expect(currentOnboardingStep(createOnboardingState())).toBe('configure-ai');
  });

  it('skips setup steps when configuration and product already exist', () => {
    const state = reconcileOnboardingState(createOnboardingState(), {
      modelConfigured: true,
      productCount: 2,
    });
    expect(state.completedStepIds).toEqual(['configure-ai', 'add-product']);
    expect(currentOnboardingStep(state)).toBe('search-keyword');
  });

  it('does not skip model setup just because a product exists', () => {
    const state = reconcileOnboardingState(createOnboardingState(), {
      modelConfigured: false,
      productCount: 1,
    });
    expect(currentOnboardingStep(state)).toBe('configure-ai');
  });

  it('advances only through recorded step completion', () => {
    const initial = reconcileOnboardingState(createOnboardingState(), {
      modelConfigured: true,
      productCount: 1,
    });
    const afterSearch = completeOnboardingStep(initial, 'search-keyword');
    expect(currentOnboardingStep(afterSearch)).toBe('start-task');
    const afterTask = completeOnboardingStep(afterSearch, 'start-task');
    expect(currentOnboardingStep(afterTask)).toBe('review-leads');
  });

  it('can pause and resume without losing completed steps', () => {
    const state = completeOnboardingStep(
      reconcileOnboardingState(createOnboardingState(), { modelConfigured: true, productCount: 1 }),
      'search-keyword',
    );
    const paused = pauseOnboarding(state);
    expect(paused.status).toBe('paused');
    expect(currentOnboardingStep(paused)).toBeNull();
    const resumed = resumeOnboarding(paused);
    expect(resumed.status).toBe('in_progress');
    expect(resumed.completedStepIds).toContain('search-keyword');
    expect(currentOnboardingStep(resumed)).toBe('start-task');
  });

  it('safely parses persisted state and discards unknown step IDs', () => {
    const parsed = parseOnboardingState({
      flowVersion: 0,
      status: 'in_progress',
      completedStepIds: ['configure-ai', 'removed-step', 'configure-ai'],
      updatedAt: '2026-10-19T00:00:00.000Z',
    });
    expect(parsed?.flowVersion).toBe(1);
    expect(parsed?.completedStepIds).toEqual(['configure-ai']);
    expect(parseOnboardingState({ status: 'broken', completedStepIds: [] })).toBeNull();
  });

  it('marks the flow complete after every step is completed', () => {
    let state = reconcileOnboardingState(createOnboardingState(), {
      modelConfigured: true,
      productCount: 1,
    });
    state = completeOnboardingStep(state, 'search-keyword');
    state = completeOnboardingStep(state, 'start-task');
    state = completeOnboardingStep(state, 'review-leads');
    expect(state.status).toBe('completed');
    expect(currentOnboardingStep(state)).toBeNull();
  });
});
