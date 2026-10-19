import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ONBOARDING_STEP_ORDER } from '../../src/onboarding/flow';
import { ONBOARDING_STEPS } from '../../src/onboarding/catalog';
import { sidepanelOnboardingAdapter } from '../../entrypoints/sidepanel/onboardingAdapter';

describe('onboarding catalog and Side Panel adapter contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('defines content for every state-machine step', () => {
    expect(Object.keys(ONBOARDING_STEPS).sort()).toEqual([...ONBOARDING_STEP_ORDER].sort());
    for (const stepId of ONBOARDING_STEP_ORDER) {
      expect(ONBOARDING_STEPS[stepId].title.length).toBeGreaterThan(0);
      expect(ONBOARDING_STEPS[stepId].description.length).toBeGreaterThan(0);
      expect(ONBOARDING_STEPS[stepId].target.length).toBeGreaterThan(0);
    }
  });

  it('maps logical destinations to current Side Panel views', () => {
    expect(sidepanelOnboardingAdapter.getViewForLocation('ai-settings')).toBe('settings');
    expect(sidepanelOnboardingAdapter.getViewForLocation('product-setup')).toBe('products');
    expect(sidepanelOnboardingAdapter.getViewForLocation('search-workflow')).toBe('discovery');
    expect(sidepanelOnboardingAdapter.getViewForLocation('lead-review')).toBe('leads');

    expect(sidepanelOnboardingAdapter.getLocationForView('settings')).toBe('ai-settings');
    expect(sidepanelOnboardingAdapter.getLocationForView('products')).toBe('product-setup');
    expect(sidepanelOnboardingAdapter.getLocationForView('discovery')).toBe('search-workflow');
    expect(sidepanelOnboardingAdapter.getLocationForView('leads')).toBe('lead-review');
    expect(sidepanelOnboardingAdapter.getLocationForView('note')).toBeNull();
  });

  it('locates a semantic target without depending on its CSS class or visual layout', () => {
    const target = document.createElement('button');
    target.dataset.onboardingTarget = 'discovery-start';
    target.scrollIntoView = vi.fn();
    document.body.append(target);

    expect(sidepanelOnboardingAdapter.focusTarget('discovery-start')).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(document.activeElement).toBe(target);
  });

  it('returns false instead of guessing when a target is missing', () => {
    expect(sidepanelOnboardingAdapter.focusTarget('model-save')).toBe(false);
  });

  it('keeps the target attribute names as a stable contract', () => {
    const ids = ['model-save', 'product-url', 'search-keyword', 'discovery-start', 'lead-list'] as const;
    for (const id of ids) {
      const target = document.createElement('button');
      target.dataset.onboardingTarget = id;
      target.scrollIntoView = vi.fn();
      document.body.append(target);
      expect(sidepanelOnboardingAdapter.focusTarget(id)).toBe(true);
    }
  });
});
