// @vitest-environment-options {"url":"https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa"}
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {XhsSessionManager} from '../../src/xhs/session';
import {buildOk,buildError,RequestSchema} from '../../src/messaging/protocol';
import {toErrorPayload} from '../../src/domain/errors';
import {SeekLeadDb} from '../../src/storage/db';
import {Repositories} from '../../src/storage/repositories';
import {CommentSchema,ProductProfileSchema,type Comment,type Note,type CaptureProgress} from '../../src/domain/schemas';
import {buildClassificationInput} from '../../src/privacy/ai-payload';
import {buildCommentMessages} from '../../src/ai/prompts';
const send=vi.hoisted(()=>vi.fn());vi.mock('wxt/browser',()=>({browser:{tabs:{sendMessage:send}}}));
const {captureNote}=await import('../../src/xhs/capture');
let manager:XhsSessionManager;let db:SeekLeadDb;let repos:Repositories;let jobId:string;let clock=0;
const key='xhs:'+'a'.repeat(24);
function reply(id:string,text='公司要用，商用版怎么收费？'){return `<div class="comment-item comment-item-sub" id="comment-${id}"><div class="author"><a class="name" href="/user/profile/syntheticR">合成用户</a></div><div class="content"><span class="note-text">${text}</span></div></div>`;}
const wrapper=(id:string)=>document.querySelector(`[data-test="${id}"]`)!;
const area=(id:string)=>wrapper(id).querySelector('.reply-container')!;
const control=(id:string)=>area(id).querySelector<HTMLElement>('.show-more')!;
const wait=async()=>{clock+=500;await Promise.resolve();};
const persist=(note:Note,comments:Comment[])=>repos.saveCaptureDelta(jobId,note,comments,new AbortController().signal);
beforeEach(async()=>{
 clock=0;document.body.innerHTML=readFileSync('tests/fixtures/xhs/nested-replies.html','utf8');
 const el=document.querySelector<HTMLElement>('.note-scroller')!;Object.defineProperties(el,{clientHeight:{value:500},scrollHeight:{value:5000}});el.scrollBy=vi.fn(o=>{el.scrollTop=Math.min(el.scrollHeight-el.clientHeight,el.scrollTop+(o.top??0));});
 manager=new XhsSessionManager(()=>document,()=>clock);db=new SeekLeadDb('replies-'+crypto.randomUUID());repos=new Repositories(db);jobId=crypto.randomUUID();
 await repos.createJob({id:jobId,kind:'comments',status:'collecting',ownerId:'test',generation:0,productId:null,profileVersion:null,tabId:7,noteKey:null,provider:'mock',modelId:'mock',promptVersion:'same',totalItems:0,completedItems:0,failedItems:0,errorCode:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 send.mockReset();send.mockImplementation(async(_id,raw)=>{const req=RequestSchema.parse(raw);try{return buildOk(req.requestId,await manager.handle(req));}catch(e){return buildError(req.requestId,toErrorPayload(e));}});
});
afterEach(()=>{manager.dispose();db.close();});
it('A 快照仍只读：两个一级评论，不自动点击',async()=>{const clicks=vi.fn();document.addEventListener('click',clicks,{once:true});const snap=await captureNote(7,{onDelta:persist});expect(snap.comments).toHaveLength(2);expect(clicks).not.toHaveBeenCalled();});
it('B–F 正常展开、再展开、虚拟移除/重渲染、去重、多个父评论关系与增量落库',async()=>{
 let aClicks=0;let pending:(()=>void)|null=null;let samples=0;const states:CaptureProgress[]=[];
 area('A').addEventListener('click',e=>{if(!(e.target as Element).closest('.show-more'))return;aClicks++;samples=0;pending=()=>{if(aClicks===1){area('A').insertAdjacentHTML('afterbegin',reply('A1'));control('A').textContent='展开更多回复';}else{area('A').innerHTML=reply('A2');}};});
 control('B').onclick=()=>{area('B').innerHTML=reply('B1','有，我昨天刚用过');};
 document.querySelector<HTMLElement>('body > .show-more')!.onclick=()=>{throw new Error('禁止点击容器外控件');};
 const snap=await captureNote(7,{autoLoad:true,onDelta:persist,onProgress:p=>{states.push(p);},wait:async()=>{
  await wait();if(pending && ++samples===8){const fn=pending;pending=null;fn();}
  if(aClicks===2 && area('A').querySelector('#comment-A2')){expect(await db.comments.get(key+':A1')).toBeDefined();area('A').innerHTML=reply('A2');}
 }});
 expect(aClicks).toBe(2);expect(snap.comments).toHaveLength(5);expect(await db.comments.count()).toBe(5);
 for(const id of ['A1','A2'])expect((await db.comments.get(key+':'+id))?.parentKey).toBe(key+':A');expect((await db.comments.get(key+':B1'))?.parentKey).toBe(key+':B');
 expect(document.querySelector('#comment-A1')).toBeNull();expect(states.some(p=>p.loadingReplies)).toBe(true);expect(states.at(-1)).toMatchObject({topLevelCount:2,replyCount:3});
});
it('G 一级评论+回复总500后不能继续展开',async()=>{
 for(let i=0;i<496;i++)document.querySelector('.list-container')!.insertAdjacentHTML('beforeend',`<div class="parent-comment"><div class="comment-item" id="comment-extra${i}"><div class="content"><span class="note-text">合成一级${i}</span></div></div></div>`);
 const a=vi.fn(()=>{area('A').insertAdjacentHTML('afterbegin',reply('A1')+reply('A2'));});control('A').onclick=a;const b=vi.fn();control('B').onclick=b;
 const snap=await captureNote(7,{autoLoad:true,wait,onDelta:persist});expect(snap.comments).toHaveLength(500);expect(await db.comments.count()).toBe(500);expect(a).toHaveBeenCalledTimes(1);expect(b).not.toHaveBeenCalled();
});
it('H 取消后不再展开或写入迟到回复',async()=>{
 const ac=new AbortController();const a=vi.fn();control('A').onclick=a;
 await expect(captureNote(7,{autoLoad:true,signal:ac.signal,onDelta:async(n,c)=>{await persist(n,c);ac.abort();},wait})).rejects.toMatchObject({code:'CANCELLED'});
 area('A').insertAdjacentHTML('afterbegin',reply('late'));await wait();expect(a).not.toHaveBeenCalled();expect(await db.comments.count()).toBe(2);
});
it('I 展开遇验证立即停止，不绕过、不点击下一组',async()=>{
 control('A').onclick=()=>{document.body.insertAdjacentHTML('beforeend','<div role="dialog">安全验证 请拖动滑块</div>');};const b=vi.fn();control('B').onclick=b;
 await expect(captureNote(7,{autoLoad:true,wait,onDelta:persist})).rejects.toMatchObject({code:'PAGE_BLOCKED'});expect(b).not.toHaveBeenCalled();expect(await db.comments.count()).toBe(2);
});
it('J AI最终请求携带当前回复及其父评论，不携带其他父评论或平台身份',async()=>{
 control('A').onclick=()=>{area('A').innerHTML=reply('A1');};control('B').remove();const snap=await captureNote(7,{autoLoad:true,wait,onDelta:persist});
 const claim={value:null,status:'unknown',evidence:[]};const profile=ProductProfileSchema.parse({schemaVersion:1,name:claim,category:claim,summary:claim,accessMethod:claim,price:claim,purchaseChannel:claim,capabilities:[],targetAudience:[],needsServed:[],exclusions:[],searchSuggestions:[]});
 const current=snap.comments.find(c=>c.platformCommentId==='A1')!;expect(current).toBeDefined();
 const dto=buildClassificationInput(profile,snap.note,[current],new Map(snap.comments.map(c=>[c.commentKey,c])),12000).input;
 const body=JSON.parse(buildCommentMessages(dto).at(-1)!.content);expect(body.items[0].parent.text).toBe('这个多少钱？');expect(body.items[0].text).toContain('商用版');expect(JSON.stringify(body)).not.toContain('有没有网页版');expect(JSON.stringify(body)).not.toContain('syntheticR');
});
it('K 旧一级评论数据仍直接可读，无需迁移',async()=>{const snap=await captureNote(7,{onDelta:persist});const old=CommentSchema.parse(snap.comments[0]);expect(old.parentKey).toBeNull();expect((await repos.commentsForNote(key))).toHaveLength(2);});
it('父评论无平台ID仍按DOM父容器关联，不能把回复变成一级评论',async()=>{
 wrapper('A').querySelector('.comment-item')!.removeAttribute('id');control('A').onclick=()=>{area('A').innerHTML=reply('A1');};control('B').remove();
 const snap=await captureNote(7,{autoLoad:true,wait,onDelta:persist});const top=snap.comments.find(c=>c.text==='这个多少钱？')!;expect(snap.comments.find(c=>c.platformCommentId==='A1')?.parentKey).toBe(top.commentKey);
});
it('展开无响应只点击一次，等待上限后明确失败，不无限点击或伪报无更多',async()=>{
 const click=vi.fn();control('A').onclick=click;
 await expect(captureNote(7,{autoLoad:true,wait,onDelta:persist})).rejects.toMatchObject({code:'PARSE_FAILED'});expect(click).toHaveBeenCalledTimes(1);expect(await db.comments.count()).toBe(2);
});

it('H2 展开等待期间取消：迟到回复不落库，下一组不展开',async()=>{
 const ac=new AbortController();const a=vi.fn();const b=vi.fn();control('A').onclick=a;control('B').onclick=b;
 await expect(captureNote(7,{autoLoad:true,signal:ac.signal,onDelta:persist,wait:async()=>{await wait();ac.abort();area('A').insertAdjacentHTML('afterbegin',reply('late'));}})).rejects.toMatchObject({code:'CANCELLED'});
 expect(a).toHaveBeenCalledTimes(1);expect(b).not.toHaveBeenCalled();expect(await db.comments.count()).toBe(2);
});
it('仅展开回复控件可点击：互动、隐藏、禁用、其他文案及容器外元素都不触发',async()=>{
 control('A').textContent='回复';control('B').hidden=true;
 area('A').insertAdjacentHTML('beforeend','<div class="show-more" aria-disabled="true">展开更多回复</div><a class="show-more" href="/explore/aaaaaaaaaaaaaaaaaaaaaaaa">查看全部回复</a><div class="interactions"><div class="show-more">展开更多回复</div></div>');
 const clicked=vi.fn();document.querySelectorAll<HTMLElement>('.show-more').forEach(el=>{el.onclick=clicked;});
 const snap=await captureNote(7,{autoLoad:true,wait,onDelta:persist});expect(clicked).not.toHaveBeenCalled();expect(snap.comments).toHaveLength(2);
});

it('虚拟列表移除一级评论DOM但保留同一回复容器时，仍用已确认父关系展开并采集后续回复',async()=>{
 control('B').remove();let clicks=0;area('A').addEventListener('click',e=>{if(!(e.target as Element).closest('.show-more'))return;clicks++;if(clicks===1){area('A').insertAdjacentHTML('afterbegin',reply('A1'));control('A').textContent='展开更多回复';}else area('A').innerHTML=reply('A2');});
 const snap=await captureNote(7,{autoLoad:true,onDelta:persist,wait:async()=>{await wait();if(await db.comments.get(key+':A1'))wrapper('A').querySelector(':scope > .comment-item')?.remove();}});
 expect(clicks).toBe(2);expect(snap.comments.filter(c=>c.parentKey===key+':A')).toHaveLength(2);expect((await db.comments.get(key+':A2'))?.parentKey).toBe(key+':A');
});
