import { useCallback, useState } from 'react';
import { browser } from 'wxt/browser';
import Discovery from './Discovery';
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
  const {
    state: onboardingState,
    loaded: onboardingLoaded,
    refresh: refreshOnboarding,
    startOrResume,
    pause: pauseOnboarding,
    completeStep,
  } = useOnboardingController();
  const version = browser.runtime.getManifest().version;

  const beginOrResumeGuide = useCallback(async () => {
    const next = await startOrResume();
    const stepId = currentOnboardingStep(next);
    if (stepId) {
      setTab(sidepanelOnboardingAdapter.getViewForLocation(ONBOARDING_STEPS[stepId].location));
    }
  }, [startOrResume]);

  const versionButtonLabel = onboardingState?.status === 'completed' ? '重新学习引导' : '新手引导';

  return (
    <div className="sl-app">
      <header className="sl-header">
        <h1 className="sl-brand">觅客 Agent <span className="sl-version">v{version}</span></h1>
        <button type="button" className="sl-help-button" disabled={!onboardingLoaded} onClick={() => void beginOrResumeGuide()}>
          {versionButtonLabel}
        </button>
      </header>
      <nav className="sl-nav" aria-label="主要功能">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="sl-nav__button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="sl-main">
        {onboardingLoaded && (
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
