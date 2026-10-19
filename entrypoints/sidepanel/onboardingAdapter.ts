import type { OnboardingLocationId, OnboardingTargetId } from '../../src/onboarding/catalog';
import type { OnboardingUIAdapter } from '../../src/onboarding/uiAdapter';

export type SidepanelViewId = 'discovery' | 'products' | 'note' | 'leads' | 'settings';

const VIEW_LOCATION: Partial<Record<SidepanelViewId, OnboardingLocationId>> = {
  settings: 'ai-settings',
  products: 'product-setup',
  discovery: 'search-workflow',
  leads: 'lead-review',
};

const LOCATION_VIEW: Record<OnboardingLocationId, SidepanelViewId> = {
  'ai-settings': 'settings',
  'product-setup': 'products',
  'search-workflow': 'discovery',
  'lead-review': 'leads',
};

const LOCATION_LABEL: Record<OnboardingLocationId, string> = {
  'ai-settings': 'AI 配置',
  'product-setup': '产品',
  'search-workflow': '寻找客户',
  'lead-review': '线索',
};

/**
 * The only place where the current Side Panel's semantic tutorial targets
 * are mapped to DOM selectors. Prefer keeping data-onboarding-target IDs in
 * redesigned controls; if the markup changes, update this adapter rather than
 * the tutorial content or state machine.
 */
const TARGET_SELECTOR: Record<OnboardingTargetId, string> = {
  'model-save': '[data-onboarding-target="model-save"]',
  'product-url': '[data-onboarding-target="product-url"]',
  'search-keyword': '[data-onboarding-target="search-keyword"]',
  'discovery-start': '[data-onboarding-target="discovery-start"]',
  'lead-list': '[data-onboarding-target="lead-list"]',
};

const highlightTimers = new WeakMap<HTMLElement, number>();

function spotlight(target: HTMLElement): void {
  const previousTimer = highlightTimers.get(target);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);

  target.dataset.onboardingHighlighted = 'true';
  const timer = window.setTimeout(() => {
    delete target.dataset.onboardingHighlighted;
    highlightTimers.delete(target);
  }, 2200);
  highlightTimers.set(target, timer);
}

export const sidepanelOnboardingAdapter: OnboardingUIAdapter<SidepanelViewId> = {
  getLocationForView(viewId) {
    return VIEW_LOCATION[viewId] ?? null;
  },

  getViewForLocation(location) {
    return LOCATION_VIEW[location];
  },

  getLocationLabel(location) {
    return LOCATION_LABEL[location];
  },

  focusTarget(targetId) {
    if (typeof document === 'undefined') return false;
    const target = document.querySelector<HTMLElement>(TARGET_SELECTOR[targetId]);
    if (!target) return false;

    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    spotlight(target);
    if (target.matches('button, input, select, textarea, a[href], [tabindex]')) {
      target.focus?.({ preventScroll: true });
    }
    return true;
  },
};
