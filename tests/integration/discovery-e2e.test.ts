// @vitest-environment-options {"url":"https://www.xiaohongshu.com/search_result?keyword=AI"}
import 'fake-indexeddb/auto';
import {JobSchema} from '../../src/domain/schemas';
import {afterEach,expect,it,vi} from 'vitest';
import {AppError,toErrorPayload} from '../../src/domain/errors';
import {SeekLeadDb} from '../../src/storage/db';
import {Repositories} from '../../src/storage/repositories';
import {TaskLockManager} from '../../src/analysis/lock';
import {MockProvider} from '../../src/ai/mock';
import {runProfileGeneration,type RunnerDeps} from '../../src/analysis/runner';
import {XhsSessionManager} from '../../src/xhs/session';
import {RequestSchema,buildRequest,buildOk,buildError} from '../../src/messaging/protocol';
import {handleBackgroundMessage} from '../../src/messaging/handlers';
const shared=vi.hoisted(()=>({deps:null as unknown as RunnerDeps, tabs:{get:vi.fn(),create:vi.fn(),update:vi.fn(),goBack:vi.fn(),sendMessage:vi.fn()}}));
vi.mock('wxt/browser',()=>({browser:{runtime:{id:'test',getURL:()=> 'chrome-extension://test/'},tabs:shared.tabs}}));
vi.mock('../../src/analysis/jobs',()=>({get analysisRepos(){return shared.deps.repos;},makeDeps:async()=>shared.deps,baseJob:(_d:unknown,id:string)=>({id,kind:'comments',status:'created',ownerId:'test',generation:0,productId:null,profileVersion:null,tabId:null,noteKey:null,provider:'mock',modelId:'mock',promptVersion:'test',totalItems:0,completedItems:0,failedItems:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),errorCode:null})}));
vi.mock('../../src/xhs/capture',async importOriginal=>{const actual=await importOriginal<typeof import('../../src/xhs/capture')>();return {...actual,captureNote:(id:number,options:import('../../src/xhs/capture').CaptureOptions)=>actual.captureNote(id,{...options,wait:async()=>{await Promise.resolve();}})};});
const {registerDiscoveryHandlers}=await import('../../src/discovery/jobs');
let db:SeekLeadDb;let manager:XhsSessionManager;
afterEach(()=>{manager?.dispose();db?.close();});
const ids=['a'.repeat(24),'b'.repeat(24)];
function items(from:number,to:number){return Array.from({length:to-from+1},(_,i)=>`<div class="parent-comment"><div class="comment-item" id="comment-${from+i}"><div class="content"><span class="note-text">需要购买PPT工具${from+i}</span></div></div></div>`).join('');}
it('production handlers → serial navigation → real incremental session → IndexedDB → existing AI runner; two notes remain isolated',async()=>{
 db=new SeekLeadDb('discovery-e2e-'+crypto.randomUUID());const repos=new Repositories(db);const lock=new TaskLockManager(repos);
 const provider=new MockProvider({profile:()=>({schemaVersion:1,name:{value:'合成产品',status:'inferred',evidence:[]},category:{value:null,status:'unknown',evidence:[]},summary:{value:null,status:'unknown',evidence:[]},capabilities:[],targetAudience:[],needsServed:[],exclusions:[],accessMethod:{value:null,status:'unknown',evidence:[]},price:{value:null,status:'unknown',evidence:[]},purchaseChannel:{value:null,status:'unknown',evidence:[]},searchSuggestions:['AI PPT']}),classification:input=>({results:input.items.map(c=>({commentId:c.commentId,relevance:'direct',need:'explicit',purchaseIntent:'explicit_buy',speakerRole:'seeker',intentTarget:'our_product',productFit:'supported',needSummary:'合成需求',evidence:[{sourceId:c.commentId+':text',quote:c.text}],reason:'合成测试',uncertainty:null}))})});
 shared.deps={repos,lock,provider,providerName:'mock',modelId:'mock',retryDelayMs:0};
 const product=await runProfileGeneration(shared.deps,{inputUrl:'https://example.com',finalUrl:'https://example.com',blocks:[{id:'b001',url:'https://example.com',text:'合成产品',fetchedAt:new Date().toISOString()}]});
 const source='https://www.xiaohongshu.com/search_result?keyword=AI';let currentUrl=source;let backs=0;const clicked:string[]=[];
 function renderNote(url:string){manager?.dispose();currentUrl=url;history.replaceState({},'',url);document.body.innerHTML=`<div id="noteContainer"><h1 id="detail-title">合成笔记</h1><div id="detail-desc"><span class="note-text">合成正文</span></div><div class="scroller" style="overflow-y:auto"><div class="comments-el"><div class="list-container">${items(1,20)}</div></div></div></div>`;
 const el=document.querySelector<HTMLElement>('.scroller')!;Object.defineProperties(el,{clientHeight:{value:500},scrollHeight:{value:1000}});el.scrollBy=o=>{el.scrollTop=Math.min(el.scrollHeight-el.clientHeight,el.scrollTop+(typeof o==='object'?o.top??0:0));document.querySelector('.list-container')!.innerHTML=items(21,40);};manager=new XhsSessionManager(()=>document);}
 function renderSearch(){manager?.dispose();currentUrl=source;history.replaceState({},'',source);document.body.innerHTML=[...ids].reverse().map(note=>`<section class="note-item"><a class="cover" href="/explore/${note}?source=current-${backs}">note</a></section>`).join('');
 document.querySelectorAll<HTMLAnchorElement>('a.cover').forEach(a=>a.onclick=e=>{e.preventDefault();clicked.push(a.getAttribute('href')!);renderNote(a.href);});manager=new XhsSessionManager(()=>document);}
 renderSearch();
 shared.tabs.get.mockImplementation(async()=>({id:7,url:currentUrl,status:'complete'}));shared.tabs.goBack.mockImplementation(async()=>{backs++;renderSearch();});
 shared.tabs.create.mockImplementation(()=>{throw new Error('不允许创建标签');});shared.tabs.update.mockImplementation(()=>{throw new Error('不允许直接改URL');});
 shared.tabs.sendMessage.mockImplementation(async(_id,raw)=>{const req=RequestSchema.parse(raw);try{return buildOk(req.requestId,await manager.handle(req));}catch(e){return buildError(req.requestId,toErrorPayload(e));}});
 registerDiscoveryHandlers();const id=crypto.randomUUID();const sender={id:'test',url:'chrome-extension://test/sidepanel.html'};
 const classifySpy=vi.spyOn(provider,'classifyComments');
 const start=await handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:id,productId:product.id,tabId:7,direction:'AI PPT'}),sender);expect(start.ok,start.error?.message).toBe(true);
 for(let n=0;n<300;n++){const job=await repos.getJob(id);if(job?.discovery?.status!=='running' && job?.status!=='collecting')break;await new Promise(r=>setTimeout(r,5));}
 const job=await repos.getJob(id);expect(job?.discovery?.status,JSON.stringify(job?.discovery)).toBe('completed');expect(job?.discovery?.comments).toBe(80);expect(job?.discovery?.leads).toBe(80);
 expect(shared.tabs.create).not.toHaveBeenCalled();expect(shared.tabs.update).not.toHaveBeenCalled();expect(clicked).toHaveLength(2);expect(shared.tabs.goBack).toHaveBeenCalledTimes(2);
 for(const note of ids){const comments=await repos.commentsForNote('xhs:'+note);expect(comments).toHaveLength(40);expect(comments.every(c=>c.noteKey==='xhs:'+note)).toBe(true);}
 expect(await db.analyses.count()).toBe(80);expect(shared.tabs.sendMessage.mock.calls.every(([,r])=>['XHS_CLICK_NOTE','XHS_SEARCH_STATE','XHS_DISCOVER','XHS_GUARD','XHS_GET_STATUS','XHS_START_SESSION','XHS_GET_SNAPSHOT','XHS_STOP_SESSION'].includes(r.type))).toBe(true);
 // 模拟后台中断：仍用同一jobs表保存有界队列；注册后台本身不得自动恢复。
 expect(()=>JobSchema.parse(job)).not.toThrow();
 const prior=job!.discovery!;await repos.updateJob(id,{status:'collecting',discovery:{...prior,status:'running',index:1,comments:40,leads:40,currentComments:0,currentLeads:0}});
 await repos.markInterruptedOnRecovery();expect((await repos.getJob(id))?.discovery?.status).toBe('paused');
 const beforeCalls=classifySpy.mock.calls.length;vi.resetModules();
 const restarted=await import('../../src/discovery/jobs');const messaging=await import('../../src/messaging/handlers');restarted.registerDiscoveryHandlers();
 expect(clicked).toHaveLength(2);
 const resume=await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_CONTROL',{jobId:id,action:'continue'}),sender);expect(resume.ok,resume.error?.message).toBe(true);
 for(let n=0;n<300;n++){const row=await repos.getJob(id);if(row?.discovery?.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
 const resumed=await repos.getJob(id);expect(resumed?.discovery?.status,JSON.stringify(resumed?.discovery)).toBe('completed');
 expect(resumed?.discovery?.comments).toBe(80);expect(resumed?.discovery?.leads).toBe(80);expect(resumed?.discovery?.deadline).toBe(prior.deadline);
 expect(shared.tabs.create).not.toHaveBeenCalled();expect(shared.tabs.update).not.toHaveBeenCalled();expect(clicked).toHaveLength(3);expect(shared.tabs.goBack).toHaveBeenCalledTimes(3);expect(classifySpy.mock.calls.length).toBe(beforeCalls);expect(await db.comments.count()).toBe(80);
 // 暂停后旧Back尚未退出：继续等待不能阻止用户再次停止，且完成索引保留。
 let release!:()=>void;const navigation=new Promise<void>(resolve=>{release=resolve;});shared.tabs.goBack.mockImplementationOnce(async()=>{await navigation;backs++;renderSearch();});
 const nextId=crypto.randomUUID();expect((await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:nextId,productId:product.id,tabId:7,direction:'AI PPT'}),sender)).ok).toBe(true);
 for(let n=0;n<300 && shared.tabs.goBack.mock.calls.length<4;n++)await new Promise(r=>setTimeout(r,5));
 expect((await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_CONTROL',{jobId:nextId,action:'pause'}),sender)).ok).toBe(true);
 const continuing=messaging.handleBackgroundMessage(buildRequest('DISCOVERY_CONTROL',{jobId:nextId,action:'continue'}),sender);
 const stopped=await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_CONTROL',{jobId:nextId,action:'stop'}),sender);expect(stopped.ok,stopped.error?.message).toBe(true);
 release();await continuing;expect((await repos.getJob(nextId))?.discovery?.status).toBe('stopped');expect(clicked).toHaveLength(4);expect((await repos.getJob(nextId))?.discovery?.index).toBe(1);
 expect((await repos.getJob(id))?.discovery?.navigation?.phase).toBe('search');expect((await repos.getJob(id))?.discovery?.completedNoteKeys).toHaveLength(2);
 await expect(repos.saveCaptureDelta(crypto.randomUUID(),{noteKey:'invalid'} as never,[],new AbortController().signal)).rejects.toBeInstanceOf(AppError);
},10000);
