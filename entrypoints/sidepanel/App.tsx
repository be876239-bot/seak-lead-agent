import { useEffect, useState } from 'react';
import {
  PROVIDER_PRESETS, clearCredential, loadCredential, saveCredential, type PresetId,
} from '../../src/storage/credentials';
import { requestProviderOrigin } from '../../src/messaging/handlers';

type Tab = 'products' | 'note' | 'leads' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'products', label: '产品' },
  { id: 'note', label: '当前笔记' },
  { id: 'leads', label: '线索' },
  { id: 'settings', label: '设置' },
];

function Settings() {
  const [presetId] = useState<PresetId>('bailian');
  const [model, setModel] = useState(PROVIDER_PRESETS[presetId].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadCredential().then((cred) => {
      if (cred) {
        setModel(cred.model);
        setRemember(cred.remember);
        setApiKey(cred.apiKey);
        setStatus(`已加载 Key（${cred.remember ? '本地记住' : '仅本会话'}）`);
      }
    });
  }, []);

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <p>{PROVIDER_PRESETS[presetId].label}</p>
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
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={async () => {
            if (!apiKey.trim()) { setStatus('请先输入 Key'); return; }
            await saveCredential({ presetId, apiKey: apiKey.trim(), model: model.trim(), remember });
            setStatus(`已保存（${remember ? 'storage.local' : 'storage.session'}）`);
          }}
        >
          保存
        </button>
        <button
          onClick={async () => {
            await clearCredential();
            setApiKey('');
            setStatus('已清除 Key');
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
      </div>
      <p role="status">{status}</p>
      <p style={{ color: '#888' }}>Key 绝不进入同步存储、数据库、导出文件或日志。</p>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('products');
  const version = browser.runtime.getManifest().version;
  return (
    <div style={{ padding: 12, fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
      <h1 style={{ fontSize: 16, margin: '4px 0 10px' }}>觅客Agent <span style={{ color: '#999', fontWeight: 400 }}>v{version}</span></h1>
      <nav style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ fontWeight: tab === t.id ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'settings'
        ? <Settings />
        : <p style={{ color: '#777' }}>{TABS.find((t) => t.id === tab)?.label}：功能开发中（见 TODO.md）。</p>}
    </div>
  );
}
