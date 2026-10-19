import { useEffect, useState } from 'react';
import {
  currentOnboardingStep,
  ONBOARDING_STEP_ORDER,
  type OnboardingState,
  type OnboardingStepId,
} from '../onboarding/flow';
import { ONBOARDING_STEPS } from '../onboarding/catalog';
import type { OnboardingUIAdapter } from '../onboarding/uiAdapter';
import './OnboardingGuide.css';

type Props<TViewId extends string> = {
  state: OnboardingState | null;
  viewId: TViewId;
  adapter: OnboardingUIAdapter<TViewId>;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => Promise<void>;
  onNavigate: (viewId: TViewId) => void;
  onComplete: (stepId: OnboardingStepId) => void;
};

export default function OnboardingGuide<TViewId extends string,>({
  state,
  viewId,
  adapter,
  onStart,
  onPause,
  onResume,
  onRefresh,
  onNavigate,
  onComplete,
}: Props<TViewId>) {
  const [hint, setHint] = useState('');
  const stepId = state?.status === 'in_progress' ? currentOnboardingStep(state) : null;
  useEffect(() => setHint(''), [stepId, state?.status]);

  if (!state) {
    return (
      <section className="sl-onboarding sl-onboarding--welcome" aria-labelledby="sl-onboarding-title">
        <div className="sl-onboarding__eyebrow">快速上手 · 约 3 分钟</div>
        <h2 id="sl-onboarding-title">第一次使用觅客 Agent？</h2>
        <p>跟着几个小步骤完成配置、搜索和查看线索。你可以随时暂停，关闭侧边栏后也能继续。</p>
        <div className="sl-onboarding__actions">
          <button className="sl-button--primary" onClick={onStart}>开始快速上手</button>
          <button onClick={onPause}>稍后再说</button>
        </div>
      </section>
    );
  }

  if (state.status === 'completed') return null;

  if (state.status === 'paused') {
    return (
      <section className="sl-onboarding sl-onboarding--paused" aria-label="新手引导已暂停">
        <div>
          <b>新手引导已暂停</b>
          <p>进度已保存在本机。继续时会从上次未完成的步骤开始。</p>
        </div>
        <div className="sl-onboarding__actions">
          <button className="sl-button--primary" onClick={onResume}>继续引导</button>
        </div>
      </section>
    );
  }

  if (!stepId) return null;

  const step = ONBOARDING_STEPS[stepId];
  const currentLocation = adapter.getLocationForView(viewId);
  const currentPage = currentLocation === step.location;
  const totalSteps = ONBOARDING_STEP_ORDER.length;
  const progress = Math.min(totalSteps, state.completedStepIds.length + 1);

  const primaryAction = async () => {
    setHint('');

    if (!currentPage) {
      onNavigate(adapter.getViewForLocation(step.location));
      return;
    }

    if (stepId === 'configure-ai' || stepId === 'add-product') {
      await onRefresh();
      setHint('已重新检查当前配置和产品记录。若步骤没有变化，请确认操作是否成功后再检查一次。');
      return;
    }

    if (stepId === 'review-leads') {
      // Best-effort focus only; a missing target must not trap the user in the tutorial.
      adapter.focusTarget(step.target);
      onComplete(stepId);
      return;
    }

    if (!adapter.focusTarget(step.target)) {
      setHint('暂时找不到这个操作区。请按上方说明手动操作；引导进度不会丢失。');
    }
  };

  const primaryLabel = !currentPage
    ? `前往“${adapter.getLocationLabel(step.location)}”`
    : stepId === 'configure-ai' || stepId === 'add-product'
      ? '检查是否完成'
      : stepId === 'review-leads'
        ? '完成新手引导'
        : '定位操作区';

  return (
    <section className="sl-onboarding sl-onboarding--active" aria-labelledby="sl-onboarding-title" aria-live="polite">
      <div className="sl-onboarding__topline">
        <span className="sl-onboarding__eyebrow">新手引导</span>
        <span className="sl-onboarding__count">第 {progress} / {totalSteps} 步</span>
      </div>
      <div className="sl-onboarding__progress" aria-label={`已完成 ${state.completedStepIds.length} / ${totalSteps} 步`}>
        <span style={{ width: `${state.completedStepIds.length / totalSteps * 100}%` }} />
      </div>
      <h2 id="sl-onboarding-title">{step.title}</h2>
      <p>{step.description}</p>
      {!currentPage && <p className="sl-onboarding__location">当前需要操作：{adapter.getLocationLabel(step.location)}区域</p>}
      {hint && <p className="sl-onboarding__hint" role="status">{hint}</p>}
      <div className="sl-onboarding__actions">
        <button className="sl-button--primary" onClick={() => void primaryAction()}>{primaryLabel}</button>
        <button onClick={onPause}>稍后再说</button>
      </div>
    </section>
  );
}
