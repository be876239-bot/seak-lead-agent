import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../entrypoints/sidepanel/App';
import { getDb } from '../../src/storage/db';
import { uiProduct, uiNotes, uiComments, uiAnalyses, uiJob } from '../fixtures/ui/sidepanel';
import type { Job } from '../../src/domain/schemas';
const scenario = vi.hoisted(() => ({ populated: false, job: null as Job | null, actions: [] as string[], guideDismissed: false }));

vi.mock('wxt/browser', () => {
  const area = { get: vi.fn(async (key: string | string[]) => {
    const values: Record<string, unknown> = {
      'onboarding.dismissed': scenario.guideDismissed,
      ...(scenario.populated ? {'ui.selectedProductId': '11111111-1111-4111-8111-111111111111','discovery.lastJobId': scenario.job?.id} : {}),
    };
    return Array.isArray(key) ? Object.fromEntries(key.map(k=>[k,values[k]])) : {[key]:values[key]};
  }), set: vi.fn(async (items: Record<string, unknown>) => {
    if ('onboarding.dismissed' in items) scenario.guideDismissed = items['onboarding.dismissed'] === true;
  }), remove: vi.fn(async (key: string | string[]) => {
    if (Array.isArray(key) ? key.includes('onboarding.dismissed') : key === 'onboarding.dismissed') scenario.guideDismissed = false;
  }) };
  return { browser: {
    storage: { local: area, session: area, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    permissions: { contains: vi.fn(async () => false) },
    runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, sendMessage: vi.fn(async (message: {requestId: string; type: string; payload: {action: string}}) => {
      if (message.type==='DISCOVERY_CONTROL' && scenario.job?.discovery) {
        scenario.actions.push(message.payload.action);
        scenario.job.discovery.status=message.payload.action==='pause'?'paused':message.payload.action==='continue'?'running':'stopped';
      }
      return {requestId:message.requestId,ok:true,data:{job:structuredClone(scenario.job)}};
    }) },
  } };
});
let root: Root;
let host: HTMLDivElement;
const buttons = () => [...host.querySelectorAll('button')];
async function click(label: string) {
  const button = buttons().find(b => b.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => { button!.click(); });
}
beforeEach(async () => {
  scenario.populated=false; scenario.job=null; scenario.actions=[]; scenario.guideDismissed=false;
  await Promise.all(getDb().tables.map(table=>table.clear()));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(App)); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('keeps four real page destinations and onboarding controls without a standalone note mode', async () => {
  expect([...host.querySelectorAll('nav button')].map(b => b.textContent)).toEqual(['产品','寻找客户','线索','设置']);
  expect(host.querySelector('[data-onboarding-target="product-url"]')).not.toBeNull();
  await click('寻找客户');
  expect(host.querySelector('[data-onboarding-target="search-keyword"]')).not.toBeNull();
  expect(host.querySelector('[data-onboarding-target="discovery-start"]')).not.toBeNull();
  await click('线索');
  expect(host.querySelector('[data-onboarding-target="lead-list"]')).not.toBeNull();
  await click('设置');
  expect(host.querySelector('[data-onboarding-target="model-save"]')).not.toBeNull();
  expect(host.querySelector('input[type="password"]')).not.toBeNull();
});
it('keeps invalid post counts visible and prevents starting an unconfirmed search', async () => {
  await click('寻找客户');
  const input = host.querySelector<HTMLInputElement>('#discovery-max-posts')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '101');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(host.textContent).toContain('请输入 1 到 100 之间的整数');
  expect(host.querySelector<HTMLButtonElement>('[data-onboarding-target="discovery-start"]')!.disabled).toBe(true);
});
it('shows the existing configuration error when saving without a key', async () => {
  await click('设置'); await click('保存');
  expect(host.querySelector('[role="status"]')?.textContent).toBe('请先输入 Key');
});

async function populate(job: Job | null = null) {
  scenario.populated=true; scenario.job=job;
  await getDb().products.put(uiProduct);
  await getDb().notes.bulkPut(uiNotes);
  await getDb().comments.bulkPut(uiComments);
  await getDb().analyses.bulkPut(uiAnalyses);
  await act(async()=>root.unmount());
  root=createRoot(host);
  await act(async()=>{root.render(createElement(App));});
}
async function until(check:()=>boolean) {
  for(let i=0;i<40&&!check();i++) await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  expect(check()).toBe(true);
}
it('lets the user dismiss onboarding and reopen it from the header', async()=>{
  expect(host.querySelector('.sl-onboarding')).not.toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="关闭新手引导"]')!.click());
  await until(()=>scenario.guideDismissed && host.querySelector('.sl-onboarding')===null);

  await act(async()=>{
    await root.unmount();
    root=createRoot(host);
    root.render(createElement(App));
  });
  await until(()=>host.querySelector('nav')!==null);
  expect(host.querySelector('.sl-onboarding')).toBeNull();

  await click('新手引导');
  await until(()=>host.querySelector('.sl-onboarding--active')!==null);
  expect(scenario.guideDismissed).toBe(false);
});
it('closes an active guide without losing progress and allows it to resume', async()=>{
  await click('开始快速上手');
  await until(()=>host.querySelector('.sl-onboarding--active')!==null);
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="关闭新手引导"]')!.click());
  await until(()=>scenario.guideDismissed && host.querySelector('.sl-onboarding')===null);

  await click('新手引导');
  await until(()=>host.querySelector('.sl-onboarding--active')!==null);
  expect(scenario.guideDismissed).toBe(false);
});
it('collapses secondary product information by default and preserves profile keyword copy', async()=>{
  await populate(); await until(()=>host.textContent?.includes(uiProduct.profile.name.value!)===true);
  expect(host.querySelector('details.sl-product-research')?.hasAttribute('open')).toBe(false);
  expect(host.querySelector('details.sl-history')?.hasAttribute('open')).toBe(false);
  await click('查看画像');
  expect(host.querySelector('details.sl-keywords')?.hasAttribute('open')).toBe(false);
  expect(host.textContent).toContain('AI 演示文稿工具');
  expect(host.textContent).toContain('未知（不阻塞其他信息）');
  const writeText=vi.fn(async()=>{});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  await act(async()=>host.querySelector<HTMLDetailsElement>('details.sl-keywords > summary')!.click());
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="复制关键词：AI PPT"]')!.click());
  expect(writeText).toHaveBeenCalledWith('AI PPT');
  expect(host.textContent).toContain('已复制“AI PPT”');
});
it('collapses lead cards by default while preserving evidence, filtering and correction controls', async()=>{
  await populate(); await click('线索'); await until(()=>host.querySelectorAll('.sl-lead-card').length===2);
  expect(host.querySelector('details.sl-lead-card')?.hasAttribute('open')).toBe(false);
  expect(host.textContent).toContain(uiComments[1]!.text);
  expect(host.textContent).toContain('不确定：预算和采购时间尚未确认');
  const select=host.querySelector<HTMLSelectElement>('[aria-label="筛选意向分组"]')!;
  await act(async()=>{select.value='high_intent';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(host.querySelectorAll('.sl-lead-card')).toHaveLength(1);
  expect(buttons().filter(b=>b.textContent?.startsWith('导出')).every(b=>!b.disabled)).toBe(true);
  await act(async()=>host.querySelector<HTMLDetailsElement>('details.sl-lead-card > summary')!.click());
  await click('修改分组/备注');
  expect(buttons().some(b=>b.textContent==='保存纠正')).toBe(true);
  await click('取消');
  expect(await getDb().comments.count()).toBe(3);
  expect(await getDb().analyses.count()).toBe(2);
});
it('renders saved batch progress honestly and keeps pause/continue/stop navigation intents', async()=>{
  await populate(structuredClone(uiJob)); await click('寻找客户');
  await until(()=>host.querySelector('.sl-task-card')!==null);
  expect(host.querySelector('details.sl-task-more')?.hasAttribute('open')).toBe(false);
  expect(host.querySelector('details.sl-help-disclosure')?.hasAttribute('open')).toBe(false);
  const progress=host.querySelector('progress')!;
  expect(progress.value).toBe(1);expect(progress.max).toBe(2);
  expect(host.textContent).toContain('部分采集帖子：1 篇');
  expect(host.textContent).toContain('已保留评论，但因采集不完整而跳过 AI 分析');
  await click('暂停');await until(()=>host.textContent?.includes('任务已暂停')===true);
  await click('继续上次任务（先检查小红书页面）');await until(()=>host.textContent?.includes('SeekLead 正在寻找客户')===true);
  await click('停止任务');await until(()=>host.textContent?.includes('任务已停止')===true);
  expect(scenario.actions).toEqual(['pause','continue','stop']);
  expect(scenario.job!.discovery!.index).toBe(1);
});
