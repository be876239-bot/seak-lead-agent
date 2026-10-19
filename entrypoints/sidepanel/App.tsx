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
    <div className="sl-app">
      <header className="sl-header">
        <h1 className="sl-brand">觅客 Agent <span className="sl-version">v{version}</span></h1>
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
        {tab === 'discovery' && <Discovery />}
        {tab === 'settings' && <Settings />}
        {tab === 'products' && <Products />}
        {tab === 'note' && <CurrentNote />}
        {tab === 'leads' && <Leads />}
      </main>
    </div>
  );
}
