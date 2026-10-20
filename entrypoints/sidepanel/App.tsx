import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import Discovery from './Discovery';
import BrandMark from '../../src/ui/BrandMark';
import Products from './Products';
import Leads from './Leads';
import Settings from './Settings';
import OnboardingGuide from '../../src/ui/OnboardingGuide';
import { ONBOARDING_STEPS } from '../../src/onboarding/catalog';
import { currentOnboardingStep } from '../../src/onboarding/flow';
import { useOnboardingController } from '../../src/onboarding/useOnboardingController';
import { sidepanelOnboardingAdapter, type SidepanelViewId } from './onboardingAdapter';

type Tab = SidepanelViewId;

const TABS: { id: Tab; label: string }[] = [
  { id: 'products', label: '产品' },
  { id: 'discovery', label: '寻找客户' },
  { id: 'leads', label: '线索' },
  { id: 'settings', label: '设置' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('products');
  const [guideDismissed, setGuideDismissed] = useState(true);
  const [dismissalLoaded, setDismissalLoaded] = useState(false);
  const {
    state: onboardingState,
    loaded: onboardingLoaded,
    refresh: refreshOnboarding,
    startOrResume,
    pause: pauseOnboarding,
    completeStep,
  } = useOnboardingController();
  const version = browser.runtime.getManifest().version;

  useEffect(() => {
    let active = true;
    void browser.storage.local.get('onboarding.dismissed')
      .then((values) => {
        if (!active) return;
        setGuideDismissed(values['onboarding.dismissed'] === true);
        setDismissalLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        // If local storage is temporarily unavailable, do not block normal use.
        setGuideDismissed(false);
        setDismissalLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const beginOrResumeGuide = useCallback(async () => {
    setGuideDismissed(false);
    void browser.storage.local.remove('onboarding.dismissed').catch(() => undefined);
    const next = await startOrResume();
    const stepId = currentOnboardingStep(next);
    if (stepId) {
      setTab(sidepanelOnboardingAdapter.getViewForLocation(ONBOARDING_STEPS[stepId].location));
    }
  }, [startOrResume]);

  const dismissGuide = useCallback(async () => {
    setGuideDismissed(true);
    try {
      await browser.storage.local.set({ 'onboarding.dismissed': true });
    } catch {
      // The current view still closes even if persistence is unavailable.
    }
    if (onboardingState?.status === 'in_progress') await pauseOnboarding();
  }, [onboardingState?.status, pauseOnboarding]);

  const versionButtonLabel = onboardingState?.status === 'completed' ? '重新学习引导' : '新手引导';

  return (
    <div className="sl-app">
      <header className="sl-header">
        <h1 className="sl-brand">
          <BrandMark />觅客Agent <span className="sl-version">v{version}</span>
        </h1>
        <button
          type="button"
          className="sl-help-button"
          disabled={!onboardingLoaded || !dismissalLoaded}
          onClick={() => void beginOrResumeGuide()}
        >
          {versionButtonLabel}
        </button>
      </header>
      <nav aria-label="主要功能" className="sl-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className="sl-nav__button"
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="sl-main">
        {onboardingLoaded && dismissalLoaded && !guideDismissed && (
          <OnboardingGuide
            state={onboardingState}
            viewId={tab}
            adapter={sidepanelOnboardingAdapter}
            onStart={() => void beginOrResumeGuide()}
            onPause={() => void pauseOnboarding()}
            onResume={() => void beginOrResumeGuide()}
            onRefresh={refreshOnboarding}
            onNavigate={setTab}
            onComplete={(stepId) => void completeStep(stepId)}
            onDismiss={() => void dismissGuide()}
          />
        )}
        {tab === 'discovery' && (
          <Discovery
            onSearchConfirmed={() => void completeStep('search-keyword')}
            onTaskStarted={() => void completeStep('start-task')}
          />
        )}
        {tab === 'settings' && <Settings />}
        {tab === 'products' && <Products />}
        {tab === 'leads' && <Leads />}
      </main>
    </div>
  );
}
