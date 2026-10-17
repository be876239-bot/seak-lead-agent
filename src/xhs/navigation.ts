import { AppError } from '../domain/errors';
import { noteKeyFromUrl, noteUrl, platformBlock, visible } from './discovery-dom';

export function sameSearch(actual:string,expected:string):boolean {
  try {const a=new URL(actual),b=new URL(expected);a.hash='';b.hash='';return a.origin==='https://www.xiaohongshu.com' && a.pathname==='/search_result' && a.href===b.href;}catch{return false;}
}
export function searchState(doc:Document) {
  const block=platformBlock(doc);if(block)throw new AppError('PAGE_BLOCKED',block);
  const url=new URL(doc.URL);const root=doc.querySelector('#noteContainer');
  return {sourceUrl:doc.URL,isSearch:url.origin==='https://www.xiaohongshu.com'&&url.pathname==='/search_result',hasNote:!!root&&visible(root)};
}
/** Historical real fixture: note-detail-mask > close-circle > close.
 * Only dismiss the currently identified note; never select generic cancel/social buttons. */
export function closeNote(doc:Document,expectedNoteKey:string) {
  const block=platformBlock(doc);if(block)throw new AppError('PAGE_BLOCKED',block);
  if(!noteUrl(doc.URL)||noteKeyFromUrl(doc.URL)!==expectedNoteKey)throw new AppError('PAGE_CHANGED','关闭入口与当前任务笔记不一致');
  const roots=[...doc.querySelectorAll('#noteContainer')].filter(visible);
  const mask=roots.length===1?roots[0]!.closest('.note-detail-mask'):null;
  const circle=mask?[...mask.children].find(el=>el.classList.contains('close-circle')&&visible(el)):null;
  const control=circle?[...circle.children].find(el=>el.classList.contains('close')&&visible(el)):null;
  if(!(control instanceof doc.defaultView!.HTMLElement) || control.closest('form,.interactions,.engage-bar') || control.hasAttribute('disabled') || control.getAttribute('aria-disabled')==='true')throw new AppError('PAGE_UNSUPPORTED','当前笔记没有可确认的关闭入口；请手动返回原搜索页后继续');
  control.click();return {clicked:true,noteKey:expectedNoteKey};
}
/** 重新定位当前真实卡片。不改href/target，不写history/location，不构造导航URL。 */
export function clickSearchNote(doc:Document,expectedSearchUrl:string,expectedNoteKey:string) {
  const state=searchState(doc);
  if(!sameSearch(state.sourceUrl,expectedSearchUrl)||state.hasNote)throw new AppError('PAGE_CHANGED','搜索页上下文已变化，请返回原搜索结果后手动继续');
  const candidates=[...doc.querySelectorAll<HTMLAnchorElement>('section.note-item a[href]')].filter(a=>{
    const href=noteUrl(a.getAttribute('href')??'',doc.URL);
    return href && noteKeyFromUrl(href)===expectedNoteKey && visible(a) && !a.closest('.interactions,form');
  });
  const anchor=candidates.find(a=>a.classList.contains('cover'))??candidates[0];
  if(!anchor)throw new AppError('PAGE_CHANGED','候选帖子当前不在已加载搜索DOM中；队列保留，请正常加载原结果后继续');
  const target=anchor.getAttribute('target')??doc.querySelector('base[target]')?.getAttribute('target')??'';
  if((target && target!=='_self') || anchor.hasAttribute('download'))throw new AppError('PAGE_UNSUPPORTED','帖子入口要求其他窗口或下载，已暂停；不会改写链接或强制跳URL');
  anchor.scrollIntoView?.({block:'center',behavior:'instant'});
  const currentHref=noteUrl(anchor.getAttribute('href')??'',doc.URL);
  const blocked=platformBlock(doc);if(blocked)throw new AppError('PAGE_BLOCKED',blocked);
  if(!anchor.isConnected || !sameSearch(doc.URL,expectedSearchUrl) || !currentHref || noteKeyFromUrl(currentHref)!==expectedNoteKey)throw new AppError('PAGE_CHANGED','卡片滚动后发生重渲染，请检查搜索结果后继续');
  anchor.click();
  const after=platformBlock(doc);if(after)throw new AppError('PAGE_BLOCKED',after);
  return {clicked:true,noteKey:expectedNoteKey};
}
