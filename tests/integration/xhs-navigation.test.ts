// @vitest-environment-options {"url":"https://www.xiaohongshu.com/search_result?keyword=AI"}
import{readFileSync}from'node:fs';
import{beforeEach,it,expect,vi}from'vitest';
import{clickSearchNote,closeNote,searchState,scrollSearchResults}from'../../src/xhs/navigation';
import{platformBlock}from'../../src/xhs/discovery-dom';
const source='https://www.xiaohongshu.com/search_result?keyword=AI';const id='a'.repeat(24);const key='xhs:'+id;
beforeEach(()=>{history.replaceState({},'','/search_result?keyword=AI');document.body.innerHTML=`<section class="note-item"><a class="cover mask ld" href="/explore/${id}?source=current">公开笔记</a><a href="/user/profile/synthetic">作者</a></section>`;});
it('clicks current real card anchor, preserving its href and existing routing handler',()=>{const anchor=document.querySelector<HTMLAnchorElement>('a.cover')!;const click=vi.fn((e:Event)=>e.preventDefault());anchor.addEventListener('click',click);const result=clickSearchNote(document,source,key);expect(click).toHaveBeenCalledTimes(1);expect(anchor.getAttribute('href')).toBe(`/explore/${id}?source=current`);expect(result.noteKey).toBe(key);});
it('rerender/order changes relocate by stable note ID instead of stale index',()=>{document.querySelector('section')!.insertAdjacentHTML('afterbegin',`<a class="cover" href="/explore/${'b'.repeat(24)}">其他帖子</a>`);const hits:string[]=[];document.querySelectorAll('a').forEach(a=>a.onclick=e=>{e.preventDefault();hits.push(a.getAttribute('href')!);});clickSearchNote(document,source,key);expect(hits).toEqual([`/explore/${id}?source=current`]);});
it('missing candidate pauses rather than forcing saved URL or choosing another card',()=>{document.querySelector('a.cover')!.remove();expect(()=>clickSearchNote(document,source,key)).toThrow(/候选/);});
it.each(['_blank','other-window'])('unsupported link target %s never changes attributes or opens new tabs',target=>{const a=document.querySelector('a')!;a.setAttribute('target',target);const click=vi.fn();a.addEventListener('click',click);expect(()=>clickSearchNote(document,source,key)).toThrow();expect(click).not.toHaveBeenCalled();expect(a.getAttribute('target')).toBe(target);});
it('search context changed or note overlay open refuses another click',()=>{expect(()=>clickSearchNote(document,source+'x',key)).toThrow();document.body.insertAdjacentHTML('beforeend','<div id="noteContainer"></div>');expect(()=>clickSearchNote(document,source,key)).toThrow();});
it('historical real anonymized cards support normal anchor clicks, IDs only synthetically restored',()=>{document.body.innerHTML=readFileSync('tests/fixtures/xhs/feed-only.html','utf8').replace(/anonnote1(?=[?"/])/g,id);const click=vi.fn((e:Event)=>e.preventDefault());document.addEventListener('click',click,{once:true});clickSearchNote(document,source,key);expect(click).toHaveBeenCalledTimes(1);});
it.each(['当前笔记暂时无法浏览，请打开小红书 App 扫码查看','非法消息','你访问的页面不见了'])('platform error %s immediately blocks navigation even with feed/note DOM behind it',text=>{document.body.insertAdjacentHTML('beforeend',`<div id="noteContainer"><div>${text}</div></div>`);expect(platformBlock(document)).not.toBeNull();expect(()=>clickSearchNote(document,source,key)).toThrow();});
it('normal note/comment prose quoting an error is not classified as platform restriction',()=>{document.body.insertAdjacentHTML('beforeend','<div id="noteContainer"><div id="detail-desc"><span class="note-text">文章解释当前笔记暂时无法浏览是什么</span></div></div>');expect(platformBlock(document)).toBeNull();});
it('searchState reports original result context and overlay explicitly',()=>{expect(searchState(document)).toEqual({sourceUrl:source,isSearch:true,hasNote:false});document.body.insertAdjacentHTML('beforeend','<div id="noteContainer"></div>');expect(searchState(document).hasNote).toBe(true);});

it('historical real overlay exposes the scoped close control; no social or generic cancel clicks',()=>{
 history.replaceState({},'',`/explore/${id}`);document.body.innerHTML=readFileSync('tests/fixtures/xhs/page-overlay-with-feed.html','utf8');
 const control=document.querySelector<HTMLElement>('.note-detail-mask > .close-circle > .close')!;
 const clicked=vi.fn();control.onclick=clicked;
 const other=vi.fn();document.querySelectorAll<HTMLElement>('button,.interactions,.engage-bar').forEach(el=>el.onclick=other);
 expect(closeNote(document,key)).toEqual({clicked:true,noteKey:key});expect(clicked).toHaveBeenCalledTimes(1);expect(other).not.toHaveBeenCalled();
});
it.each(['missing','hidden','disabled','mismatch','platform'])('close safety: %s refuses any click',mode=>{
 history.replaceState({},'',`/explore/${id}`);document.body.innerHTML='<div class="note-detail-mask"><div id="noteContainer"></div><div class="close-circle"><div class="close"></div></div></div><button>取消</button>';
 const control=document.querySelector<HTMLElement>('.close')!;const clicked=vi.fn();document.body.onclick=clicked;
 if(mode==='missing')control.remove();if(mode==='hidden')control.setAttribute('hidden','');if(mode==='disabled')control.setAttribute('disabled','');if(mode==='platform')document.body.insertAdjacentHTML('afterbegin','<div role="dialog">安全验证</div>');
 expect(()=>closeNote(document,mode==='mismatch'?'xhs:'+'b'.repeat(24):key)).toThrow();expect(clicked).not.toHaveBeenCalled();document.body.onclick=null;
});

it('scrolls only the original search feed by a bounded step and can return to its top',()=>{
 document.body.innerHTML='<div id="feed" style="overflow-y:auto;height:200px"><section class="note-item"><a href="/explore/'+'a'.repeat(24)+'">card</a></section></div>';
 const feed=document.querySelector<HTMLElement>('#feed')!;
 Object.defineProperty(feed,'scrollHeight',{configurable:true,value:1200});
 Object.defineProperty(feed,'clientHeight',{configurable:true,value:200});
 expect(scrollSearchResults(document,source,'down')).toMatchObject({scrollable:true,moved:true,scrollTop:66,maxTop:1000});
 feed.scrollTop=700;
 expect(scrollSearchResults(document,source,'top')).toMatchObject({scrollable:true,moved:true,atTop:true,scrollTop:0});
});
it('never scrolls a changed search context or a note overlay',()=>{
 expect(()=>scrollSearchResults(document,source+'x','down')).toThrow();
 document.body.insertAdjacentHTML('beforeend','<div id="noteContainer"></div>');
 expect(()=>scrollSearchResults(document,source,'down')).toThrow();
});