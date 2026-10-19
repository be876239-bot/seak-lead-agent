import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { PROVIDER_PRESETS, loadCredential } from '../storage/credentials';
import { ui } from '../ui/store';
import {
  completeOnboardingStep,
  currentOnboardingStep,
  pauseOnboarding,
  reconcileOnboardingState,
  resumeOnboarding,
  type OnboardingReadiness,
  type OnboardingState,
  type OnboardingStepId,
} from './flow';
import { loadOnboardingState, saveOnboardingState } from './storage';

export type OnboardingController = {
  state: OnboardingState | null;
  loaded: boolean;
  readiness: OnboardingReadiness;
  refresh: () => Promise<void>;
  startOrResume: () => Promise<OnboardingState>;
  pause: () => Promise<OnboardingState>;
  completeStep: (stepId: OnboardingStepId) => Promise<OnboardingState | null>;
};

/**
 * Persistence and application-readiness boundary for the onboarding flow.
 * The app shell only needs to render a view, navigate via its adapter, and
 * report real completion events from existing product/task controls.
 */
export function useOnboardingController(): OnboardingController {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [readiness, setReadiness] = useState<OnboardingReadiness>({
    modelConfigured: false,
    productCount: 0,
  });

  const stateRef = useRef<OnboardingState | null>(null);
  const loadedRef = useRef(false);
  const pendingCompletionsRef = useRef<OnboardingStepId[]>([]);
  const readinessRef = useRef(readiness);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback((next: OnboardingState): Promise<void> => {
    // Update synchronously so rapid consecutive UI events cannot read stale progress.
    stateRef.current = next;
    setState(next);

    // Preserve write order if a user completes two steps in quick succession.
    const write = writeQueueRef.current.then(() => saveOnboardingState(next));
    writeQueueRef.current = write.catch(() => undefined);
    return write;
  }, []);

  const refresh = useCallback(async () => {
    const [saved, products, credential] = await Promise.all([
      loadOnboardingState(),
      ui.listProducts(),
      loadCredential().catch(() => null),
    ]);

    let modelConfigured = false;
    const preset = credential ? PROVIDER_PRESETS[credential.presetId] : undefined;
    if (credential?.apiKey.trim() && credential.model.trim() && preset) {
      try {
        modelConfigured = await browser.permissions.contains({ origins: preset.origins });
      } catch {
        modelConfigured = false;
      }
    }

    const nextReadiness = { modelConfigured, productCount: products.length };
    readinessRef.current = nextReadiness;
    setReadiness(nextReadiness);

    if (saved?.status === 'in_progress') {
      await persist(reconcileOnboardingState(saved, nextReadiness));
    } else {
      stateRef.current = saved;
      setState(saved);
    }
  }, [persist]);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch(() => {
        // Keep the app usable if local storage or readiness checks temporarily fail.
      })
      .finally(() => {
        if (active) {
          loadedRef.current = true;
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const startOrResume = useCallback(async () => {
    const next = reconcileOnboardingState(
      resumeOnboarding(stateRef.current),
      readinessRef.current,
    );
    await persist(next);
    return next;
  }, [persist]);

  const pause = useCallback(async () => {
    const next = pauseOnboarding(stateRef.current);
    await persist(next);
    return next;
  }, [persist]);

  const completeStep = useCallback(async (stepId: OnboardingStepId) => {
    if (!loadedRef.current) {
      // Preserve real completion signals that arrive while persisted progress is loading.
      pendingCompletionsRef.current.push(stepId);
      return null;
    }
    const current = stateRef.current;
    if (!current || currentOnboardingStep(current) !== stepId) return null;

    let next = completeOnboardingStep(current, stepId);
    next = reconcileOnboardingState(next, readinessRef.current);
    await persist(next);
    return next;
  }, [persist]);

  useEffect(() => {
    if (!loaded || pendingCompletionsRef.current.length === 0) return;
    const pending = pendingCompletionsRef.current.splice(0);
    void (async () => {
      for (const stepId of pending) await completeStep(stepId);
    })();
  }, [loaded, completeStep]);

  return { state, loaded, readiness, refresh, startOrResume, pause, completeStep };
}
