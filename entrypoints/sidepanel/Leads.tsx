import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Group, Product } from '../../src/domain/schemas';
import { buildLeadsExport, leadsToCsvRows } from '../../src/export/json';
import { csvWithBom, downloadText, toCsv } from '../../src/export/csv';
import {
  buildLeadGroups, GROUP_ORDER, GROUP_TITLES, intentShortCn, isJobActive, jobPhaseLabel,
  PRODUCT_FIT_CN, safeExternalUrl,
  type LeadView,
} from '../../src/ui/logic';
import { needsTargetBadge } from '../../src/domain/classification';
import { getLeadComments, getSelectedProductId, ui } from '../../src/ui/store';
import LeadExplanation from '../../src/ui/LeadExplanation';

type Filters = { group: Group | 'all'; handled: 'all' | 'handled' | 'unhandled'; query: string };

const EMPTY_GROUPS: Record<Group, LeadView[]> = { high_intent: [], need: [], review: [], excluded: [] };

export default function Leads() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ group: 'all', handled: 'all', query: '' });
  const [views, setViews] = useState<Record<Group, LeadView[]>>(EMPTY_GROUPS);
  const [notes, setNotes] = useState<Record<string, { title: string; url: string | null }>>({});
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftGroup, setDraftGroup] = useState<Group>('need');
  const [draftNote, setDraftNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await ui.listProducts();
    setProducts(list);
    const sel0 = await getSelectedProductId();
    const sel = sel0 && list.some((p) => p.id === sel0) ? sel0 : list[0]?.id ?? null;
    setProductId((prev) => (prev && list.some((p) => p.id === prev) ? prev : sel));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!productId) { setViews(EMPTY_GROUPS); return; }
    void (async () => {
      const [analyses, feedback, states] = await Promise.all([
        ui.analysesForProduct(productId), ui.feedbackForProduct(productId), ui.leadStatesForProduct(productId),
      ]);
      const commentKeys = [...new Set(analyses.map((a) => a.commentKey))];
      const comments = await getLeadComments(commentKeys);
      const built = buildLeadGroups({ analyses, comments, feedback, leadStates: states });
      setViews(built);
      const noteKeys = [...new Set(comments.map((c) => c.noteKey))];
      const info: Record<string, { title: string; url: string | null }> = {};
      for (const nk of noteKeys) {
        const n = await ui.getNote(nk);
        if (n) info[nk] = { title: n.title, url: safeExternalUrl(n.sourceUrl) };
      }
      setNotes(info);
      // 任务进行中提示，避免用户在旧结果上误操作
      const r = await browser.storage.local.get('note.lastJobId');
      const jobId = r['note.lastJobId'] as string | undefined;
      if (jobId) {
        const job = await ui.getJob(jobId);
        setActiveHint(job && isJobActive(job) ? `后台任务进行中：${jobPhaseLabel(job)}（完成后可刷新查看新增）` : null);
      } else setActiveHint(null);
    })();
  }, [productId]);

  const shown: LeadView[] = GROUP_ORDER.flatMap((g) =>
    filters.group === 'all' || filters.group === g ? views[g] : [])
    .filter((v) => filters.handled === 'all' || (filters.handled === 'handled') === v.handled)
    .filter((v) => !filters.query.trim() || v.comment.text.includes(filters.query.trim()) || v.analysis.decision.needSummary.includes(filters.query.trim()))
    .sort((a, b) => b.comment.capturedAt.localeCompare(a.comment.capturedAt));

  const current = products.find((p) => p.id === productId) ?? null;

  const toggleHandled = async (v: LeadView, handled: boolean) => {
    if (!productId) return;
    await ui.setLeadHandled(productId, v.comment.commentKey, handled);
    setViews((prev) => {
      const next = { ...prev };
      for (const g of GROUP_ORDER) next[g] = next[g].map((x) => (x.analysis.id === v.analysis.id ? { ...x, handled } : x));
      return next;
    });
  };

  const saveCorrection = async (v: LeadView) => {
    if (!productId) return;
    await ui.addFeedback({
      productId, commentKey: v.comment.commentKey, analysisId: v.analysis.id,
      correctedGroup: draftGroup === v.modelGroup ? null : draftGroup,
      note: draftNote.trim() ? draftNote.trim().slice(0, 500) : null,
    });
    setEditing(null);
    setDraftNote('');
    setMessage('已保存人工纠正（模型原判保留，不会覆盖）');
    const [analyses, feedback, states] = await Promise.all([
      ui.analysesForProduct(productId), ui.feedbackForProduct(productId), ui.leadStatesForProduct(productId),
    ]);
    const comments = await getLeadComments([...new Set(analyses.map((a) => a.commentKey))]);
    setViews(buildLeadGroups({ analyses, comments, feedback, leadStates: states }));
  };

  const noteUrls = Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, v.url]));
  const filterLabel = `${filters.group === 'all' ? '全部分组' : GROUP_TITLES[filters.group]} · ${
    filters.handled === 'all' ? '全部状态' : filters.handled === 'handled' ? '已处理' : '未处理'
  }${filters.query ? ` · 关键词“${filters.query}”` : ''}`;
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const exportJson = () => downloadText(
    `seeklead-leads-${stamp()}.json`, 'application/json',
    JSON.stringify(
      buildLeadsExport({ product: current, views: shown, noteUrls, filterLabel, exportedAt: new Date().toISOString() }),
      null, 2,
    ),
  );
  const exportCsv = () => downloadText(
    `seeklead-leads-${stamp()}.csv`, 'text/csv',
    csvWithBom(toCsv(leadsToCsvRows(shown, noteUrls))),
  );

  return (
    <div className="sl-page sl-leads-page" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <h2>线索</h2>
      <div className="sl-lead-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>
          {products.length === 0 && <option value="">（尚无产品）</option>}
          {products.map((p) => <option key={p.id} value={p.id}>{p.profile.name.value ?? p.inputUrl}</option>)}
        </select>
        <select value={filters.group} onChange={(e) => setFilters((f) => ({ ...f, group: e.target.value as Filters['group'] }))}>
          <option value="all">全部分组</option>
          {GROUP_ORDER.map((g) => <option key={g} value={g}>{GROUP_TITLES[g]}</option>)}
        </select>
        <select value={filters.handled} onChange={(e) => setFilters((f) => ({ ...f, handled: e.target.value as Filters['handled'] }))}>
          <option value="all">处理状态：全部</option>
          <option value="unhandled">未处理</option>
          <option value="handled">已处理</option>
        </select>
        <input value={filters.query} placeholder="搜索评论/需求摘要"
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
      </div>
      <div className="sl-lead-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={exportJson} disabled={!shown.length}>导出当前筛选 JSON</button>
        <button onClick={exportCsv} disabled={!shown.length}>导出当前筛选 CSV</button>
        <span style={{ color: '#888', fontSize: 12 }}>本地下载，共 {shown.length} 条；不含 Key 与原始未打码内容</span>
      </div>
      {activeHint && <p style={{ color: '#b60', margin: 0 }}>{activeHint}</p>}
      {message && <p style={{ color: '#07c', margin: 0 }}>{message}</p>}
      {!productId && <p style={{ color: '#777', margin: 0 }}>尚无产品，也就没有线索：先到“产品”页创建。</p>}
      {productId && shown.length === 0 && (
        <p style={{ color: '#777', margin: 0 }}>
          当前筛选没有匹配线索。可能是还没分析过该产品的笔记，或评论已按保留期清理；换一个分组或到“当前笔记”页发起分析。
        </p>
      )}
      {shown.map((v) => {
        const note = notes[v.comment.noteKey];
        const stale = current && v.analysis.profileVersion !== current.profileVersion;
        return (
          <div key={v.analysis.id} className="sl-card sl-lead-card" style={{ display: 'grid', gap: 6 }}>
            <div className="sl-lead-meta" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#777' }}>
              <span style={{ background: '#f3f3f3', borderRadius: 4, padding: '0 6px' }}>{GROUP_TITLES[v.group]}</span>
              <span>{v.source === 'human' ? `人工纠正（模型原判：${GROUP_TITLES[v.modelGroup]}）` : '模型结果'}</span>
              {stale && <span style={{ color: '#b60' }}>画像 v{v.analysis.profileVersion}（当前 v{current!.profileVersion}）</span>}
              <span style={{ marginLeft: 'auto' }}>
                {note?.url
                  ? <a href={note.url} target="_blank" rel="noreferrer">{note.title || '打开原帖'}</a>
                  : (note?.title ?? '笔记快照已过期')}
              </span>
            </div>
            <div style={{ color: '#666' }}>
              {v.comment.authorDisplayName ?? '（页面无昵称）'}
              {v.comment.locationText ? ` · ${v.comment.locationText}` : ''}
            </div>
            {!v.comment.parentKey && !v.comment.isReply && <div>{v.comment.text}</div>}
            <div><b>{v.analysis.decision.needSummary}</b>
              <span style={{ color: '#777', marginLeft: 6 }}>
                意向：{intentShortCn(v.analysis.decision)} · 匹配：{PRODUCT_FIT_CN[v.analysis.decision.productFit]}
              </span>
              {needsTargetBadge(v.analysis.decision) === 'competitor' && (
                <span style={{ color: '#b60', marginLeft: 4 }}>（指向竞品，并非本产品）</span>
              )}
            </div>
            {v.analysis.decision.evidence.length > 0 && (
              <div style={{ color: '#999', fontSize: 12 }}>证据：{v.analysis.decision.evidence.map((e) => e.quote).join(' / ')}</div>
            )}
            <LeadExplanation decision={v.analysis.decision} profileUrl={v.comment.profileUrl} comment={v.comment} parentComment={v.parentComment} />
            {v.correction?.note && <div style={{ color: '#07c', fontSize: 12 }}>纠正备注：{v.correction.note}</div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={v.handled} onChange={(e) => void toggleHandled(v, e.target.checked)} />已处理
              </label>
              {editing === v.analysis.id ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={draftGroup} onChange={(e) => setDraftGroup(e.target.value as Group)}>
                    {GROUP_ORDER.map((g) => <option key={g} value={g}>{GROUP_TITLES[g]}</option>)}
                  </select>
                  <input value={draftNote} placeholder="备注（可选，≤500字）" onChange={(e) => setDraftNote(e.target.value)} style={{ width: 160 }} />
                  <button onClick={() => void saveCorrection(v)}>保存纠正</button>
                  <button onClick={() => setEditing(null)}>取消</button>
                </span>
              ) : (
                <button onClick={() => { setEditing(v.analysis.id); setDraftGroup(v.group); setDraftNote(''); }}>修改分组/备注</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
