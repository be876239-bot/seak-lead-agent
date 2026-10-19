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
    <div className="sl-profile" style={{ display: 'grid', gap: 6, fontSize: 12 }}>
      {unknowns.includes('类别') && (
        <p style={{ background: '#fff7e6', border: '1px solid #ffd591', padding: 6, margin: 0 }}>
          类别未知：画像完整度较低。可以照常分析评论，但不会根据猜测补充结论。
        </p>
      )}
      {CLAIM_ROWS.map(({ key, label }) => {
        const claim = product.profile[key];
        return (
          <div key={key}>
            <b>{label}</b>
            <span style={{ marginLeft: 6, color: claim.status === 'unknown' ? '#999' : '#333' }}>
              [{STATUS_LABELS[claim.status]}]
            </span>
            <span style={{ marginLeft: 6 }}>{claim.value ?? '未知（不阻塞其他信息）'}</span>
            {claim.evidence.length > 0 && (
              <ul style={{ margin: '2px 0', paddingLeft: 18 }}>
                {claim.evidence.map((e, i) => (
                  <li key={i} style={{ color: '#777' }}>依据 {e.sourceId}：{e.quote}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {LIST_ROWS.map(({ key, label }) => {
        const items = product.profile[key];
        if (!items.length) return null;
        return (
          <div key={key}>
            <b>{label}</b>
            <ul style={{ margin: '2px 0', paddingLeft: 18 }}>
              {items.map((c, i) => (
                <li key={i}>[{STATUS_LABELS[c.status]}] {c.value}
                  {c.evidence.length > 0 && <span style={{ color: '#777' }}>（依据 {c.evidence[0]!.sourceId}：{c.evidence[0]!.quote}）</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {product.profile.searchSuggestions.length > 0 && (
        <section style={{ display: 'grid', gap: 5, borderTop: '1px solid #eee', paddingTop: 6 }}>
          <b>建议搜索关键词</b>
          <p style={{ margin: 0, color: '#666' }}>选择一个关键词复制，再粘贴到小红书搜索框并点击搜索。关键词只是建议，可按实际需要修改。</p>
          {product.profile.searchSuggestions.map((suggestion, index) => (
            <div key={`${index}:${suggestion}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{suggestion}</span>
              <button type="button" onClick={() => void copySuggestion(suggestion, index)}>
                {copiedIndex === index ? '已复制' : '复制关键词'}
              </button>
            </div>
          ))}
          {copyFeedback && (
            <p role={copyFeedback.error ? 'alert' : 'status'} style={{ margin: 0, color: copyFeedback.error ? '#b42318' : '#067647' }}>
              {copyFeedback.text}
            </p>
          )}
        </section>
      )}
    </div>
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
          setError(res.job.errorCode ? `任务${jobPhaseLabel(res.job)}（${res.job.errorCode}）` : null);
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
    setSelectedId(id);
    await setSelectedProductId(id);
  };

  const remove = async (p: Product) => {
    const label = p.profile.name.value ?? p.inputUrl;
    if (!window.confirm(`删除产品「${label}」及其全部线索、纠正与处理状态？不可撤销。`)) return;
    await ui.deleteProduct(p.id);
    if (selectedId === p.id) {
      setSelectedId(null);
      await setSelectedProductId(null);
    }
    await refresh();
  };

  const reuse = async (p: Product) => {
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
    <div className="sl-page sl-products-page" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <h2>产品</h2>
      <div className="sl-product-create" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <input
          data-onboarding-target="product-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴产品官网链接（公网 http/https）"
          style={{ flex: 1 }}
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
        <div className="sl-notice sl-notice--info sl-product-match" style={{ fontSize: 12 }}>
          这个链接已识别过：{match.profile.name.value ?? hostOf(match.inputUrl)}（画像 v{match.profileVersion}，{match.updatedAt.slice(0, 16).replace('T', ' ')} 更新）。
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={() => void reuse(match)}>直接复用（不调用模型）</button>
            <button onClick={() => void start(match.id)}>重新识别（更新同一产品，会调用模型）</button>
          </div>
        </div>
      )}
      <JobLogPanel jobId={jobId} />
      {products.length === 0 && !busy && <p style={{ color: '#777' }}>还没有产品：贴上链接即可自动识别，无需填写问卷。</p>}
      {products.map((p) => {
        const name = p.profile.name.value ?? p.inputUrl;
        return (
          <div key={p.id} className="sl-card sl-product-card" style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}>
                <input
                  type="radio" name="selectedProduct" checked={selectedId === p.id}
                  onChange={() => void select(p.id)}
                />
                <b>{name}</b>
              </label>
              <span style={{ color: '#999' }}>画像 v{p.profileVersion}</span>
              <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                {expandedId === p.id ? '收起' : '查看画像'}
              </button>
              <button onClick={() => void remove(p)}>删除</button>
            </div>
            {expandedId === p.id && (
              <>
                <ProfileView product={p} />
                <p style={{ color: '#999', margin: '4px 0 0' }}>
                  来源：{p.finalUrl}（{p.sourceBlocks.length} 个来源块，读取于 {p.updatedAt.slice(0, 10)}）
                </p>
              </>
            )}
          </div>
        );
      })}
      {products.length > 0 && (
        <section className="sl-history" style={{ display: 'grid', gap: 4, borderTop: '1px solid #eee', paddingTop: 8 }}>
          <b style={{ fontSize: 12 }}>历史记录（最近 5 条）</b>
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
        </section>
      )}
    </div>
  );
}
