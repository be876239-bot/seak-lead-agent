import type { OnboardingLocationId, OnboardingTargetId } from './catalog';

/**
 * UI boundary for onboarding. The state machine and step content do not know
 * whether the app uses tabs, routes, panels, dialogs, or a redesigned shell.
 */
export interface OnboardingUIAdapter<TViewId extends string = string> {
  getLocationForView(viewId: TViewId): OnboardingLocationId | null;
  getViewForLocation(location: OnboardingLocationId): TViewId;
  getLocationLabel(location: OnboardingLocationId): string;
  focusTarget(target: OnboardingTargetId): boolean;
}
