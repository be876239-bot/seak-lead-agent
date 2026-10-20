import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Analysis, Comment, Feedback, Job, LeadState, Note, Product } from '../../src/domain/schemas';
import { LIMITS } from '../../src/domain/limits';
import { buildLeadGroups, GROUP_ORDER, GROUP_TITLES, intentShortCn, isJobActive, isRetryableJob, jobPhaseLabel, type LeadView } from '../../src/ui/logic';
import { needsTargetBadge } from '../../src/domain/classification';
import { ui } from '../../src/ui/store';
import { getNoteStatus } from '../../src/xhs/capture';
import { noteKeyFromUrl } from '../../src/xhs/discovery-dom';
import type { XhsStatusPayload } from '../../src/messaging/protocol';
import LeadExplanation from '../../src/ui/LeadExplanation';
import JobLogPanel from './JobLog';
import CollectionProgressView from '../../src/ui/CollectionProgress';
import ErrorNotice from '../../src/ui/ErrorNotice';

type TaskControl = { scope: 'batch' | 'post'; status: 'running' | 'paused' } | null;

type Props = {
  product: Product;
  noteKey: string;
  postUrl: string;
  status: 'completed' | 'partial' | 'running' | 'paused' | 'pending';
  onRetryFailed: (jobId: string) => void | Promise<void>;
  onReprocess: (postUrl: string) => void;
  onTaskControl: (action: 'pause' | 'stop' | 'continue') => void;
  taskControl: TaskControl;
  controlBusy: boolean;
  busy: boolean;
  refreshKey: number;
};

type Loaded = {
  note: Note | null;
  comments: Comment[];
  analyses: Analysis[];
  feedback: Feedback[];
  leadStates: LeadState[];
  jobs: Job[];
};

function PostLeadCard({ view, product, onToggleHandled }: {
  view: LeadView;
  product: Product;
  onToggleHandled: (view: LeadView) => void;
}) {
  const stale = view.analysis.profileVersion !== product.profileVersion;
  const badge = needsTargetBadge(view.analysis.decision);
  return (
    <details className="sl-card sl-lead-card" data-group={view.group} data-handled={view.handled}>
      <summary className="sl-lead-summary">
        <span className="sl-lead-summary__meta">
          <span className="sl-badge" data-group={view.group}>{GROUP_TITLES[view.group]}</span>
          <span className="sl-badge">{view.handled ? '已处理' : '未处理'}</span>
        </span>
        <b>{view.analysis.decision.needSummary}</b>
        <span className="sl-lead-summary__intent">
          {view.comment.authorDisplayName ?? '（页面无昵称）'}{view.comment.locationText ? ` · ${view.comment.locationText}` : ''} · 意向：{intentShortCn(view.analysis.decision)}
        </span>
      </summary>
      {!view.comment.parentKey && !view.comment.isReply && <div style={{ color: '#444' }}>{view.comment.text}</div>}
      <div style={{ marginTop: 4 }}>
        <span style={{ color: '#777', marginLeft: 0 }}>意向：{intentShortCn(view.analysis.decision)}</span>
        {badge === 'competitor' && <span style={{ color: '#b60', marginLeft: 6 }}>（指向竞品，并非本产品）</span>}
      </div>
      {view.analysis.decision.evidence.length > 0 && (
        <div className="sl-evidence">证据：{view.analysis.decision.evidence.map((e) => e.quote).join(' / ')}</div>
      )}
      <LeadExplanation decision={view.analysis.decision} profileUrl={view.comment.profileUrl} comment={view.comment} parentComment={view.parentComment} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
        <span style={{ color: view.source === 'human' ? '#07c' : '#999' }}>
          {view.source === 'human' ? `人工纠正（模型原判 ${GROUP_TITLES[view.modelGroup]}）` : '模型结果'}
        </span>
        {stale && <span style={{ color: '#b60' }}>旧画像 v{view.analysis.profileVersion}（当前 v{product.profileVersion}）</span>}
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={view.handled} onChange={() => onToggleHandled(view)} />已处理
        </label>
      </div>
    </details>
  );
}

/** Per-post detail inside the single batch-search workflow; this is not a separate single-note mode. */
export default function DiscoveryPostResults({
  product, noteKey, postUrl, status, onRetryFailed, onReprocess,
  onTaskControl, taskControl, controlBusy, busy, refreshKey,
}: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageStatus, setPageStatus] = useState<XhsStatusPayload | null>(null);
  const [pageStatusLoading, setPageStatusLoading] = useState(false);
  const [pageStatusError, setPageStatusError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [note, comments, feedback, leadStates, jobs] = await Promise.all([
        ui.getNote(noteKey),
        ui.commentsForNote(noteKey),
        ui.feedbackForProduct(product.id),
        ui.leadStatesForProduct(product.id),
        ui.jobsForNote(noteKey, product.id),
      ]);
      const analyses = await ui.analysesFor(product.id, comments.map((c) => c.commentKey));
      setLoaded({ note, comments, analyses, feedback, leadStates, jobs });
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取该笔记的本地结果失败');
    } finally {
      setLoading(false);
    }
  }, [noteKey, product.id]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const toggleHandled = async (view: LeadView) => {
    await ui.setLeadHandled(product.id, view.comment.commentKey, !view.handled);
    await refresh();
  };

  const refreshPageStatus = async () => {
    setPageStatusLoading(true);
    setPageStatusError(null);
    setPageStatus(null);
    try {
      const tabs = await browser.tabs.query({ url: 'https://www.xiaohongshu.com/*' });
      const matching = tabs.filter((tab) => {
        if (typeof tab.id !== 'number' || typeof tab.url !== 'string') return false;
        try { return noteKeyFromUrl(tab.url) === noteKey; } catch { return false; }
      });
      if (!matching.length) {
        throw new Error('没有找到已打开的这篇笔记。请先点击“打开笔记”，等待页面加载后再检查。');
      }
      const active = matching.filter((tab) => tab.active);
      const selected = active.length === 1 ? active[0] : matching.length === 1 ? matching[0] : null;
      if (!selected || typeof selected.id !== 'number') {
        throw new Error('发现多个相同笔记标签页，无法安全判断。请只保留一个该笔记页面后再检查。');
      }
      setPageStatus(await getNoteStatus(selected.id));
    } catch (e) {
      setPageStatusError(e instanceof Error ? e.message : '读取该笔记页面状态失败');
    } finally {
      setPageStatusLoading(false);
    }
  };

  const fullRetry = () => {
    if (!window.confirm(
      `完整重试：回到原批量任务对应的搜索结果页，通过笔记卡片重新打开这篇笔记并重新采集评论（最多 ${LIMITS.maxSessionComments} 条）。已有评论、分析和人工纠正都会保留；已成功分析的评论命中缓存，不会重复调用模型。失败或未分析过的评论仍可能调用模型。请先确认原搜索结果页仍打开。继续？`,
    )) return;
    onReprocess(postUrl);
  };

  const groups = loaded ? buildLeadGroups({
    analyses: loaded.analyses,
    comments: loaded.comments,
    feedback: loaded.feedback,
    leadStates: loaded.leadStates,
  }) : null;
  const latestCommentJob = loaded?.jobs.find((job) => job.kind === 'comments' && job.noteKey === noteKey) ?? null;
  const retryable = !!latestCommentJob && isRetryableJob(latestCommentJob) && latestCommentJob.totalItems > 0;

  useEffect(() => {
    if (!latestCommentJob || !isJobActive(latestCommentJob)) return undefined;
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => window.clearInterval(timer);
  }, [latestCommentJob?.id, latestCommentJob?.status, refresh]);

  return (
    <section className="sl-discovery-post-results">
      <div className="sl-discovery-post-results__heading">
        <div>
          <b>{loaded?.note?.title || loaded?.note?.bodyExcerpt || noteKey}</b>
          <div className="sl-page-footnote">{noteKey} · {status === 'completed' ? '已完成' : status === 'partial' ? '部分采集' : status === 'running' ? '处理中' : status === 'paused' ? '已暂停' : '等待处理'}</div>
          <div className="sl-page-footnote">使用产品：{product.profile.name.value ?? product.inputUrl}（画像 v{product.profileVersion}）</div>
        </div>
        <a href={postUrl} target="_blank" rel="noreferrer">打开笔记</a>
      </div>

      {loaded && (
        <div className="sl-discovery-post-results__summary">
          <span>已保存评论：{loaded.comments.length}</span>
          <span>已分析评论：{loaded.analyses.length}</span>
          <span>线索：{Object.values(groups ?? {}).reduce((n, rows) => n + rows.length, 0)}</span>
        </div>
      )}
      {loading && <p role="status">正在读取已保存的评论、分析和人工处理状态…</p>}
      {error && <ErrorNotice message={error} tone="error" />}
      {latestCommentJob?.collection && <CollectionProgressView progress={latestCommentJob.collection} />}
      {latestCommentJob?.errorCode && <ErrorNotice message={`最近一次本帖任务状态：${jobPhaseLabel(latestCommentJob)}；错误代码：${latestCommentJob.errorCode}`} code={latestCommentJob.errorCode} tone="warning" />}

      <div className="sl-discovery-post-results__actions">
        <button type="button" disabled={busy || status === 'pending' || status === 'running' || status === 'paused'} onClick={() => onReprocess(postUrl)}>补采新增评论并分析</button>
        <button type="button" disabled={busy || status === 'pending' || status === 'running' || status === 'paused'} onClick={fullRetry}>完整重试（重读页面）</button>
        {retryable && <button type="button" disabled={busy} onClick={() => void onRetryFailed(latestCommentJob!.id)}>重试失败的 AI 批次</button>}
        <button type="button" disabled={loading} onClick={() => void refresh()}>刷新本帖结果</button>
        <button type="button" disabled={pageStatusLoading} onClick={() => void refreshPageStatus()}>{pageStatusLoading ? '检查页面中…' : '检查该笔记页面状态'}</button>
      </div>

      {pageStatusError && <ErrorNotice message={pageStatusError} tone="error" />}
      {pageStatus && (
        <p className="sl-page-footnote" role="status">
          页面检查结果：{pageStatus.blocked ? '检测到登录限制或风控提示，请手动处理' : !pageStatus.supported ? '当前页面不是受支持的笔记详情页' : pageStatus.noteKey !== noteKey ? '当前页面笔记身份不一致；为避免混淆，不会将其结果写入本条记录' : '页面正常，笔记身份与本条批量结果一致'}。
        </p>
      )}

      {taskControl && (
        <div className="sl-discovery-post-results__task-control">
          <p className="sl-page-footnote">
            {taskControl.scope === 'batch'
              ? '这篇笔记正在批量任务中处理；下方控制会作用于整个批量任务，而不只是这一篇。'
              : '当前重新采集任务只处理这一篇笔记。'}
          </p>
          {taskControl.status === 'running' ? (
            <div className="sl-discovery-post-results__actions">
              <button type="button" disabled={controlBusy} onClick={() => onTaskControl('pause')}>{taskControl.scope === 'batch' ? '暂停整个批量任务' : '暂停本帖任务'}</button>
              <button type="button" disabled={controlBusy} onClick={() => onTaskControl('stop')}>{taskControl.scope === 'batch' ? '停止整个批量任务' : '停止本帖任务'}</button>
            </div>
          ) : (
            <div className="sl-discovery-post-results__actions">
              <button type="button" disabled={controlBusy} onClick={() => onTaskControl('continue')}>{taskControl.scope === 'batch' ? '继续整个批量任务' : '继续本帖任务'}</button>
              <button type="button" disabled={controlBusy} onClick={() => onTaskControl('stop')}>{taskControl.scope === 'batch' ? '停止整个批量任务' : '停止本帖任务'}</button>
            </div>
          )}
        </div>
      )}

      {latestCommentJob && (
        <div className="sl-page-footnote">
          最近一次本帖任务：{jobPhaseLabel(latestCommentJob)} · {latestCommentJob.completedItems}/{latestCommentJob.totalItems} · 错误代码：{latestCommentJob.errorCode ?? '无'}
        </div>
      )}
      {latestCommentJob?.id && <JobLogPanel jobId={latestCommentJob.id} />}

      {groups && GROUP_ORDER.map((group) => (
        <details key={group} className="sl-card sl-discovery-post-results__group">
          <summary>{GROUP_TITLES[group]}（{groups[group]?.length ?? 0}）</summary>
          {(groups[group] ?? []).length === 0
            ? <p className="sl-page-footnote">本组暂无结果。</p>
            : <div className="sl-discovery-post-results__cards">
                {(groups[group] ?? []).map((view) => (
                  <PostLeadCard key={view.analysis.id} view={view} product={product} onToggleHandled={(v) => void toggleHandled(v)} />
                ))}
              </div>}
        </details>
      ))}
      {loaded && loaded.comments.length > 0 && loaded.analyses.length === 0 && (
        <p className="sl-page-footnote">评论已保存，但尚无可展示的分析结果。请检查任务日志，必要时重试失败的 AI 批次。</p>
      )}
      <details className="sl-discovery-post-results__basis">
        <summary>分组依据与结果说明</summary>
        <p>分组由本地固定规则根据模型判断字段生成；人工纠正优先于模型分组，但不会覆盖模型原始结果。旧画像结果会标记版本差异。已有分析命中缓存时不会重复调用模型。采集不完整的帖子不会被当作完整结果。</p>
      </details>
    </section>
  );
}
