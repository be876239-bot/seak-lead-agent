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
const shared=vi.hoisted(()=>({deps:null as unknown as RunnerDeps, tabs:{get:vi.fn(),query:vi.fn(),create:vi.fn(),update:vi.fn(),goBack:vi.fn(),sendMessage:vi.fn()}}));
vi.mock('wxt/browser',()=>({browser:{runtime:{id:'test',getURL:()=> 'chrome-extension://test/'},tabs:shared.tabs}}));
vi.mock('../../src/analysis/jobs',()=>({get analysisRepos(){return shared.deps.repos;},makeDeps:async()=>shared.deps,baseJob:(_d:unknown,id:string)=>({id,kind:'comments',status:'created',ownerId:'test',generation:0,productId:null,profileVersion:null,tabId:null,noteKey:null,provider:'mock',modelId:'mock',promptVersion:'test',totalItems:0,completedItems:0,failedItems:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),errorCode:null})}));
vi.mock('../../src/xhs/capture',async importOriginal=>{const actual=await importOriginal<typeof import('../../src/xhs/capture')>();return {...actual,captureNote:(id:number,options:import('../../src/xhs/capture').CaptureOptions)=>actual.captureNote(id,{...options,wait:async()=>{await Promise.resolve();}})};});
// Synthetic task tests skip only the fixed inter-post dwell; pacing is tested with a controllable clock.
vi.mock('../../src/discovery/browser',async load=>{const actual=await load<typeof import('../../src/discovery/browser')>();return {...actual,wait:async()=>{}};});
let db:SeekLeadDb;let manager:XhsSessionManager;
afterEach(()=>{manager?.dispose();db?.close();});
const ids=['a'.repeat(24),'b'.repeat(24)];
function items(from:number,to:number){return Array.from({length:to-from+1},(_,i)=>`<div class="parent-comment"><div class="comment-item" id="comment-${from+i}"><div class="content"><span class="note-text">需要购买PPT工具${from+i}</span></div></div></div>`).join('');}
it.each(['normal','captured-live','completed-live','captured-restored','completed-restored','captured-stale-tab-live','captured-stale-tab-restored','incomplete','reply-timeout'])('production handlers → serial navigation → incremental session → IndexedDB → AI; %s boundary recovery',async mode=>{
 vi.resetModules();const {registerDiscoveryHandlers}=await import('../../src/discovery/jobs');const {handleBackgroundMessage}=await import('../../src/messaging/handlers');
 db=new SeekLeadDb('discovery-e2e-'+crypto.randomUUID());const repos=new Repositories(db);const lock=new TaskLockManager(repos);
 const provider=new MockProvider({profile:()=>({schemaVersion:1,name:{value:'合成产品',status:'inferred',evidence:[]},category:{value:null,status:'unknown',evidence:[]},summary:{value:null,status:'unknown',evidence:[]},capabilities:[],targetAudience:[],needsServed:[],exclusions:[],accessMethod:{value:null,status:'unknown',evidence:[]},price:{value:null,status:'unknown',evidence:[]},purchaseChannel:{value:null,status:'unknown',evidence:[]},searchSuggestions:['AI PPT']}),classification:input=>({results:input.items.map(c=>({commentId:c.commentId,relevance:'direct',need:'explicit',purchaseIntent:'explicit_buy',speakerRole:'seeker',intentTarget:'our_product',productFit:'supported',needSummary:'合成需求',evidence:[{sourceId:c.commentId+':text',quote:c.text}],reason:'合成测试',uncertainty:null}))})});
 shared.deps={repos,lock,provider,providerName:'mock',modelId:'mock',retryDelayMs:0};
 const product=await runProfileGeneration(shared.deps,{inputUrl:'https://example.com',finalUrl:'https://example.com',blocks:[{id:'b001',url:'https://example.com',text:'合成产品',fetchedAt:new Date().toISOString()}]});
 const source='https://www.xiaohongshu.com/search_result?keyword=AI';let currentUrl=source;let currentTabId=7;let backs=0;const clicked:string[]=[];
 let replyClock=0;
 function renderNote(url:string){manager?.dispose();currentUrl=url;history.replaceState({},'',url);document.body.innerHTML=`<div id="noteContainer"><h1 id="detail-title">合成笔记</h1><div id="detail-desc"><span class="note-text">合成正文</span></div><div class="scroller" style="overflow-y:auto"><div class="comments-el">${mode==='incomplete'?'<div class="total">共 1500 条评论</div>':''}<div class="list-container">${items(1,20)}</div></div></div></div>`;
 if(mode==='reply-timeout')document.querySelector('#comment-1')!.parentElement!.insertAdjacentHTML('beforeend','<div class="reply-container"><div class="show-more">展开更多回复</div></div>');
 const el=document.querySelector<HTMLElement>('.scroller')!;Object.defineProperties(el,{clientHeight:{value:500},scrollHeight:{value:1000}});el.scrollBy=o=>{el.scrollTop=Math.min(el.scrollHeight-el.clientHeight,el.scrollTop+(typeof o==='object'?o.top??0:0));document.querySelector('.list-container')!.innerHTML=items(21,40);};manager=new XhsSessionManager(()=>document,mode==='reply-timeout'?()=>replyClock:Date.now);}
 function renderSearch(){manager?.dispose();currentUrl=source;history.replaceState({},'',source);document.body.innerHTML=[...ids].reverse().map(note=>`<section class="note-item"><a class="cover" href="/explore/${note}?source=current-${backs}">note</a></section>`).join('');
 document.querySelectorAll<HTMLAnchorElement>('a.cover').forEach(a=>a.onclick=e=>{e.preventDefault();clicked.push(a.getAttribute('href')!);renderNote(a.href);});manager=new XhsSessionManager(()=>document);}
 renderSearch();
 let blocked=false,boundaryInjected=false;
 const update=repos.updateJob.bind(repos);
 vi.spyOn(repos,'updateJob').mockImplementation(async(id,patch)=>{
  await update(id,patch);
  if(!boundaryInjected && mode!=='normal' && mode!=='incomplete' && patch.discovery?.post?.stage===mode.split('-')[0]){boundaryInjected=true;blocked=true;}
 });
 shared.tabs.get.mockImplementation(async(id:number)=>{if(id!==currentTabId)throw new Error('No tab with id: '+id);return {id:currentTabId,url:currentUrl,status:'complete',active:true};});shared.tabs.query.mockImplementation(async()=>[{id:currentTabId,url:currentUrl,status:'complete',active:true}]);shared.tabs.goBack.mockImplementation(async()=>{backs++;renderSearch();});
 shared.tabs.create.mockImplementation(()=>{throw new Error('不允许创建标签');});shared.tabs.update.mockImplementation(()=>{throw new Error('不允许直接改URL');});
 shared.tabs.sendMessage.mockImplementation(async(_id,raw)=>{const req=RequestSchema.parse(raw);if(mode==='reply-timeout'&&req.type==='XHS_GET_SNAPSHOT')replyClock+=500;try{if(blocked&&req.type==='XHS_GUARD')throw new AppError('PAGE_BLOCKED','合成安全验证');return buildOk(req.requestId,await manager.handle(req));}catch(e){return buildError(req.requestId,toErrorPayload(e));}});
 Object.values(shared.tabs).forEach(fn=>fn.mockClear());
 registerDiscoveryHandlers();const id=crypto.randomUUID();const sender={id:'test',url:'chrome-extension://test/sidepanel.html'};
 const classifySpy=vi.spyOn(provider,'classifyComments');
 const start=await handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:id,productId:product.id,tabId:7,direction:'AI PPT'}),sender);expect(start.ok,start.error?.message).toBe(true);
 for(let n=0;n<300;n++){const job=await repos.getJob(id);if(job?.discovery?.status!=='running' && job?.status!=='collecting')break;await new Promise(r=>setTimeout(r,5));}
 if(mode==='reply-timeout'){
   const job=await repos.getJob(id);expect(job?.discovery?.status).toBe('completed');expect(job?.discovery?.partialPosts).toBe(2);
   expect(job?.discovery?.trace?.filter(e=>e.event==='PAUSE')).toHaveLength(0);
   expect(job?.discovery?.comments).toBe(80);expect(await db.comments.count()).toBe(80);expect(clicked).toHaveLength(2);
   expect(classifySpy).not.toHaveBeenCalled();expect(await db.analyses.count()).toBe(0);
   const children=(await db.jobs.toArray()).filter(j=>j.kind==='comments');expect(children).toHaveLength(2);
   expect(children.every(j=>j.status==='partial'&&j.collection?.replyLoadWarningCount===1)).toBe(true);
   return;
 }
 if(mode==='incomplete'){
   const job=await repos.getJob(id);expect(job?.discovery?.status).toBe('completed');
   expect(job?.status).toBe('partial');expect(job?.discovery?.partialPosts).toBe(2);expect(job?.completedItems).toBe(2);
   expect(job?.discovery?.comments).toBe(80);expect(await db.comments.count()).toBe(80);
   const partialEvents=job?.discovery?.trace?.filter(e=>e.event==='POST_PARTIAL')??[];expect(partialEvents).toHaveLength(2);
   expect(partialEvents.every(e=>e.captureState==='partial'&&e.analysisState==='skipped_incomplete'&&!e.checkpoint.captureComplete&&!e.checkpoint.analysisComplete)).toBe(true);
   expect(job?.discovery?.completedNoteKeys).toHaveLength(2);
   expect(classifySpy).not.toHaveBeenCalled();expect(await db.analyses.count()).toBe(0);
   expect(clicked).toHaveLength(2);
   const children=(await db.jobs.toArray()).filter(j=>j.kind==='comments');
   expect(children).toHaveLength(2);expect(children.every(j=>j.status==='partial'&&j.errorCode==='INCOMPLETE_CAPTURE')).toBe(true);
   expect(children.every(j=>j.collection?.countStatus==='below_displayed_total')).toBe(true);
   expect(children.every(j=>j.collection?.budget?.durationMs===4500000)).toBe(true);
   return;
 }
 if(mode!=='normal') {
  const paused=await repos.getJob(id);expect(paused?.discovery?.status).toBe('paused');expect(clicked).toHaveLength(1);
  expect(()=>JobSchema.parse(paused)).not.toThrow();
  const firstSessionCount=shared.tabs.sendMessage.mock.calls.filter(([,r])=>r.type==='XHS_START_SESSION').length;
  expect(firstSessionCount).toBe(1);blocked=false;
  let control=handleBackgroundMessage;
  if(mode.endsWith('restored')){vi.resetModules();const restoredJobs=await import('../../src/discovery/jobs');control=(await import('../../src/messaging/handlers')).handleBackgroundMessage;restoredJobs.registerDiscoveryHandlers();}
   if(mode==='captured-stale-tab-live')currentTabId=9;const continued=await control(buildRequest('DISCOVERY_CONTROL',{jobId:id,action:'continue'}),sender);expect(continued.ok,continued.error?.message).toBe(true);
  for(let n=0;n<300;n++){if((await repos.getJob(id))?.discovery?.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
  if(mode==='captured-stale-tab-live'){const rebound=await repos.getJob(id);expect(rebound?.discovery?.sourceTabId).toBe(9);currentTabId=7;}
  // One capture per note, including after a real JobSchema/IndexedDB/background restore.
  expect(shared.tabs.sendMessage.mock.calls.filter(([,r])=>r.type==='XHS_START_SESSION')).toHaveLength(2);
 }
 const job=await repos.getJob(id);expect(job?.discovery?.status,JSON.stringify(job?.discovery)).toBe('completed');expect(job?.discovery?.comments).toBe(80);expect(job?.discovery?.leads).toBe(80);
 expect(shared.tabs.create).not.toHaveBeenCalled();expect(shared.tabs.update).not.toHaveBeenCalled();expect(clicked).toHaveLength(2);expect(shared.tabs.goBack).toHaveBeenCalledTimes(2);
 for(const note of ids){const comments=await repos.commentsForNote('xhs:'+note);expect(comments).toHaveLength(40);expect(comments.every(c=>c.noteKey==='xhs:'+note)).toBe(true);}
 expect(await db.analyses.count()).toBe(80);expect(shared.tabs.sendMessage.mock.calls.every(([,r])=>['XHS_CLICK_NOTE','XHS_SEARCH_STATE','XHS_DISCOVER','XHS_GUARD','XHS_GET_STATUS','XHS_START_SESSION','XHS_GET_SNAPSHOT','XHS_STOP_SESSION'].includes(r.type))).toBe(true);
 // 模拟后台中断：仍用同一jobs表保存有界队列；注册后台本身不得自动恢复。
 expect(()=>JobSchema.parse(job)).not.toThrow();
 const legacy=JobSchema.parse({...job,discovery:{...job!.discovery,deadline:Date.now()+600000,postElapsedMs:undefined}});expect(legacy.discovery?.postElapsedMs).toBe(0);expect('deadline' in legacy.discovery!).toBe(false);
 const prior=job!.discovery!;await repos.updateJob(id,{status:'collecting',discovery:{...prior,status:'running',index:1,post:{stage:'capturing',commentKeys:[]},postElapsedMs:1234,comments:40,leads:40,currentComments:0,currentLeads:0}});
 await repos.markInterruptedOnRecovery();expect((await repos.getJob(id))?.discovery?.status).toBe('paused');
 const beforeCalls=classifySpy.mock.calls.length;vi.resetModules();
 const restarted=await import('../../src/discovery/jobs');const messaging=await import('../../src/messaging/handlers');restarted.registerDiscoveryHandlers();
 expect(clicked).toHaveLength(2);
 if(mode==='captured-stale-tab-restored')currentTabId=9;const resume=await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_CONTROL',{jobId:id,action:'continue'}),sender);expect(resume.ok,resume.error?.message).toBe(true);
 for(let n=0;n<300;n++){const row=await repos.getJob(id);if(row?.discovery?.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
 const resumed=await repos.getJob(id);expect(resumed?.discovery?.status,JSON.stringify(resumed?.discovery)).toBe('completed');
 expect(resumed?.discovery?.comments).toBe(80);expect(resumed?.discovery?.leads).toBe(80);expect(resumed?.discovery?.postElapsedMs).toBe(0);if(mode==='captured-stale-tab-restored'){expect(resumed?.discovery?.sourceTabId).toBe(9);currentTabId=7;}
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
  if(mode==='normal') {
    // A paused old task must not require a manual Stop before starting a new task; the checkpoint and saved leads remain.
    const pausedId=crypto.randomUUID();blocked=false;
    const pauseStart=await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:pausedId,productId:product.id,tabId:7,direction:'AI PPT'}),sender);
    expect(pauseStart.ok,pauseStart.error?.message).toBe(true);
    blocked=true;
    let pausedRow=await repos.getJob(pausedId);
    for(let n=0;n<300&&pausedRow?.discovery?.status!=='paused';n++){await new Promise(r=>setTimeout(r,5));pausedRow=await repos.getJob(pausedId);}
    expect(pausedRow?.discovery?.status).toBe('paused');expect(pausedRow?.status).toBe('interrupted');
    blocked=false;
    const freshId=crypto.randomUUID();
    const freshStart=await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:freshId,productId:product.id,tabId:7,direction:'AI PPT'}),sender);
    expect(freshStart.ok,freshStart.error?.message).toBe(true);
    let freshRow=await repos.getJob(freshId);
    for(let n=0;n<1000&&freshRow?.discovery?.status!=='completed'&&freshRow?.discovery?.status!=='paused';n++){await new Promise(r=>setTimeout(r,5));freshRow=await repos.getJob(freshId);}
    expect(freshRow?.discovery?.status,JSON.stringify(freshRow?.discovery)).toBe('completed');
    const preservedPaused=await repos.getJob(pausedId);expect(preservedPaused?.discovery?.status).toBe('paused');expect(preservedPaused?.status).toBe('interrupted');
    // Also cover the reported case where the previous task is still running when the user starts another.
    const activeId=crypto.randomUUID();
    const activeStart=await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:activeId,productId:product.id,tabId:7,direction:'AI PPT'}),sender);
    expect(activeStart.ok,activeStart.error?.message).toBe(true);
    let activeRow=await repos.getJob(activeId);
    for(let n=0;n<100&&activeRow?.discovery?.status!=='running';n++){await new Promise(r=>setTimeout(r,2));activeRow=await repos.getJob(activeId);}
    expect(activeRow?.discovery?.status).toBe('running');
    const switchId=crypto.randomUUID();
    const switchStart=await messaging.handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:switchId,productId:product.id,tabId:7,direction:'AI PPT'}),sender);
    expect(switchStart.ok,switchStart.error?.message).toBe(true);
    const autoPaused=await repos.getJob(activeId);
    expect(autoPaused?.discovery?.status).toBe('paused');expect(autoPaused?.status).toBe('interrupted');
    let switchRow=await repos.getJob(switchId);
    for(let n=0;n<1000&&switchRow?.discovery?.status!=='completed'&&switchRow?.discovery?.status!=='paused';n++){await new Promise(r=>setTimeout(r,5));switchRow=await repos.getJob(switchId);}
    expect(switchRow?.discovery?.status,JSON.stringify(switchRow?.discovery)).toBe('completed');
    expect(await db.comments.count()).toBe(80);expect(await db.analyses.count()).toBe(80);
  }
  await expect(repos.saveCaptureDelta(crypto.randomUUID(),{noteKey:'invalid'} as never,[],new AbortController().signal)).rejects.toBeInstanceOf(AppError);
},30000);

it.each(['delayed-search','missing-history'])('500 capture → AI → saved completion → %s → second capture, without Continue or pause',async mode=>{
 vi.resetModules();const {registerDiscoveryHandlers}=await import('../../src/discovery/jobs');const {handleBackgroundMessage}=await import('../../src/messaging/handlers');
 db=new SeekLeadDb('discovery-500-'+crypto.randomUUID());const repos=new Repositories(db);
 const claim={value:null,status:'unknown',evidence:[]};
 const provider=new MockProvider({profile:()=>({schemaVersion:1,name:claim,category:claim,summary:claim,capabilities:[],targetAudience:[],needsServed:[],exclusions:[],accessMethod:claim,price:claim,purchaseChannel:claim,searchSuggestions:['AI PPT']})});
 shared.deps={repos,lock:new TaskLockManager(repos),provider,providerName:'mock',modelId:'mock',retryDelayMs:0};
 const product=await runProfileGeneration(shared.deps,{inputUrl:'https://example.com',finalUrl:'https://example.com',blocks:[{id:'b001',url:'https://example.com',text:'合成产品',fetchedAt:new Date().toISOString()}]});
 const source='https://www.xiaohongshu.com/search_result?keyword=AI';let currentUrl=source;let returning=false,backs=0;const clicked:string[]=[],captured:string[]=[];
 function renderSearch(){manager?.dispose();currentUrl=source;returning=false;history.replaceState({},'',source);
  document.body.innerHTML=ids.map(id=>`<section class="note-item"><a class="cover" href="/explore/${id}?source=synthetic">note</a></section>`).join('');
  document.querySelectorAll<HTMLAnchorElement>('a.cover').forEach(a=>a.onclick=e=>{e.preventDefault();clicked.push(a.href);renderNote(a.href);});manager=new XhsSessionManager(()=>document);
 }
 function renderNote(url:string){manager?.dispose();currentUrl=url;history.replaceState({},'',url);
  document.body.innerHTML=`<div class="note-detail-mask"><div id="noteContainer"><h1 id="detail-title">合成笔记</h1><div id="detail-desc">合成正文</div><div class="scroller" style="overflow-y:auto"><div class="comments-el"><div class="list-container">${items(1,url.includes(ids[0]!)?500:1)}</div></div></div></div><div class="close-circle"><div class="close"></div></div></div>`;
  document.querySelector<HTMLElement>('.close')!.onclick=()=>{currentUrl=source;returning=true;history.replaceState({},'',source);};
  const scroller=document.querySelector<HTMLElement>('.scroller')!;Object.defineProperties(scroller,{clientHeight:{value:500},scrollHeight:{value:500}});scroller.scrollBy=()=>{};
  manager=new XhsSessionManager(()=>document);
 }
 renderSearch();Object.values(shared.tabs).forEach(fn=>fn.mockReset());
  shared.tabs.get.mockImplementation(async()=>({id:7,url:currentUrl,status:'complete'}));
 shared.tabs.goBack.mockImplementation(async()=>{backs++;if(mode==='missing-history')throw new Error('Cannot find a next page in history.');currentUrl=source;returning=true;history.replaceState({},'',source);});
 let transientReads=0;
 shared.tabs.sendMessage.mockImplementation(async(_id,raw)=>{
  const req=RequestSchema.parse(raw);
  try{
   if(req.type==='XHS_SEARCH_STATE'&&returning){
    if(++transientReads%2===1)return buildOk(req.requestId,{sourceUrl:source,isSearch:true,hasNote:true});
    renderSearch();
   }
   if(req.type==='XHS_START_SESSION')captured.push(currentUrl);
   return buildOk(req.requestId,await manager.handle(req));
  }catch(e){return buildError(req.requestId,toErrorPayload(e));}
 });
 const id=crypto.randomUUID();registerDiscoveryHandlers();const sender={id:'test',url:'chrome-extension://test/sidepanel.html'};
 expect((await handleBackgroundMessage(buildRequest('DISCOVERY_START',{jobId:id,productId:product.id,tabId:7,direction:'AI PPT'}),sender)).ok).toBe(true);
 let job=await repos.getJob(id);
 for(let deadline=Date.now()+80000;Date.now()<deadline&&job?.discovery?.status!=='completed'&&job?.discovery?.status!=='paused';){await new Promise(r=>setTimeout(r,50));job=await repos.getJob(id);}
 expect(job?.discovery?.status,JSON.stringify(job?.discovery)).toBe('completed');
 const trace=job!.discovery!.trace!;
 expect(trace.filter(e=>e.event==='PAUSE')).toHaveLength(0);
 expect(clicked).toHaveLength(2);expect(captured).toHaveLength(2);expect(new URL(captured[1]!).pathname).toBe('/explore/'+ids[1]);expect(backs).toBe(2);
 const second=trace.find(e=>e.event==='CAPTURE_START'&&e.postIndex===1)!;expect(second.taskState).toBe('running');expect(second.postKey).toBe('xhs:'+ids[1]);expect(second.navigation.resolvedPostKey).toBe(second.postKey);
 const complete=trace.findIndex(e=>e.event==='POST_COMPLETE'&&e.postIndex===0);
 const next=trace.findIndex(e=>e.event==='CAPTURE_START'&&e.postIndex===1);
 expect(complete).toBeGreaterThan(0);expect(next).toBeGreaterThan(complete);expect(trace[complete]!.checkpoint.analysisComplete).toBe(true);
 expect(await repos.commentsForNote('xhs:'+ids[0])).toHaveLength(500);expect(await repos.commentsForNote('xhs:'+ids[1])).toHaveLength(1);expect(await db.analyses.count()).toBe(501);
 expect(()=>JobSchema.parse(job)).not.toThrow();expect(JSON.stringify(trace)).not.toMatch(/source=synthetic|xsec_token|需要购买PPT/);
 expect(shared.tabs.create).not.toHaveBeenCalled();expect(shared.tabs.update).not.toHaveBeenCalled();
 expect(shared.tabs.sendMessage.mock.calls.filter(([,r])=>r.type==='XHS_CLOSE_NOTE')).toHaveLength(mode==='missing-history'?2:0);
},90000);
