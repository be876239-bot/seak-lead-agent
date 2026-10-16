import { browser } from 'wxt/browser';
import { Repositories } from '../storage/repositories';
import { getDb } from '../storage/db';

/** 侧边栏与后台共享同一扩展源 IndexedDB；面板只做读查询与轻量写（标记/纠正）。 */
export const ui = new Repositories(getDb());

const SELECTED_KEY = 'ui.selectedProductId';

export async function getSelectedProductId(): Promise<string | null> {
  const r = await browser.storage.local.get(SELECTED_KEY);
  return (r[SELECTED_KEY] as string | undefined) ?? null;
}

export async function setSelectedProductId(id: string | null): Promise<void> {
  if (id) await browser.storage.local.set({ [SELECTED_KEY]: id });
  else await browser.storage.local.remove(SELECTED_KEY);
}

/** 线索列表即使父评论未参与分析，也只按真实parentKey补取上下文。 */
export async function getLeadComments(keys:string[]) {
  const comments=await ui.getComments(keys);
  const present=new Set(comments.map(c=>c.commentKey));
  const parents=await ui.getComments([...new Set(comments.flatMap(c=>c.parentKey && !present.has(c.parentKey)?[c.parentKey]:[]))]);
  return [...comments,...parents.filter(p=>comments.some(c=>c.parentKey===p.commentKey && c.noteKey===p.noteKey))];
}
