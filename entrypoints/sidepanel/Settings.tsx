import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  PROVIDER_PRESETS, clearCredential, loadCredential, resolveBaseUrl, saveCredential, type PresetId,
} from '../../src/storage/credentials';
import { requestProviderOrigin } from '../../src/messaging/handlers';
import { getDb } from '../../src/storage/db';
import {
  RETENTION_CHOICES, ensureDailyRetention, getRetentionDays, hasActiveJobs, purgeExpired,
} from '../../src/storage/retention';
import { estimateCny, summarizeUsage, type PriceConfig } from '../../src/ui/logic';
import { isLogPanelEnabled, setLogPanelEnabled } from '../../src/ui/joblog';
import { ui } from '../../src/ui/store';

const PRICE_KEY = 'pricing.config';

async function loadPrice(): Promise<PriceConfig | null> {
  const r = await browser.storage.local.get(PRICE_KEY);
  return (r[PRICE_KEY] as PriceConfig | undefined) ?? null;
}

function RetentionSection() {
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState('');

  useEffect(() => { void getRetentionDays().then(setDays); }, []);

  const save = async (d: number) => {
    setDays(d);
    await browser.storage.local.set({ 'retention.days': d });
    setMsg(`保留期已设为 ${d} 天（启动与每日首次使用时自动清理）`);
  };

  const runNow = async () => {
    if (await hasActiveJobs(getDb())) {
      setMsg('存在进行中的任务：请先取消或等待其完成，再清理');
      return;
    }
    if (!window.confirm(`立即删除超过 ${days} 天的笔记快照、评论、分析结果与任务记录？已处理标记会保留。`)) {
      setMsg('已取消，未改动任何数据');
      return;
    }
    const stats = await purgeExpired(getDb(), Date.now(), days);
    setMsg(`清理完成：笔记 ${stats.notes}、评论 ${stats.comments}、分析 ${stats.analyses}、纠正 ${stats.feedback}、任务 ${stats.jobs}`);
  };

  return (
    <section className="sl-card" style={{ display: 'grid', gap: 6 }}>
      <h2 style={{ fontSize: 14, margin: 0 }}>数据保留期</h2>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={days} onChange={(e) => void save(Number(e.target.value))}>
          {RETENTION_CHOICES.map((d) => <option key={d} value={d}>{d} 天</option>)}
        </select>
        <button onClick={() => void runNow()}>立即清理</button>
      </div>
      <p style={{ color: '#888', margin: 0, fontSize: 12 }}>清理只在启动与每日首次使用自动进行；取消清理不会改动数据。</p>
      <p role="status" style={{ margin: 0, color: '#07c' }}>{msg}</p>
    </section>
  );
}

function UsageSection() {
  const [summary, setSummary] = useState(() => summarizeUsage([]));
  const [price, setPrice] = useState<PriceConfig | null>(null);
  const [inPerM, setInPerM] = useState('');
  const [outPerM, setOutPerM] = useState('');
  const [verifiedAt, setVerifiedAt] = useState('');

  const refresh = useCallback(async () => {
    setSummary(summarizeUsage(await ui.allUsage()));
    setPrice(await loadPrice());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savePrice = async () => {
    const cfg: PriceConfig | null = inPerM && outPerM && verifiedAt
      ? { inputPerMTokens: Number(inPerM), outputPerMTokens: Number(outPerM), verifiedAt }
      : null;
    if (cfg) await browser.storage.local.set({ [PRICE_KEY]: cfg });
    else await browser.storage.local.remove(PRICE_KEY);
    setPrice(cfg);
  };

  const cny = estimateCny(summary, price);
  return (
    <section className="sl-card" style={{ display: 'grid', gap: 6 }}>
      <h2 style={{ fontSize: 14, margin: 0 }}>模型用量（本机累计）</h2>
      <p style={{ margin: 0 }}>
        调用 {summary.calls} 次：成功 {summary.success}、失败 {summary.failed}、结果未知 {summary.unknown}。
        {summary.inputTokens === null
          ? ' Token 用量：供应商未回报，明确未知（不以字符数冒充）。'
          : ` Token：输入 ${summary.inputTokens}、输出 ${summary.outputTokens}。`}
        {cny !== null && ` 估价 ¥${cny}（按下方已核验单价）。`}
        {cny === null && ' 未配置核验单价前不给出费用估算。'}
      </p>
      <p style={{ color: '#b60', margin: 0, fontSize: 12 }}>注意：失败或被取消的调用可能已经计费（状态为未知的行即此类情况）。</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input value={inPerM} placeholder="输入 ¥/百万token" onChange={(e) => setInPerM(e.target.value)} style={{ width: 130 }} />
        <input value={outPerM} placeholder="输出 ¥/百万token" onChange={(e) => setOutPerM(e.target.value)} style={{ width: 130 }} />
        <input value={verifiedAt} placeholder="单价核验日期 YYYY-MM-DD" onChange={(e) => setVerifiedAt(e.target.value)} style={{ width: 160 }} />
        <button onClick={() => void savePrice()}>保存单价</button>
      </div>
      {price && <p style={{ color: '#888', margin: 0, fontSize: 12 }}>当前核验：输入 {price.inputPerMTokens} / 输出 {price.outputPerMTokens} ¥/百万token（{price.verifiedAt}）</p>}
    </section>
  );
}

export default function Settings() {
  const [presetId] = useState<PresetId>('bailian');
  const [model, setModel] = useState(PROVIDER_PRESETS[presetId].defaultModel);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[presetId].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [logPanel, setLogPanel] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void isLogPanelEnabled().then(setLogPanel);
    loadCredential().then((cred) => {
      if (cred) {
        setModel(cred.model);
        setBaseUrl(resolveBaseUrl(cred));
        setRemember(cred.remember);
        setApiKey(cred.apiKey);
        setStatus(`已加载 Key（${cred.remember ? '本地记住' : '仅本会话'}）`);
      }
    });
  }, []);

  return (
    <div className="sl-page sl-settings-page" style={{ display: 'grid', gap: 16, fontSize: 13 }}>
      <h2>设置</h2>
      <section className="sl-card" style={{ display: 'grid', gap: 8 }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>模型与 Key</h2>
        <p style={{ margin: 0 }}>{PROVIDER_PRESETS[presetId].label}</p>
        <label>
          Base URL
          <select value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={{ width: '100%' }}>
            {PROVIDER_PRESETS[presetId].endpoints.map((ep) => (
              <option key={ep.baseUrl} value={ep.baseUrl}>{ep.label}：{ep.baseUrl}</option>
            ))}
          </select>
        </label>
        <label>
          模型名称
          <input value={model} onChange={(e) => setModel(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          API Key
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          在此浏览器记住 Key（不勾选则仅当前会话有效）
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox" checked={logPanel}
            onChange={(e) => { setLogPanel(e.target.checked); void setLogPanelEnabled(e.target.checked); }}
          />
          在产品页与当前笔记页显示任务日志框（默认关闭；只记录步骤、进度与错误码，不含评论正文和 Key）
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="sl-button--primary"
            onClick={async () => {
              if (!apiKey.trim()) { setStatus('请先输入 Key'); return; }
              try {
                await saveCredential({ presetId, apiKey: apiKey.trim(), model: model.trim(), remember, baseUrl });
                setStatus(`已保存（${remember ? 'storage.local' : 'storage.session'}）`);
              } catch (err) {
                setStatus(`保存失败：${err instanceof Error ? err.message.slice(0, 200) : '未知错误'}`);
              }
            }}
          >
            保存
          </button>
          <button
            onClick={async () => {
              try {
                await clearCredential();
                setApiKey('');
                setStatus('已清除 Key（仅影响 Key，不触碰业务数据）');
              } catch (err) {
                setStatus(`清除失败：${err instanceof Error ? err.message.slice(0, 200) : '未知错误'}`);
              }
            }}
          >
            清除 Key
          </button>
          <button onClick={async () => {
            const ok = await requestProviderOrigin(presetId);
            setStatus(ok ? '已授权供应商域名' : '授权被拒绝：分析将无法发起 API 请求');
          }}>
            授权模型域名
          </button>
          <button
            onClick={async () => {
              setStatus('测试中…');
              const cred = await loadCredential();
              if (!cred?.apiKey.trim()) { setStatus('连接测试失败：尚未配置 API Key'); return; }
              try {
                const res = await fetch(`${resolveBaseUrl(cred)}/chat/completions`, {
                  method: 'POST', credentials: 'omit',
                  headers: { 'content-type': 'application/json', authorization: `Bearer ${cred.apiKey.trim()}` },
                  body: JSON.stringify({ model: cred.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
                });
                setStatus(res.ok
                  ? '连接测试成功：模型端点可达'
                  : `连接测试失败：HTTP ${res.status}（401/403 多为 Key 无效）`);
              } catch (err) {
                setStatus(`连接测试失败：${err instanceof Error ? err.message : '网络或域名未授权'}`);
              }
            }}
          >
            连接测试
          </button>
        </div>
        <p role="status" style={{ margin: 0 }}>{status}</p>
        <p style={{ color: '#888', margin: 0 }}>Key 绝不进入同步存储、数据库、导出文件或日志。</p>
      </section>

      <RetentionSection />
      <UsageSection />

      <section style={{ display: 'grid', gap: 6 }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>业务数据</h2>
        <button
          onClick={async () => {
            if (!window.confirm('删除全部产品、笔记快照、评论、线索、纠正与任务记录？不可撤销（不影响 API Key）。')) return;
            if (await hasActiveJobs(getDb())) { setStatus('存在进行中的任务：请先取消'); return; }
            await ui.clearAllBusinessData();
            await ensureDailyRetention(getDb()).catch(() => {});
            setStatus('已删除全部业务数据（Key 未动）');
          }}
        >
          清除全部业务数据
        </button>
        <p style={{ color: '#888', margin: 0, fontSize: 12 }}>“清除 Key”只删凭据；“清除业务数据”只删本地数据，两者互不影响。</p>
      </section>
    </div>
  );
}
