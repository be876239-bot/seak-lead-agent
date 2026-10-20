import { z } from 'zod';
import { browser } from 'wxt/browser';
import { analysisRepos, baseJob, makeDeps } from '../analysis/jobs';
import { runCommentsJob } from '../analysis/runner';
import { COMMENT_PROMPT_VERSION } from '../ai/prompts';
import { AppError, toErrorPayload } from '../domain/errors';
import { requireConfirmedProduct } from '../product/research';
import { LIMITS } from '../domain/limits';
import { registerSensitiveHandler } from '../messaging/handlers';
import { buildRequest } from '../messaging/protocol';
import { ask, captureIncompleteReason, captureNote } from '../xhs/capture';
import { noteKeyFromUrl, noteUrl } from '../xhs/discovery-dom';
import { sameSearch } from '../xhs/navigation';
import { SerialDiscovery } from './serial';
import { DiscoveryBrowser, assertRunning, wait } from './browser';
import type {DiscoveryTrace} from '../domain/schemas';

let current: {id:string; task:SerialDiscovery;page:DiscoveryBrowser} | null=null;
let starting=false;

type ResumeTabCandidate = {id:number;url:string;active?:boolean};

/** Resolve a persisted task's browser tab by its saved search URL / expected note identity.
 * Tab IDs are session-local and may change after the browser or window is reopened.
 */
async function resolveResumeTabId(saved:import('../domain/schemas').Job):Promise<number> {
  const discovery=saved.discovery;
  const navigation=discovery?.navigation;
  if(!discovery || !navigation)throw new AppError('PAGE_CHANGED','旧任务缺少可验证的搜索页面信息，无法安全恢复。请从搜索结果页启动新任务；历史线索会保留。');
  const expectedKey=navigation.expectedNoteKey
    ?? (navigation.phase==='search'?null:noteKeyFromUrl(discovery.targets[discovery.index]??''));
  const isSearch=(url:string)=>sameSearch(url,navigation.sourceUrl);
  const isExpectedNote=(url:string)=>!!expectedKey&&!!noteUrl(url)&&noteKeyFromUrl(url)===expectedKey;
  const matches=(tab:{id?:number;url?:string|null;active?:boolean}|null|undefined):tab is {id:number;url:string;active?:boolean}=>!!tab
    &&typeof tab.id==='number'&&typeof tab.url==='string'&&(isSearch(tab.url)||isExpectedNote(tab.url));

  const candidates=new Map<number,ResumeTabCandidate>();
  const add=(tab:{id?:number;url?:string|null;active?:boolean}|null|undefined)=>{
    if(!matches(tab))return;
    candidates.set(tab.id!,{id:tab.id!,url:tab.url!,active:tab.active});
  };
  // Query current Xiaohongshu tabs first; the stored tab ID may no longer exist.
  try {
    const tabs=await browser.tabs.query({url:'https://www.xiaohongshu.com/*'});
    for(const tab of tabs)add(tab);
  } catch {
    // A still-existing original tab can be checked below even if querying is unavailable.
  }
  try { add(await browser.tabs.get(discovery.sourceTabId)); } catch { /* stale tab ID after restart */ }

  const all=[...candidates.values()];
  if(!all.length)throw new AppError('PAGE_CHANGED','找不到上次任务对应的小红书页面。请先在 Edge 中打开原来的搜索结果页，或上次正在处理的那篇笔记，确认已登录且扩展有小红书站点访问权限，再点击“继续上次任务”。任务进度和已保存线索不会删除。');

  // Prefer the page implied by the last saved navigation checkpoint.
  const preferSearch=navigation.phase==='search'||navigation.phase==='returning';
  const preferred=all.filter(tab=>preferSearch?isSearch(tab.url):isExpectedNote(tab.url));
  const pool=preferred.length?preferred:all;
  if(pool.length===1)return pool[0]!.id;
  const active=pool.filter(tab=>tab.active);
  if(active.length===1)return active[0]!.id;
  throw new AppError('PAGE_CHANGED','找到多个可能的上次任务页面，无法安全判断。请切换到原任务对应的小红书标签页；如果仍有多个匹配页面，请只保留一个后再点击继续。任务进度和历史线索会保留。');
}

async function launch(spec:{jobId:string;productId:string;tabId:number;direction:string;urls:string[];sourceUrl:string;maxPosts:number},restored?:import('../domain/schemas').Job) {
  const {jobId,productId,tabId,direction,urls,sourceUrl,maxPosts}=spec;
  const deps=await makeDeps();const product=await analysisRepos.getProduct(productId);
  if(!product || (restored && (product.profileVersion!==restored.profileVersion || deps.modelId!==restored.modelId || deps.providerName!==restored.provider)))throw new AppError('PAGE_CHANGED','产品画像或模型已变化，请启动新任务');
  if(restored&&!restored.discovery?.navigation)throw new AppError('PAGE_CHANGED','旧版直接URL任务不能自动转换历史，请停止旧任务并从搜索页启动新任务');
  const page=new DiscoveryBrowser(tabId,restored?.discovery?.navigation??{mode:'dom-click-v1',sourceUrl,phase:'search',expectedNoteKey:null},state=>analysisRepos.updateDiscoveryNavigation(jobId,state));
  let trace:DiscoveryTrace[]=[...(restored?.discovery?.trace??[])];

  const task=new SerialDiscovery(urls,{
    observe:()=>({phase:page.navigation.phase,expectedNoteKey:page.navigation.expectedNoteKey,...page.observation}),
    betweenPosts:signal=>wait(LIMITS.discoveryPostGapMs,signal),
    now:()=>Date.now(),navigate:(url,signal)=>page.navigate(url,signal),ready:(url,signal)=>page.ready(url,signal),finish:signal=>page.returnToSearch(signal),guard:async()=>{const latest=await analysisRepos.getProduct(productId);if(!latest||latest.profileVersion!==product.profileVersion)throw new AppError('PAGE_CHANGED','产品画像变化，请重新启动任务');await page.guard();},
    changed:async (state,event)=>{
      if(event){
        const url=urls[state.index];const stage=state.post?.stage??'capturing';
        const row:DiscoveryTrace={event:event.name,at:event.at,source:event.source,runId:event.runId,taskId:jobId,postIndex:state.index,
          postKey:url?noteKeyFromUrl(url):null,postUrl:url?new URL(url).origin+new URL(url).pathname:null,phase:state.phase,taskState:state.status,
          captureState:stage==='capturing'?'incomplete':stage==='partial'?'partial':'completed',analysisState:stage==='completed'?'completed':stage==='captured'?'pending_or_running':stage==='partial'?'skipped_incomplete':'pending',pauseReason:state.reason,commentCount:state.currentComments,
          checkpoint:{stage,captureComplete:stage==='captured'||stage==='completed',analysisComplete:stage==='completed'},navigation:event.navigation??{phase:page.navigation.phase,expectedNoteKey:page.navigation.expectedNoteKey,...page.observation}};
        const previous=trace.at(-1);
        if(event.name.endsWith('_PROGRESS')&&previous?.event===event.name&&previous.postIndex===state.index&&previous.runId===event.runId)trace=trace.slice(0,-1);
        trace=[...trace,row].slice(-200);
      }
      const stage=state.post?.stage;
      const processedCount=state.index+(stage==='completed'||stage==='partial'?1:0);
      await analysisRepos.updateJob(jobId,{
        status:state.status==='running'?'collecting':state.status==='paused'?'interrupted':state.status==='stopped'?'cancelled':(state.partialPosts??0)>0?'partial':'completed',
        tabId:page.tabId,completedItems:processedCount,discovery:{...state,trace,direction,targets:urls,sourceTabId:tabId,navigation:{...page.navigation},completedNoteKeys:urls.slice(0,processedCount).map(noteKeyFromUrl)},
      });
    },
    process:async(url,signal,progress,checkpoint)=>{
      const expected=noteKeyFromUrl(url);const childId=crypto.randomUUID();
      const processingIndex=task.state.index;
      await analysisRepos.createJob({...baseJob(deps,childId),kind:'comments',status:'collecting',productId,tabId:page.tabId,noteKey:expected,promptVersion:COMMENT_PROMPT_VERSION});
      let acceptingProgress=true;
      try {
        const storedComments=await analysisRepos.commentsForNote(expected);
        const initialComments=storedComments.slice(0,LIMITS.maxSessionComments);
        const restoredNote=checkpoint.post?.stage==='captured'?await analysisRepos.getNote(expected):null;
        const savedComments=checkpoint.post?.stage==='captured'?checkpoint.post.commentKeys.map(key=>storedComments.find(c=>c.commentKey===key)):[];
        if(checkpoint.post?.stage==='captured' && (!restoredNote || savedComments.some(c=>!c)))throw new AppError('STORAGE_ERROR','已完成采集的本地快照不完整，请检查本地数据后重新启动任务');
        checkpoint.event(checkpoint.post?.stage==='captured'?'CAPTURE_REUSED':'CAPTURE_START');
        const snap=checkpoint.post?.stage==='captured'?{noteKey:expected,note:restoredNote!,comments:savedComments.filter((c):c is NonNullable<typeof c>=>!!c),stopReason:undefined,displayedCommentCount:checkpoint.post.captureBudget?.displayedCommentCount,truncated:false,replyLoadWarningCount:checkpoint.post.replyLoadWarnings?.length??0}:await captureNote(page.tabId!,{autoLoad:true,signal,initialComments,initialBudget:checkpoint.post?.captureBudget,onBudget:checkpoint.budget,initialReplyLoadWarnings:checkpoint.post?.replyLoadWarnings,onReplyLoadWarnings:checkpoint.warnings,
          onDelta:async(note,comments)=>{
            assertRunning(signal);if(note.noteKey!==expected || comments.some(c=>c.noteKey!==expected))throw new AppError('PAGE_CHANGED','评论与任务笔记不一致，拒绝落库');
            await analysisRepos.saveCaptureDelta(childId,note,comments,signal);
          },
          onProgress:async collection=>{
            const active=()=>acceptingProgress&&!signal.aborted&&task.state.index===processingIndex&&task.state.post?.stage!=='completed'&&task.state.post?.stage!=='partial';
            if(!active())return;await analysisRepos.updateJob(childId,{collection});
            if(!active())return;await analysisRepos.updateJob(jobId,{collection});
            if(active())progress(collection.discoveredCount,0,`${collection.loadingReplies?'正在加载回复':collection.loading?'正在加载评论':'正在累计评论'}……本轮新增 ${collection.addedCount} 条`);
          },
        });
        assertRunning(signal);if(snap.noteKey!==expected)throw new AppError('PAGE_CHANGED','采集笔记不一致');
        const incompleteReason=captureIncompleteReason(snap);
        if(incompleteReason){
          acceptingProgress=false;
          await analysisRepos.updateJob(childId,{status:'partial',totalItems:0,errorCode:'INCOMPLETE_CAPTURE'});
          checkpoint.event('ANALYSIS_SKIPPED_INCOMPLETE');
          progress(snap.comments.length,0,incompleteReason);
          await checkpoint.partial(snap.comments.map(c=>c.commentKey));
          return;
        }
        await checkpoint.captured(snap.comments.map(c=>c.commentKey));
        await page.guard();assertRunning(signal);progress(snap.comments.length,0,'正在分析评论……');checkpoint.event('ANALYSIS_START');
        const refreshLeads=async()=>{
          const analyses=await analysisRepos.analysesFor(productId,snap.comments.map(c=>c.commentKey));
          if(!acceptingProgress || signal.aborted)return;
          const leads=new Set(analyses.filter(a=>a.group==='high_intent'||a.group==='need').map(a=>a.commentKey)).size;
          progress(snap.comments.length,leads,'正在分析评论，已保存批次结果……');
        };
        let analysisFailureSummary: string | undefined;
        const result=await runCommentsJob(deps,{productId,note:snap.note,comments:snap.comments,jobId:childId,tabId:page.tabId,signal,log:(message)=>{if(/^批次 \d+\/\d+ 失败：/.test(message))analysisFailureSummary=message.slice(0,220);},onProgress:()=>{void refreshLeads().catch(()=>{});}});
        await refreshLeads();
        assertRunning(signal);
        if(result.status!=='completed')throw new AppError('PARSE_FAILED',`分析未完成（${result.errorCode??result.status}），已保存结果保留，请人工检查${analysisFailureSummary ? `；${analysisFailureSummary}` : ''}`);
        checkpoint.event('ANALYSIS_COMPLETE');
        const analyses=await analysisRepos.analysesFor(productId,snap.comments.map(c=>c.commentKey));
        const leads=new Set(analyses.filter(a=>a.group==='high_intent'||a.group==='need').map(a=>a.commentKey)).size;
        progress(snap.comments.length,leads,'本帖分析完成，结果已保存到线索');
        await checkpoint.completed();
      } catch(e) {
        const child=await analysisRepos.getJob(childId);
        if(child && ['created','collecting','analyzing'].includes(child.status))await analysisRepos.updateJob(childId,{status:signal.aborted?'cancelled':'failed',errorCode:toErrorPayload(e).code});
        throw e;
      }finally{acceptingProgress=false;}
    },
  },restored?.discovery,maxPosts);
  if(!restored)await analysisRepos.createJob({...baseJob(deps,jobId),ownerId:crypto.randomUUID(),kind:'discovery',productId,profileVersion:product.profileVersion,status:'collecting',totalItems:urls.length,discovery:{...task.state,direction,targets:urls,sourceTabId:tabId,navigation:{...page.navigation},completedNoteKeys:[]}});
  // Publish the pending runner before awaiting page reconciliation so Stop/Pause can still control it.
  current={id:jobId,task,page};
  if(restored){task.recordControl('continue');await task.flush();await page.reconcile(urls[task.state.index]?noteKeyFromUrl(urls[task.state.index]!):undefined);}
  void task.run().catch(()=>task.stop('本地存储异常，任务已停止'));
}
export function registerDiscoveryHandlers() {
  registerSensitiveHandler('DISCOVERY_START',async req=>{
    if(req.type!=='DISCOVERY_START')throw new Error('类型错误');
    if(starting)throw new AppError('LOCK_HELD','另一个任务正在启动，请稍后再试。');
    starting=true;
    try {
      const {jobId,productId,tabId,direction,maxPosts}=req.payload;
      const product=await analysisRepos.getProduct(productId);
      if(!product) throw new AppError('PAGE_CHANGED','产品不存在，请回到产品页检查。');
      requireConfirmedProduct(product);
      if(!product.profile.searchSuggestions.includes(direction))throw new AppError('PAGE_CHANGED','请选择当前产品画像中的搜索方向');
      // Starting a new task explicitly means switching away from the previous one.
      // Pause and drain it safely, but keep its checkpoint, comments, and leads in IndexedDB.
      const previous=current;
      if(previous) {
        if(previous.task.state.status==='running') {
          previous.task.recordControl('pause');
          previous.task.pause('已切换到新任务；上次任务已自动暂停，已保存进度和线索保留','new-task');
        }
        let drainTimer:ReturnType<typeof setTimeout>|undefined;
        try {
          await Promise.race([
            previous.task.drained(),
            new Promise<never>((_,reject)=>{drainTimer=setTimeout(()=>reject(new AppError('LOCK_HELD','上一个任务还在安全收尾，请等几秒后再开始。已保存的评论和线索不会删除。')),5000);}),
          ]);
        } finally { if(drainTimer)clearTimeout(drainTimer); }
        await previous.task.flush();
        if(previous.task.state.reason?.includes('本地存储异常'))throw new AppError('STORAGE_ERROR','上一个任务遇到本地保存错误，已停止。请先检查存储状态；不会删除已有线索。');
        // When reusing the same tab, safely reconcile any half-finished navigation
        // and return to the original search page using normal browser interaction.
        if(previous.page.tabId===tabId) {
          try {
            await previous.page.reconcile();
            if(previous.page.navigation.phase!=='search')await previous.page.returnToSearch(new AbortController().signal);
          } catch {
            throw new AppError('PAGE_CHANGED','上次任务已暂停并保存，但页面还没回到搜索结果页。请手动回到原搜索结果页，再开始新任务；历史评论和线索不会删除。');
          }
        }
        if(current===previous) {
          if(['paused','stopped','completed'].includes(previous.task.state.status))current=null;
          else throw new AppError('LOCK_HELD','上一个任务还没有安全退出，请稍后再试。已保存的评论和线索不会删除。');
        }
      }
      const response=z.object({sourceUrl:z.string().url().max(2048),urls:z.array(z.string().max(2048)).min(1).max(100)}).parse(await ask(tabId,buildRequest('XHS_DISCOVER',{maxPosts})));
      if(response.urls.some(url=>!noteUrl(url)))throw new AppError('URL_INVALID','搜索结果含不支持的链接');
      await launch({jobId,productId,tabId,direction,urls:response.urls,sourceUrl:response.sourceUrl,maxPosts});
      return {jobId};
    }finally{starting=false;}
  });
  registerSensitiveHandler('DISCOVERY_REPROCESS_POST', async req => {
    if (req.type !== 'DISCOVERY_REPROCESS_POST') throw new Error('类型错误');
    if (starting) throw new AppError('LOCK_HELD', '另一个任务正在启动，请稍后再试。');
    starting = true;
    try {
      const parent = await analysisRepos.getJob(req.payload.parentJobId);
      if (!parent?.discovery || !parent.productId) throw new AppError('PAGE_CHANGED', '找不到原批量任务，无法安全重试该帖子。');
      if (!['completed', 'stopped'].includes(parent.discovery.status)
        || !['completed', 'partial', 'cancelled', 'interrupted'].includes(parent.status)) {
        throw new AppError('LOCK_HELD', '请先完成或停止原批量任务，再重新处理其中的帖子。原任务进度会保留。');
      }
      const canonicalUrl = noteUrl(req.payload.postUrl);
      if (!canonicalUrl) throw new AppError('URL_INVALID', '这不是受支持的小红书笔记链接。');
      const noteKey = noteKeyFromUrl(canonicalUrl);
      if (!parent.discovery.targets.some(url => noteKeyFromUrl(url) === noteKey)) {
        throw new AppError('PERMISSION_DENIED', '该笔记不属于所选批量任务，不能从此任务重试。');
      }
      const product = await analysisRepos.getProduct(parent.productId);
      if (!product) throw new AppError('STORAGE_ERROR', '原任务关联的产品已不存在。');
      if (parent.profileVersion !== product.profileVersion) {
        throw new AppError('PAGE_CHANGED', '产品画像已更新。为避免新旧画像结果混淆，请使用当前画像重新启动一轮批量搜索。');
      }
      const sourceUrl = parent.discovery.navigation?.sourceUrl;
      if (!sourceUrl) throw new AppError('PAGE_CHANGED', '原任务没有保存可验证的搜索结果页地址，无法安全重新处理。');
      if (current && current.id !== parent.id && !['completed', 'stopped'].includes(current.task.state.status)) {
        throw new AppError('LOCK_HELD', '另一个批量任务仍在运行或暂停中。请先结束它，再重试此帖子。');
      }

      const tabs = await browser.tabs.query({ url: 'https://www.xiaohongshu.com/search_result*' });
      const matching = tabs.filter(tab => typeof tab.id === 'number' && typeof tab.url === 'string' && sameSearch(tab.url, sourceUrl));
      if (!matching.length) {
        throw new AppError('PAGE_CHANGED', '找不到原任务对应的搜索结果页。请先回到原来的小红书搜索结果页，再重试此帖子；已保存的评论和线索不会删除。');
      }
      const active = matching.filter(tab => tab.active);
      const selected = active.length === 1 ? active[0] : matching.length === 1 ? matching[0] : null;
      if (!selected || typeof selected.id !== 'number') {
        throw new AppError('PAGE_CHANGED', '找到多个匹配的搜索结果标签页，无法安全选择。请只保留一个原搜索结果页后重试。');
      }

      await launch({
        jobId: req.payload.jobId,
        productId: parent.productId,
        tabId: selected.id,
        direction: parent.discovery.direction,
        urls: [canonicalUrl],
        sourceUrl,
        maxPosts: 1,
      });
      return { jobId: req.payload.jobId };
    } finally {
      starting = false;
    }
  });

  registerSensitiveHandler('DISCOVERY_CONTROL',async req=>{
    if(req.type!=='DISCOVERY_CONTROL')throw new Error('类型错误');
    if(current?.id===req.payload.jobId)current.task.recordControl(req.payload.action);
    // 暂停/停止优先于继续等待：旧请求尚在退出时也不能锁死用户的停止按钮。
    if(current?.id===req.payload.jobId && req.payload.action!=='continue') {
      if(req.payload.action==='stop')current.task.stop();else current.task.pause();
      await current.task.flush();return {jobId:current.id};
    }
    if(current?.id===req.payload.jobId && current.task.state.status==='running')return {jobId:current.id};
    if(starting)throw new AppError('LOCK_HELD','任务正在启动，请稍后操作');
    starting=true;
    try {
    if(current?.id!==req.payload.jobId) {
      const saved=await analysisRepos.getJob(req.payload.jobId);
      if(!saved?.discovery || !saved.productId)throw new AppError('PAGE_CHANGED','任务不存在');
      if(current && !['completed','stopped'].includes(current.task.state.status))throw new AppError('LOCK_HELD','已有其他寻找任务');
      if(req.payload.action==='stop') {await analysisRepos.updateJob(saved.id,{status:'cancelled',discovery:{...saved.discovery,status:'stopped',reason:'用户停止任务',phase:'任务已停止'}});return {jobId:saved.id};}
      if(req.payload.action!=='continue')return {jobId:saved.id};
      if(['completed','cancelled'].includes(saved.status))throw new AppError('CANCELLED','任务已结束，请重新启动');
      // No task-wide deadline: an explicit Continue resumes the saved checkpoint. The per-post active timer excludes paused time.
      const resumeTabId=await resolveResumeTabId(saved);
      await launch({jobId:saved.id,productId:saved.productId,tabId:resumeTabId,direction:saved.discovery.direction,urls:saved.discovery.targets,sourceUrl:saved.discovery.navigation?.sourceUrl??'https://www.xiaohongshu.com/search_result',maxPosts:saved.discovery.total},saved);
      return {jobId:saved.id};
    }
    if(req.payload.action==='stop')current.task.stop();
    else if(req.payload.action==='pause')current.task.pause();
    else {
      const paused=current;
      if(paused.task.state.status!=='paused')throw new AppError('CANCELLED','这个任务已经结束，不能继续。请开始新任务；历史线索会保留。');
      await paused.task.drained();await paused.task.flush();
      // Stop may arrive while Continue is waiting for the old runner to drain.
      if(paused.task.state.status!=='paused')return {jobId:paused.id};
      const saved=await analysisRepos.getJob(paused.id);
      if(!saved?.discovery||!saved.productId)throw new AppError('PAGE_CHANGED','找不到已保存的任务进度，历史线索不会删除。');
      const resumeTabId=await resolveResumeTabId(saved);
      await launch({jobId:saved.id,productId:saved.productId,tabId:resumeTabId,direction:saved.discovery.direction,urls:saved.discovery.targets,sourceUrl:saved.discovery.navigation?.sourceUrl??'https://www.xiaohongshu.com/search_result',maxPosts:saved.discovery.total},saved);
      return {jobId:paused.id};
    }
    await current.task.flush();return {jobId:current.id};
    }finally{starting=false;}
  });
}
