import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Job, Product } from '../../src/domain/schemas';
import { sendRequest } from '../../src/messaging/client';
import { toErrorPayload } from '../../src/domain/errors';
import { jobPhaseLabel, isJobActive, STATUS_LABELS, profileUnknownLabels } from '../../src/ui/logic';
import { emitLocalJobLog } from '../../src/ui/joblog';
import JobLogPanel from './JobLog';
import ErrorNotice from '../../src/ui/ErrorNotice';
import { copyTextToClipboard } from '../../src/ui/clipboard';
import { getSelectedProductId, setSelectedProductId, ui } from '../../src/ui/store';
import ProductResearchForm from './ProductResearchForm';
import { isProductConfirmed } from '../../src/product/research';

const CLAIM_ROWS: { key: 'name' | 'category' | 'summary' | 'accessMethod' | 'price' | 'purchaseChannel'; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'category', label: '类别' },
  { key: 'summary', label: '概述' },
  { key: 'accessMethod', label: '获取方式' },
  { key: 'price', label: '价格' },
  { key: 'purchaseChannel', label: '购买渠道' },
];

function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.search = '';
    return u.href;
  } catch {
    return raw.trim();
  }
}

function hostOf(u: string): string {
  try { return new URL(u).host; } catch { return u; }
}

const LIST_ROWS = [
  { key: 'capabilities', label: '能力' },
  { key: 'targetAudience', label: '目标人群' },
  { key: 'needsServed', label: '满足需求' },
  { key: 'exclusions', label: '排除项' },
] as const;

function ProfileView({ product }: { product: Product }) {
  const unknowns = profileUnknownLabels(product.profile);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ text: string; error: boolean } | null>(null);

  const copySuggestion = async (suggestion: string, index: number) => {
    setCopyFeedback(null);
    try {
      await copyTextToClipboard(suggestion);
      setCopiedIndex(index);
      setCopyFeedback({ text: `已复制“${suggestion}”。切回小红书搜索框粘贴并点击搜索即可。`, error: false });
    } catch (error) {
      setCopiedIndex(null);
      setCopyFeedback({ text: error instanceof Error ? error.message : '复制失败，请手动选择关键词复制', error: true });
    }
  };

  return (
    <div className="sl-profile">
      {unknowns.includes('类别') && (
        <p style={{ background: '#fff7e6', border: '1px solid #ffd591', padding: 6, margin: 0 }}>
          类别未知：画像完整度较低。可以照常分析评论，但不会根据猜测补充结论。
        </p>
      )}
      {CLAIM_ROWS.map(({ key, label }) => {
        const claim = product.profile[key];
        return (
          <div key={key} className="sl-profile-row">
            <span className="sl-profile-row__label">{label}</span>
            <div className="sl-profile-row__value">
            <span className="sl-claim-status" data-status={claim.status}>{STATUS_LABELS[claim.status]}</span>
            <span>{claim.value ?? '未知（不阻塞其他信息）'}</span>
            {claim.evidence.length > 0 && (
              <details className="sl-claim-evidence">
                <summary>查看证据（{claim.evidence.length}）</summary>
                <ul style={{ margin: '2px 0', paddingLeft: 18 }}>
                  {claim.evidence.map((e, i) => (
                    <li key={i} style={{ color: '#777' }}>来源 {product.sourceBlocks.find(block => block.id === e.sourceId)?.title ?? e.sourceId}：{e.quote}</li>
                  ))}
                </ul>
              </details>
            )}
            </div>
          </div>
        );
      })}
      {LIST_ROWS.map(({ key, label }) => {
        const items = product.profile[key];
        if (!items.length) return null;
        return (
          <div key={key} className="sl-profile-row">
            <span className="sl-profile-row__label">{label}</span>
            <ul className="sl-profile-list">
              {items.map((c, i) => (
                <li key={i}>[{STATUS_LABELS[c.status]}] {c.value}
                  {c.evidence.length > 0 && (
                    <details className="sl-claim-evidence">
                      <summary>查看来源</summary>
                      <span style={{ color: '#777' }}>来源 {product.sourceBlocks.find(block => block.id === c.evidence[0]!.sourceId)?.title ?? c.evidence[0]!.sourceId}：{c.evidence[0]!.quote}</span>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {product.profile.searchSuggestions.length > 0 && (
        <details className="sl-keywords">
          <summary>建议搜索关键词（{product.profile.searchSuggestions.length}）</summary>
          <p style={{ margin: 0, color: '#666' }}>选择一个关键词复制，再粘贴到小红书搜索框并点击搜索。关键词只是建议，可按实际需要修改。</p>
          <div className="sl-keyword-list">
          {product.profile.searchSuggestions.map((suggestion, index) => (
            <div key={`${index}:${suggestion}`} className="sl-keyword">
              <span className="sl-keyword-text">{suggestion}</span>
              <button type="button" aria-label={`复制关键词：${suggestion}`} onClick={() => void copySuggestion(suggestion, index)}>
                {copiedIndex === index ? '已复制' : '复制关键词'}
              </button>
            </div>
          ))}
          </div>
          {copyFeedback && (
            <p role={copyFeedback.error ? 'alert' : 'status'} style={{ margin: 0, color: copyFeedback.error ? '#b42318' : '#067647' }}>
              {copyFeedback.text}
            </p>
          )}
        </details>
      )}
    </div>
  );
}

function DraftProfileEditor({ product, onSaved }: { product: Product; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(product.profile.name.value ?? '');
  const [category, setCategory] = useState(product.profile.category.value ?? '');
  const [summary, setSummary] = useState(product.profile.summary.value ?? '');
  const [keywords, setKeywords] = useState(product.profile.searchSuggestions.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const claim = (value: string) => value.trim()
    ? { value: value.trim(), status: 'user_edited' as const, evidence: [] }
    : { value: null, status: 'unknown' as const, evidence: [] };
  const save = async () => {
    setSaving(true); setError('');
    try {
      await ui.applyUserEdit(product.id, {
        name: claim(name), category: claim(category), summary: claim(summary),
        searchSuggestions: [...new Set(keywords.split(/[\n,，]/).map(v => v.trim()).filter(Boolean))].slice(0, 8),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存修改失败');
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="sl-stack">
      <summary>修正画像（名称、类别、概述、搜索词）</summary>
      <label className="sl-field">产品名称<input value={name} onChange={e => setName(e.target.value)} disabled={saving} /></label>
      <label className="sl-field">产品类别<input value={category} onChange={e => setCategory(e.target.value)} disabled={saving} /></label>
      <label className="sl-field">产品概述<textarea rows={3} value={summary} onChange={e => setSummary(e.target.value)} disabled={saving} /></label>
      <label className="sl-field">建议搜索词（每行一个，最多 8 个）<textarea rows={4} value={keywords} onChange={e => setKeywords(e.target.value)} disabled={saving} /></label>
      <button type="button" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存画像修改'}</button>
      {error && <p role="alert" className="sl-notice sl-notice--warning">{error}</p>}
      <p className="sl-page-footnote">人工修改会标记为“用户编辑”，不会伪装成来源证据。保存修改后仍需单独确认画像。</p>
    </details>
  );
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setProducts(await ui.listProducts());
  }, []);

  useEffect(() => {
    void refresh();
    void getSelectedProductId().then((id) => id && setSelectedId(id));
  }, [refresh]);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await sendRequest<{ job: Job | null }>('JOB_GET', { jobId });
        if (stop) return;
        setJob(res.job);
        if (res.job && !isJobActive(res.job)) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setError(res.job.errorCode
            ? res.job.errorMessage
              ? '任务' + jobPhaseLabel(res.job) + '（' + res.job.errorCode + '）：' + res.job.errorMessage
              : '任务' + jobPhaseLabel(res.job) + '（' + res.job.errorCode + '）'
            : null);
          await refresh();
        }
      } catch (err) {
        if (!stop) setError(toErrorPayload(err).message);
      }
    };
    pollRef.current = window.setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      stop = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [jobId, refresh]);

  const start = async (existingProductId?: string) => {
    setError(null);
    setInfo(null);
    if (!url.trim()) { setError('请先粘贴产品页链接'); return; }
    let origin: string;
    try {
      const u = new URL(url.trim());
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('proto');
      origin = u.origin;
    } catch {
      setError('链接需是 http(s) 完整地址');
      return;
    }
    // 授权弹窗必须在用户点击手势内发起；后台只能校验，不能弹权限窗
    let granted = false;
    try {
      granted = await browser.permissions.request({ origins: [`${origin}/*`] });
    } catch {
      setError('域名授权请求失败：请检查链接格式后重试');
      return;
    }
    if (!granted) { setError(`未授权 ${origin}：无法读取该网站，请重新点击并在弹窗中选择“允许”`); return; }
    const jobIdNew = crypto.randomUUID();
    setJob({
      id: jobIdNew, kind: 'product', status: 'created', ownerId: '', generation: 0,
      productId: null, profileVersion: null, tabId: null, noteKey: null,
      provider: '', modelId: '', promptVersion: '', totalItems: 1, completedItems: 0, failedItems: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorCode: null,
    });
    setJobId(jobIdNew);
    try {
      await sendRequest('PRODUCT_CREATE', { jobId: jobIdNew, url: url.trim(), existingProductId });
    } catch (err) {
      const e = toErrorPayload(err);
      setError(e.message);
      emitLocalJobLog(jobIdNew, `启动失败：${e.code} ${e.message.slice(0, 200)}`, 'error');
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    await sendRequest('PRODUCT_CANCEL_READ', { jobId }).catch(() => {});
    await sendRequest('JOB_CANCEL', { jobId }).catch(() => {});
  };

  const select = async (id: string) => {
    const candidate = products.find(p => p.id === id);
    if (candidate && !isProductConfirmed(candidate)) {
      setInfo('这个产品画像还未确认。请先查看证据、修正必要信息并点击“确认画像并用于寻客”。');
      return;
    }
    setSelectedId(id);
    await setSelectedProductId(id);
  };

  const confirmDraft = async (p: Product) => {
    setError(null);
    if (!p.profile.name.value?.trim() || p.profile.searchSuggestions.length === 0) {
      setInfo('请先修正画像，至少填写产品名称并保留一个建议搜索词，再确认。');
      setExpandedId(p.id);
      return;
    }
    try {
      await ui.confirmProduct(p.id);
      setSelectedId(p.id);
      await setSelectedProductId(p.id);
      await refresh();
      setInfo('画像已确认并设为当前产品。现在可以进入“寻找客户”开始批量寻客。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认画像失败');
    }
  };

  const remove = async (p: Product) => {
    const label = p.profile.name.value ?? p.source?.productName ?? p.source?.targetProduct ?? p.source?.account ?? (p.inputUrl || '未命名产品');
    if (!window.confirm(`删除产品「${label}」及其全部线索、纠正与处理状态？不可撤销。`)) return;
    await ui.deleteProduct(p.id);
    if (selectedId === p.id) {
      setSelectedId(null);
      await setSelectedProductId(null);
    }
    await refresh();
  };

  const reuse = async (p: Product) => {
    if (!isProductConfirmed(p)) {
      setInfo('这是一份待确认画像，不能直接复用。请先检查并确认。');
      setExpandedId(p.id);
      return;
    }
    setSelectedId(p.id);
    setExpandedId(p.id);
    await setSelectedProductId(p.id);
    setInfo(`已选为当前产品：${p.profile.name.value ?? hostOf(p.inputUrl)}（画像 v${p.profileVersion}，未调用模型、不产生费用）。`);
  };

  const busy = isJobActive(job);
  const key = url.trim() ? urlKey(url) : '';
  const match = !busy && key
    ? products.find((p) => urlKey(p.inputUrl) === key || urlKey(p.finalUrl) === key)
    : undefined;
  return (
    <div className="sl-page sl-products-page">
      <div className="sl-page-heading"><h2>产品</h2><span>理解产品，再寻找客户</span></div>
      <div className="sl-product-create">
        <input
          aria-label="产品官网链接"
          data-onboarding-target="product-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴产品官网链接（公网 http/https）"
          disabled={busy}
        />
        <button className="sl-button--primary" onClick={() => void start()} disabled={busy}>{busy ? '识别中…' : '读取并生成画像'}</button>
        {busy && <button onClick={() => void cancel()}>取消</button>}
      </div>
      {job && (
        <p role="status" style={{ margin: 0 }}>
          {jobPhaseLabel(job)}
          {job.status === 'created' && '：正在读取产品页（静态优先，必要时渲染兜底）'}
          {job.status === 'analyzing' && '：模型生成画像中'}
        </p>
      )}
      {error && <ErrorNotice message={error} tone="error" />}
      {info && <p style={{ color: '#0a7', margin: 0 }}>{info}</p>}
      {match && (
        <div className="sl-notice sl-notice--info sl-product-match">
          这个链接已识别过：{match.profile.name.value ?? hostOf(match.inputUrl)}（画像 v{match.profileVersion}，{match.updatedAt.slice(0, 16).replace('T', ' ')} 更新）。
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={() => void reuse(match)}>直接复用（不调用模型）</button>
            <button onClick={() => void start(match.id)}>重新识别（更新同一产品，会调用模型）</button>
          </div>
        </div>
      )}
      <ProductResearchForm onCreated={async (productId) => {
        await refresh();
        setExpandedId(productId);
        setInfo('画像草稿已生成，请检查来源证据并修正必要信息。确认前不能进入寻客。');
      }} />
      <JobLogPanel jobId={jobId} />
      {products.length === 0 && !busy && <p className="sl-empty">还没有产品：贴上链接即可自动识别，无需填写问卷。</p>}
      {products.map((p) => {
        const name = p.profile.name.value ?? p.source?.productName ?? p.source?.targetProduct ?? p.source?.account ?? (p.inputUrl || '未命名产品');
        const confirmed = isProductConfirmed(p);
        const sourceLabel = p.source?.kind === 'document' ? '商家文档'
          : p.source?.kind === 'xhs_product' ? '小红书产品名研究'
          : p.source?.kind === 'xhs_account' ? '小红书商家账号研究' : '官网';
        return (
          <div key={p.id} className="sl-card sl-product-card" data-selected={selectedId === p.id} data-confirmation={confirmed ? 'confirmed' : 'draft'}>
            <div className="sl-product-heading">
              <label className="sl-product-select">
                <input
                  type="radio" name="selectedProduct" checked={selectedId === p.id && confirmed}
                  disabled={!confirmed}
                  onChange={() => void select(p.id)}
                />
                <span className="sl-product-avatar" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
                <span className="sl-product-name"><b>{name}</b><small>{sourceLabel} · 画像 v{p.profileVersion} · {p.updatedAt.slice(5, 10)}{p.inputUrl ? ` · ${hostOf(p.inputUrl)}` : ''}</small></span>
              </label>
              {confirmed
                ? selectedId === p.id && <span className="sl-badge sl-badge--selected">当前产品</span>
                : <span className="sl-badge">待确认画像</span>}
            </div>
            <div className="sl-product-tools sl-actions">
              <button aria-expanded={expandedId === p.id} onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                {expandedId === p.id ? '收起' : '查看画像'}
              </button>
              <button className="sl-button--danger" onClick={() => void remove(p)}>删除</button>
            </div>
            {expandedId === p.id && (
              <>
                <ProfileView product={p} />
                {!confirmed && (
                  <>
                    <DraftProfileEditor product={p} onSaved={async () => { await refresh(); setInfo('修改已保存。请再次核对画像后确认。'); }} />
                    <button className="sl-button--primary" type="button" onClick={() => void confirmDraft(p)}>确认画像并用于寻客</button>
                  </>
                )}
                <p className="sl-page-footnote">
                  来源：{sourceLabel}{p.source?.fileName ? ` · ${p.source.fileName}` : ''}{p.finalUrl ? ` · ${p.finalUrl}` : ''}（{p.sourceBlocks.length} 个证据块，读取于 {p.updatedAt.slice(0, 10)}）
                </p>
                {p.sourceBlocks.map(block => (
                  <details key={block.id} className="sl-stack">
                    <summary>{block.title ?? block.id}{block.url ? ` · ${block.url}` : ''}</summary>
                    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{block.text.slice(0, 1800)}{block.text.length > 1800 ? '…（内容已截断显示）' : ''}</p>
                  </details>
                ))}
              </>
            )}
          </div>
        );
      })}
      {products.length > 0 && (
        <details className="sl-history sl-stack">
          <summary>历史记录（最近 5 条）</summary>
          {[...products]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 5)
            .map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                <button onClick={() => void reuse(p)} style={{ flex: 1, textAlign: 'left' }}>
                  {selectedId === p.id ? '● ' : '○ '}
                  {p.profile.name.value ?? hostOf(p.inputUrl)}（画像 v{p.profileVersion}）
                </button>
                <span style={{ color: '#999' }}>{p.updatedAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
            ))}
          <p style={{ color: '#888', margin: 0, fontSize: 11 }}>
            点记录即选为当前产品（不花费用）；画像保存在本机 IndexedDB，删除产品才会清除。
          </p>
        </details>
      )}
    </div>
  );
}
