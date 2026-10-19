// @vitest-environment-options {"url":"https://www.xiaohongshu.com/search_result?keyword=AI"}
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {buildRequest,ResponseSchema} from '../../src/messaging/protocol';
const bridge=vi.hoisted(()=>({addListener:vi.fn()}));
vi.mock('wxt/browser',()=>({browser:{runtime:{id:'seeklead-test',onMessage:{addListener:bridge.addListener}}}}));
type Listener=(raw:unknown,sender:{id:string},respond:(raw:unknown)=>void)=>true|undefined;
let listener:Listener;let scroller:HTMLElement;
beforeEach(async()=>{
 vi.resetModules();bridge.addListener.mockReset();
 vi.stubGlobal('defineContentScript',(config:unknown)=>config);
 document.body.innerHTML='<div id="results" style="overflow-y:auto"><section class="note-item"><a class="cover" href="/explore/aaaaaaaaaaaaaaaaaaaaaaaa">笔记</a></section></div>';
 scroller=document.querySelector('#results')!;Object.defineProperties(scroller,{clientHeight:{value:500},scrollHeight:{value:2000}});
 const script=await import('../../entrypoints/xhs.content');(script.default as unknown as {main:()=>void}).main();
 listener=bridge.addListener.mock.calls[0]![0] as Listener;
});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();});
function request(direction:'down'|'top'='down',url=location.href){return buildRequest('XHS_SCROLL_SEARCH',{expectedSearchUrl:url,direction});}
it.each(['down','top'] as const)('实际入口处理搜索滚动%s并返回合法响应',async direction=>{
 scroller.scrollTop=direction==='top'?500:0;const req=request(direction);
 const raw=await new Promise<unknown>(resolve=>{expect(listener(req,{id:'seeklead-test'},resolve)).toBe(true);});
 const response=ResponseSchema.parse(raw);expect(response.requestId).toBe(req.requestId);expect(response.ok).toBe(true);
 expect(response.data).toMatchObject({scrollable:true,moved:true});expect(scroller.scrollTop).toBe(direction==='top'?0:166);
});
it.each(['wrong-page','verification'] as const)('实际入口在%s时返回合法错误并禁止滚动',async mode=>{
 if(mode==='verification')document.body.insertAdjacentHTML('beforeend','<div class="login-container">登录验证</div>');
 const req=request('down',mode==='wrong-page'?'https://www.xiaohongshu.com/search_result?keyword=other':location.href);
 const raw=await new Promise<unknown>(resolve=>{expect(listener(req,{id:'seeklead-test'},resolve)).toBe(true);});
 const response=ResponseSchema.parse(raw);expect(response.ok).toBe(false);expect(response.error?.code).toBe(mode==='verification'?'PAGE_BLOCKED':'PAGE_CHANGED');expect(scroller.scrollTop).toBe(0);
});
it.each(['foreign-sender','invalid-payload','unrelated'] as const)('入口仍拒绝%s',mode=>{
 const valid=request();const raw=mode==='invalid-payload'?{...valid,payload:{...valid.payload,direction:'invalid'}}:mode==='unrelated'?buildRequest('JOB_GET',{jobId:crypto.randomUUID()}):valid;
 const respond=vi.fn();expect(listener(raw,{id:mode==='foreign-sender'?'foreign':'seeklead-test'},respond)).toBeUndefined();expect(respond).not.toHaveBeenCalled();expect(scroller.scrollTop).toBe(0);
});
