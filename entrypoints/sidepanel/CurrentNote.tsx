import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Job, Product } from '../../src/domain/schemas';
import { sendRequest } from '../../src/messaging/client';
import { toErrorPayload } from '../../src/domain/errors';
import { getNoteStatus } from '../../src/xhs/capture';
import type { XhsStatusPayload } from '../../src/messaging/protocol';
import {
  buildLeadGroups, GROUP_ORDER, GROUP_TITLES, isJobActive, isRetryableJob, jobPhaseLabel, safeExternalUrl,
  type LeadView,
} from '../../src/ui/logic';
import { getSelectedProductId, ui } from '../../src/ui/store';
import { emitLocalJobLog } from '../../src/ui/joblog';
import JobLogPanel from './JobLog';

const JOB_KEY = 'note.lastJobId';

async function getActiveTabId(): Promise<number | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

function ItemCard({ view, product, onToggleHandled }: {
  view: LeadView; product: Product; onToggleHandled: (v: LeadView) => void;
}) {
  const stale = view.analysis.profileVersion !== product.profileVersion;
  const url = safeExternalUrl(view.comment.profileUrl); // 不自动打开，也只给合法链接
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 6, padding: 6, fontSize: 12 }}>
      <div style={{ color: '#444' }}>{view.comment.text}</div>
      <div style={{ marginTop: 4 }}>
        <b>{view.analysis.decision.needSummary}</b>
        <span style={{ color: '#777', marginLeft: 6 }}>意向对象：{view.analysis.decision.intentTarget}</span>
      </div>
      {view.analysis.decision.evidence.length > 0 && (
        <div style={{ color: '#999' }}>证据：{view.analysis.decision.evidence.map((e) => e.quote).join(' / ')}</div>
      )}
      {view.analysis.decision.uncertainty && (
        <div style={{ color: '#b60' }}>不确定：{view.analysis.decision.uncertainty}</div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <span style={{ color: view.source === 'human' ? '#07c' : '#999' }}>
          {view.source === 'human' ? `人工纠正（模型原判 ${GROUP_TITLES[view.modelGroup]}）` : '模型结果'}
        </span>
        {stale && <span style={{ color: '#b60' }}>旧画像 v{view.analysis.profileVersion}（当前 v{product.profileVersion}）</span>}
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={view.handled} onChange={() => onToggleHandled(view)} />已处理
        </label>
        {url && <a href={url} target="_blank" rel="noreferrer">查看该评论者主页</a>}
      </div>
    </div>
  );
}

export default function CurrentNote() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [status, setStatus] = useState<XhsStatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);
  const [groups, setGroups] = useState<Record<string, LeadView[]> | null>(null);
  const pollRef = useRef<number | null>(null);

  const product = products.find((p) => p.id === productId) ?? null;

  const refreshTab = useCallback(async () => {
    const id = await getActiveTabId();
    setTabId(id);
    if (id == null) { setStatus(null); setStatusError('未找到活动标签页'); return; }
    try {
      const st = await getNoteStatus(id);
      setStatus(st);
      setStatusError(null);
    } catch (err) {
      setStatus(null);
      setStatusError(toErrorPayload(err).message);
    }
  }, []);

  const loadResults = useCallback(async (finished: Job) => {
    if (!finished.noteKey || !finished.productId) return;
    const comments = await ui.commentsForNote(finished.noteKey);
    setLoadedCount(comments.length);
    const analyses = await ui.analysesFor(finished.productId, comments.map((c) => c.commentKey));
    const feedback = await ui.feedbackForProduct(finished.productId);
    const states = await ui.leadStatesForProduct(finished.productId);
    setGroups(buildLeadGroups({ analyses, comments, feedback, leadStates: states }));
  }, []);

  useEffect(() => {
    void refreshTab();
    void ui.listProducts().then((list) => {
      setProducts(list);
      void getSelectedProductId().then((sel) => setProductId(sel && list.some((p) => p.id === sel) ? sel : list[0]?.id ?? null));
    });
    // 重开面板恢复未完成任务的轮询
    void (async () => {
      const r = await browser.storage.local.get(JOB_KEY);
      const saved = r[JOB_KEY] as string | undefined;
      if (!saved) return;
      try {
        const res = await sendRequest<{ job: Job | null }>('JOB_GET', { jobId: saved });
        if (res.job) {
          setJob(res.job);
          if (!isJobActive(res.job)) await loadResults(res.job);
        }
      } catch { /* 后台尚未就绪 */ }
    })();
  }, [refreshTab, loadResults]);

  const busy = isJobActive(job);

  useEffect(() => {
    if (!job || !busy) return;
    const jobId = job.id;
    const tick = async () => {
      try {
        const res = await sendRequest<{ job: Job | null }>('JOB_GET', { jobId });
        setJob((prev) => (prev && prev.id === jobId ? res.job ?? prev : prev));
        if (res.job && !isJobActive(res.job)) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          await loadResults(res.job);
        }
      } catch (err) {
        setError(toErrorPayload(err).message);
      }
    };
    pollRef.current = window.setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [job?.id, busy, loadResults]);

  const analyze = async () => {
    if (tabId == null || !productId) return;
    if (busy) return; // 按钮不重复创建任务
    setError(null);
    setGroups(null);
    setLoadedCount(null);
    const jobId = crypto.randomUUID();
    await browser.storage.local.set({ [JOB_KEY]: jobId });
    setJob({
      id: jobId, kind: 'comments', status: 'created', ownerId: '', generation: 0,
      productId, profileVersion: null, tabId, noteKey: null,
      provider: '', modelId: '', promptVersion: '', totalItems: 0, completedItems: 0, failedItems: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorCode: null,
    });
    try {
      await sendRequest('NOTE_ANALYZE', { jobId, tabId, productId });
    } catch (err) {
      const e = toErrorPayload(err);
      setError(e.message);
      emitLocalJobLog(jobId, `启动失败：${e.code} ${e.message.slice(0, 200)}`, 'error');
    }
  };

  const retry = async () => {
    if (!job) return;
    setError(null);
    try {
      await sendRequest('JOB_RETRY', { jobId: job.id });
      setJob({ ...job, status: 'analyzing', errorCode: null });
    } catch (err) {
      setError(toErrorPayload(err).message);
    }
  };

  const cancel = async () => {
    if (!job) return;
    const res = await sendRequest<{ cancelling: boolean }>('JOB_CANCEL', { jobId: job.id }).catch(() => null);
    if (res && !res.cancelling) setError('任务已结束或不在本后台运行，无需取消');
  };

  const toggleHandled = async (view: LeadView) => {
    if (!job?.productId) return;
    await ui.setLeadHandled(job.productId, view.comment.commentKey, !view.handled);
    if (job.noteKey) await loadResults(job);
  };

  const noteChanged = !!job?.noteKey && !!status?.noteKey && job.noteKey !== status.noteKey;
  const analyzeLabel = job?.noteKey && groups ? '新增分析（只处理未分析过的评论）' : '读取并分析已加载评论';

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>当前产品：</span>
        <select value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)} disabled={busy}>
          {products.length === 0 && <option value="">（尚无产品，请先到“产品”页创建）</option>}
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.profile.name.value ?? p.inputUrl}（v{p.profileVersion}）</option>
          ))}
        </select>
        <button onClick={() => void refreshTab()}>刷新页面状态</button>
      </div>

      {!products.length && <p style={{ color: '#c00', margin: 0 }}>还没有产品：请先到“产品”页粘贴链接生成画像。</p>}
      {statusError && <p style={{ color: '#c00', margin: 0 }}>无法读取页面状态：{statusError}。请在浏览器中打开一篇小红书笔记后点“刷新页面状态”。</p>}
      {status?.blocked && <p style={{ color: '#b60', margin: 0 }}>页面被限流或验证码拦截：请你在页面上手动处理后重试，扩展不会自动操作页面。</p>}
      {status && !status.supported && !status.blocked && (
        <p style={{ color: '#b60', margin: 0 }}>当前标签页不是受支持的小红书笔记详情页。</p>
      )}
      {noteChanged && (
        <p style={{ color: '#b60', margin: 0 }}>
          后台任务对应的是旧笔记快照；当前页面已换帖。旧任务结果只会写入旧笔记，不会污染新帖。
        </p>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => void analyze()} disabled={busy || !productId || !status?.supported || status.blocked}>
          {analyzeLabel}
        </button>
        {busy && <button onClick={() => void cancel()}>取消任务</button>}
        {!busy && isRetryableJob(job) && <button onClick={() => void retry()}>重试失败/中断批次</button>}
      </div>
      {job && (
        <p role="status" style={{ margin: 0 }}>
          任务：{jobPhaseLabel(job)}{job.errorCode ? `（${job.errorCode}）` : ''}
          {loadedCount != null && ` · 已读取 ${loadedCount} 条已加载评论（非全部评论）`}
        </p>
      )}
      {job?.totalItems === 0 && job?.status === 'completed' && loadedCount === 0 && (
        <p style={{ color: '#777', margin: 0 }}>页面没有已加载评论：请先在笔记页手动展开评论区再分析。</p>
      )}
      {error && <p style={{ color: '#c00', margin: 0 }}>{error}</p>}
      <JobLogPanel jobId={job?.id ?? null} />
      {job?.noteKey && groups && loadedCount !== null && loadedCount > 0 && (
        <p style={{ color: '#777', margin: 0 }}>本次需要新增 AI 分析的评论：{job.totalItems} 条（其余命中缓存，不重复计费）。</p>
      )}

      {groups && GROUP_ORDER.map((g) => (
        <section key={g} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>{GROUP_TITLES[g]}（{groups[g]?.length ?? 0}）</h3>
          {(groups[g] ?? []).length === 0
            ? <p style={{ color: '#999', margin: 0, fontSize: 12 }}>本组暂无结果。</p>
            : (
              <div style={{ display: 'grid', gap: 6 }}>
                {(groups[g] ?? []).map((v) => (
                  product
                    ? <ItemCard key={v.analysis.id} view={v} product={product} onToggleHandled={(x) => void toggleHandled(x)} />
                    : <div key={v.analysis.id}>{v.comment.text}</div>
                ))}
              </div>
            )}
        </section>
      ))}
    </div>
  );
}
