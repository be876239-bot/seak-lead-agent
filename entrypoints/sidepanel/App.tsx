import Discovery from './Discovery';
import { useState } from 'react';
import Products from './Products';
import CurrentNote from './CurrentNote';
import Leads from './Leads';
import Settings from './Settings';

type Tab = 'discovery' | 'products' | 'note' | 'leads' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'products', label: '产品' },
  { id: 'discovery', label: '寻找客户' },
  { id: 'note', label: '当前笔记' },
  { id: 'leads', label: '线索' },
  { id: 'settings', label: '设置' },
];

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
      {tab === 'discovery' && <Discovery />}
      {tab === 'settings' && <Settings />}
      {tab === 'products' && <Products />}
      {tab === 'note' && <CurrentNote />}
      {tab === 'leads' && <Leads />}
    </div>
  );
}
