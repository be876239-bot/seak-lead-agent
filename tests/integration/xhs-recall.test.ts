// @vitest-environment-options {"url":"https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa"}
import 'fake-indexeddb/auto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {XhsSessionManager} from '../../src/xhs/session';
import {SeekLeadDb} from '../../src/storage/db';
import {Repositories} from '../../src/storage/repositories';
import {buildOk,buildError,buildRequest,RequestSchema,SnapshotPayload} from '../../src/messaging/protocol';
import {toErrorPayload} from '../../src/domain/errors';
import type {Comment,Note} from '../../src/domain/schemas';
const send=vi.hoisted(()=>vi.fn());
vi.mock('wxt/browser',()=>({browser:{tabs:{sendMessage:send}}}));
const {captureNote}=await import('../../src/xhs/capture');
const key='xhs:aaaaaaaaaaaaaaaaaaaaaaaa';
let manager:XhsSessionManager,db:SeekLeadDb,repos:Repositories,jobId:string,clock:number;
let scroll:ReturnType<typeof vi.fn>,scroller:HTMLElement;
const item=(id:number)=>`<div class="parent-comment"><div class="comment-item" id="comment-${id}"><div class="content"><span class="note-text">合成评论${id}</span></div></div></div>`;
const items=(a:number,b:number)=>Array.from({length:b-a+1},(_,i)=>item(a+i)).join('');
const list=()=>document.querySelector<HTMLElement>('.list-container')!;
const tick=async()=>{clock+=500;await Promise.resolve();};
const persist=(n:Note,c:Comment[])=>repos.saveCaptureDelta(jobId,n,c,new AbortController().signal);
beforeEach(async()=>{
 clock=0;document.body.innerHTML=`<div id="noteContainer"><h1 id="detail-title">合成召回回归</h1><div class="scroller" style="overflow-y:auto"><div class="comments-el"><div class="list-container">${items(1,20)}</div></div></div></div>`;
 scroller=document.querySelector('.scroller')!;Object.defineProperties(scroller,{clientHeight:{value:500,configurable:true},scrollHeight:{value:1000,configurable:true}});
 scroll=vi.fn(({top}:{top:number})=>{scroller.scrollTop=Math.min(scroller.scrollHeight-scroller.clientHeight,scroller.scrollTop+top);});scroller.scrollBy=scroll;
 manager=new XhsSessionManager(()=>document,()=>clock);db=new SeekLeadDb('recall-'+crypto.randomUUID());repos=new Repositories(db);jobId=crypto.randomUUID();
 await repos.createJob({id:jobId,kind:'comments',status:'collecting',ownerId:'test',generation:0,productId:null,profileVersion:null,tabId:7,noteKey:null,provider:'mock',modelId:'mock',promptVersion:'same',totalItems:0,completedItems:0,failedItems:0,errorCode:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 send.mockReset();send.mockImplementation(async(_id,raw)=>{const r=RequestSchema.parse(raw);try{return buildOk(r.requestId,await manager.handle(r));}catch(e){return buildError(r.requestId,toErrorPayload(e));}});
});
afterEach(()=>{manager.dispose();db.close();});

it('1/3 重叠虚拟窗口1–20→15–35→30–50，最终数据库恰好1–50',async()=>{
 scroll.mockImplementation(({top})=>{scroller.scrollTop=Math.min(500,scroller.scrollTop+top);const n=scroll.mock.calls.length;if(n===1)list().innerHTML=items(15,35);if(n===2)list().innerHTML=items(30,50);});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});
 expect(r.comments).toHaveLength(50);expect(await db.comments.count()).toBe(50);
 expect((await db.comments.toArray()).map(c=>Number(c.platformCommentId)).sort((a,b)=>a-b)).toEqual(Array.from({length:50},(_,i)=>i+1));
});
it('2 一秒后才插入的新评论不会因前500ms无变化而停止',async()=>{
 let inserted=false;const r=await captureNote(7,{autoLoad:true,onDelta:persist,wait:async()=>{await tick();if(!inserted&&clock>=1000){inserted=true;list().insertAdjacentHTML('beforeend',item(21));}}});
 expect(r.comments).toHaveLength(21);expect(await db.comments.count()).toBe(21);
});
it('B 首次滚动12秒后加载，不在原10秒空闲窗口误停',async()=>{
 let inserted=false;const r=await captureNote(7,{autoLoad:true,onDelta:persist,wait:async()=>{await tick();if(!inserted&&clock>=12000){inserted=true;list().insertAdjacentHTML('beforeend',item(21));}}});
 expect(r.comments).toHaveLength(21);expect(r.stopReason).toBe('no_new');expect(clock).toBeGreaterThanOrEqual(27000);
});
it('4 同昵称/作者/文本/相对时间但不同无ID节点，必须保留两条',async()=>{
 const weak='<div class="comment-item"><div class="author"><a class="name" href="/user/profile/same">同昵称</a></div><div class="content"><span class="note-text">求</span></div><div class="info"><div class="date"><span>昨天</span></div></div></div>';
 list().innerHTML=weak+weak;const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});
 expect(r.comments).toHaveLength(2);expect(new Set(r.comments.map(c=>c.commentKey)).size).toBe(2);expect(await db.comments.count()).toBe(2);
});
it('4 同一无ID节点重复扫描不得重复保存',async()=>{
 list().innerHTML='<div class="comment-item"><div class="content"><span class="note-text">求</span></div></div>';
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.comments).toHaveLength(1);expect(await db.comments.count()).toBe(1);
});
it('5 同一JS任务中插入又移除的评论仍进入累计与数据库',async()=>{
 scroll.mockImplementationOnce(()=>{list().insertAdjacentHTML('beforeend',item(21));document.querySelector('#comment-21')!.closest('.parent-comment')!.remove();});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(document.querySelector('#comment-21')).toBeNull();expect(r.comments).toHaveLength(21);expect(await db.comments.get(key+':21')).toBeDefined();
});
it('5 整个列表被替换前短暂插入的窗口也保留，且不采容器外推荐',async()=>{
 document.body.insertAdjacentHTML('beforeend',item(999));
 scroll.mockImplementationOnce(()=>{list().innerHTML=items(15,35);list().innerHTML=items(30,50);});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.comments).toHaveLength(50);expect(await db.comments.get(key+':999')).toBeUndefined();
});
it('6/7 一级评论多层包装时，两个父评论与各自回复关系不串',async()=>{
 list().innerHTML=[1,2].map(id=>`<div class="parent-comment"><div class="extra"><div class="comment-item" id="comment-${id}"><div class="content"><span class="note-text">父${id}</span></div></div></div><div class="reply-container"><div class="extra"><div class="comment-item comment-item-sub" id="comment-r${id}"><div class="content"><span class="note-text">回复${id}</span></div></div></div></div></div>`).join('');
 const r=await captureNote(7,{onDelta:persist});expect(r.comments).toHaveLength(4);for(const id of [1,2])expect((await db.comments.get(key+':r'+id))?.parentKey).toBe(key+':'+id);
});
it('6 包装后的父评论仍可正常展开回复',async()=>{
 list().innerHTML='<div class="extra"><div class="parent-comment"><div class="extra"><div class="comment-item" id="comment-1"><div class="content"><span class="note-text">父</span></div></div></div><div class="reply-container"><div class="show-more">展开1条回复</div></div></div></div>';
 const control=document.querySelector<HTMLElement>('.show-more')!;control.onclick=()=>{control.parentElement!.innerHTML='<div class="comment-item comment-item-sub" id="comment-r1"><div class="content"><span class="note-text">回复</span></div></div>';};
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.comments).toHaveLength(2);expect((await db.comments.get(key+':r1'))?.parentKey).toBe(key+':1');
});
it('D 图片/表情位于content内但不在note-text内，保留非文本占位，不读整页文字',async()=>{
 list().innerHTML='<div class="comment-item" id="comment-img"><div class="content"><img alt="公开图片" src="about:blank"></div></div><div class="comment-item" id="comment-emoji"><div class="content"><span class="note-text"><img alt="[笑]" src="about:blank"></span></div></div>';
 const r=await captureNote(7,{onDelta:persist});expect(r.comments).toHaveLength(2);expect(r.comments.every(c=>c.text==='[non-text-comment]')).toBe(true);
});
it('D 缺作者/时间仍保留，空骨架不制造评论，延迟填充文本后能采到',async()=>{
 list().innerHTML='<div class="comment-item" id="comment-1"><div class="content"><span class="note-text"></span></div></div>';
 const r=await captureNote(7,{autoLoad:true,onDelta:persist,wait:async()=>{await tick();document.querySelector('.note-text')!.textContent='迟到文本';}});expect(r.comments).toHaveLength(1);expect(r.comments[0]).toMatchObject({text:'迟到文本',authorLocalKey:null,publishedText:null});
});
it('A 小视口滚动仍保留至少半屏重叠，不被120px下限跨过中间窗口',async()=>{
 Object.defineProperty(scroller,'clientHeight',{value:100,configurable:true});
 await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(scroll.mock.calls.length).toBeGreaterThan(0);expect(scroll.mock.calls.every(([o])=>o.top<=50&&o.top>0)).toBe(true);
});
it('B DOM仍在加载20秒时不按无新增结束，加载完成后有界停止',async()=>{
 document.querySelector('.comments-el')!.setAttribute('aria-busy','true');
 const r=await captureNote(7,{autoLoad:true,onDelta:persist,wait:async()=>{await tick();if(clock===20000){document.querySelector('.comments-el')!.removeAttribute('aria-busy');list().insertAdjacentHTML('beforeend',item(21));}}});expect(r.comments).toHaveLength(21);expect(r.stopReason).toBe('no_new');
});
it('E 落库Promise完成前绝不滚动，移除DOM后仍使用已提取记录',async()=>{
 let first=true,stored=false;scroll.mockImplementation(()=>{expect(stored).toBe(true);});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:async(n,c)=>{if(first){first=false;await Promise.resolve();list().innerHTML='';}await persist(n,c);stored=true;}});expect(r.comments).toHaveLength(20);expect(await db.comments.count()).toBe(20);
});
it('5 整个list-container同一任务内替换两次，中间窗口仍保留',async()=>{
 scroll.mockImplementationOnce(()=>{list().outerHTML=`<div class="list-container">${items(15,35)}</div>`;list().outerHTML=`<div class="list-container">${items(30,50)}</div>`;});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.comments).toHaveLength(50);expect(await db.comments.count()).toBe(50);
});
it('边界：评论区内但列表外的推荐comment-item不能被mutation补采',async()=>{
 scroll.mockImplementationOnce(()=>document.querySelector('.comments-el')!.insertAdjacentHTML('beforeend',item(999)));
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.comments).toHaveLength(20);expect(await db.comments.get(key+':999')).toBeUndefined();
});
it('安全：短暂评论与登录验证同批出现，立即报平台限制且不继续保存',async()=>{
 scroll.mockImplementationOnce(()=>{list().insertAdjacentHTML('beforeend',item(21));document.body.insertAdjacentHTML('beforeend','<div class="login-container">登录验证</div>');});
 await expect(captureNote(7,{autoLoad:true,wait:tick,onDelta:persist})).rejects.toMatchObject({code:'PAGE_BLOCKED'});expect(await db.comments.count()).toBe(20);expect(scroll).toHaveBeenCalledTimes(1);
});
it('B 未到底且没有新增不能误报no_new，仍受200轮上限保护',async()=>{
 scroll.mockImplementation(()=>{});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.stopReason).toBe('round_limit');expect(scroll).toHaveBeenCalledTimes(200);expect(r.comments).toHaveLength(20);
});
it('A 滚动超过半屏就跳过21–24的虚拟列表，实际小步重叠可保存1–50',async()=>{
 scroll.mockImplementation(({top})=>{scroller.scrollTop=Math.min(500,scroller.scrollTop+top);list().innerHTML=scroller.scrollTop>=500?items(30,50):top>250?items(25,44):items(15,35);});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.comments).toHaveLength(50);expect(await db.comments.count()).toBe(50);for(const id of [21,22,23,24])expect(await db.comments.get(key+':'+id)).toBeDefined();
});
it('B 底部14秒时DOM仍变化会重置安静期，22秒到达的评论被保留',async()=>{
 const r=await captureNote(7,{autoLoad:true,onDelta:persist,wait:async()=>{await tick();if(clock===14000)list().insertAdjacentHTML('beforeend','<span>加载进度变化（合成）</span>');if(clock===22000)list().insertAdjacentHTML('beforeend',item(21));}});expect(r.comments).toHaveLength(21);expect(clock).toBeGreaterThanOrEqual(37000);
});
it('B 加载标志不消失也必须受单帖3分钟硬上限控制',async()=>{
 document.querySelector('.comments-el')!.setAttribute('aria-busy','true');const now=vi.spyOn(Date,'now').mockImplementation(()=>clock);
 try{const r=await captureNote(7,{autoLoad:true,onDelta:persist,wait:tick});expect(r.stopReason).toBe('time_limit');expect(clock).toBeGreaterThanOrEqual(180000);expect(scroll.mock.calls.length).toBeLessThan(200);}finally{now.mockRestore();}
});
it('B 内层不足一屏的overflow容器不能冒充实际外层滚动容器已到底',async()=>{
 list().style.overflowY='auto';Object.defineProperties(list(),{clientHeight:{value:50},scrollHeight:{value:50}});
 const first=SnapshotPayload.parse(await manager.handle(buildRequest('XHS_START_SESSION',{expectedNoteKey:key})));expect(first.atBottom).toBe(false);
});
it('C 空的comment-不是稳定ID，同文同作者的三条记录都保留',async()=>{
 const weak='<div class="comment-item" id="comment-"><div class="author"><a class="name" href="/user/profile/same">同昵称</a></div><div class="content"><span class="note-text">求</span></div></div>';
 list().innerHTML=weak.repeat(3);const r=await captureNote(7,{onDelta:persist});expect(r.comments).toHaveLength(3);expect(await db.comments.count()).toBe(3);expect(r.comments.every(c=>c.platformCommentId===null)).toBe(true);
});
it('C 同一个无ID节点移除再插入，不因mutation重放产生重复',async()=>{
 list().innerHTML='<div class="comment-item"><div class="author"><a class="name" href="/user/profile/same">同昵称</a></div><div class="content"><span class="note-text">求</span></div></div>';
 const node=list().firstElementChild!;scroll.mockImplementationOnce(()=>{node.remove();list().append(node);});
 const r=await captureNote(7,{autoLoad:true,wait:tick,onDelta:persist});expect(r.comments).toHaveLength(1);expect(await db.comments.count()).toBe(1);
});
