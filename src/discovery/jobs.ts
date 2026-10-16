import { z } from 'zod';
import { analysisRepos, baseJob, makeDeps } from '../analysis/jobs';
import { runCommentsJob } from '../analysis/runner';
import { COMMENT_PROMPT_VERSION } from '../ai/prompts';
import { AppError, toErrorPayload } from '../domain/errors';
import { registerSensitiveHandler } from '../messaging/handlers';
import { buildRequest } from '../messaging/protocol';
import { ask, captureNote } from '../xhs/capture';
import { noteKeyFromUrl, noteUrl } from '../xhs/discovery-dom';
import { SerialDiscovery } from './serial';
import { DiscoveryBrowser, assertRunning } from './browser';

let current: {id:string; task:SerialDiscovery;page:DiscoveryBrowser} | null=null;
let starting=false;
async function launch(spec:{jobId:string;productId:string;tabId:number;direction:string;urls:string[];sourceUrl:string},restored?:import('../domain/schemas').Job) {
  const {jobId,productId,tabId,direction,urls,sourceUrl}=spec;
  const deps=await makeDeps();const product=await analysisRepos.getProduct(productId);
  if(!product || (restored && (product.profileVersion!==restored.profileVersion || deps.modelId!==restored.modelId || deps.providerName!==restored.provider)))throw new AppError('PAGE_CHANGED','产品画像或模型已变化，请启动新任务');
  if(restored&&!restored.discovery?.navigation)throw new AppError('PAGE_CHANGED','旧版直接URL任务不能自动转换历史，请停止旧任务并从搜索页启动新任务');
  const page=new DiscoveryBrowser(tabId,restored?.discovery?.navigation??{mode:'dom-click-v1',sourceUrl,phase:'search',expectedNoteKey:null},state=>analysisRepos.updateDiscoveryNavigation(jobId,state));

  const task=new SerialDiscovery(urls,{
    now:()=>Date.now(),navigate:(url,signal)=>page.navigate(url,signal),ready:(url,signal)=>page.ready(url,signal),finish:signal=>page.returnToSearch(signal),guard:async()=>{const latest=await analysisRepos.getProduct(productId);if(!latest||latest.profileVersion!==product.profileVersion)throw new AppError('PAGE_CHANGED','产品画像变化，请重新启动任务');await page.guard();},
    changed:async state=>{
      await analysisRepos.updateJob(jobId,{
        status:state.status==='running'?'collecting':state.status==='paused'?'interrupted':state.status==='stopped'?'cancelled':'completed',
        tabId:page.tabId,completedItems:state.index,discovery:{...state,direction,targets:urls,sourceTabId:tabId,navigation:{...page.navigation},completedNoteKeys:urls.slice(0,state.index).map(noteKeyFromUrl)},
      });
    },
    process:async(url,signal,progress)=>{
      const expected=noteKeyFromUrl(url);const childId=crypto.randomUUID();
      await analysisRepos.createJob({...baseJob(deps,childId),kind:'comments',status:'collecting',productId,tabId:page.tabId,noteKey:expected,promptVersion:COMMENT_PROMPT_VERSION});
      let acceptingProgress=true;
      try {
        const initialComments=(await analysisRepos.commentsForNote(expected)).slice(0,500);
        const snap=await captureNote(page.tabId!,{autoLoad:true,signal,initialComments,
          onDelta:async(note,comments)=>{
            assertRunning(signal);if(note.noteKey!==expected || comments.some(c=>c.noteKey!==expected))throw new AppError('PAGE_CHANGED','评论与任务笔记不一致，拒绝落库');
            await analysisRepos.saveCaptureDelta(childId,note,comments,signal);
          },
          onProgress:async collection=>{if(signal.aborted)return;await analysisRepos.updateJob(childId,{collection});await analysisRepos.updateJob(jobId,{collection});progress(collection.discoveredCount,0,`${collection.loadingReplies?'正在加载回复':collection.loading?'正在加载评论':'正在累计评论'}……本轮新增 ${collection.addedCount} 条`);},
        });
        assertRunning(signal);if(snap.noteKey!==expected)throw new AppError('PAGE_CHANGED','采集笔记不一致');
        if(snap.stopReason==='time_limit'||snap.stopReason==='round_limit')throw new AppError('PARSE_FAILED','评论加载达到时间/轮次上限，请人工检查后继续');
        await page.guard();assertRunning(signal);progress(snap.comments.length,0,'正在分析评论……');
        const refreshLeads=async()=>{
          const analyses=await analysisRepos.analysesFor(productId,snap.comments.map(c=>c.commentKey));
          if(!acceptingProgress || signal.aborted)return;
          const leads=new Set(analyses.filter(a=>a.group==='high_intent'||a.group==='need').map(a=>a.commentKey)).size;
          progress(snap.comments.length,leads,'正在分析评论，已保存批次结果……');
        };
        const result=await runCommentsJob(deps,{productId,note:snap.note,comments:snap.comments,jobId:childId,tabId:page.tabId,signal,onProgress:()=>{void refreshLeads().catch(()=>{});}});
        await refreshLeads();
        assertRunning(signal);
        if(result.status!=='completed')throw new AppError('PARSE_FAILED',`分析未完成（${result.errorCode??result.status}），已保存结果保留，请人工检查`);
        const analyses=await analysisRepos.analysesFor(productId,snap.comments.map(c=>c.commentKey));
        const leads=new Set(analyses.filter(a=>a.group==='high_intent'||a.group==='need').map(a=>a.commentKey)).size;
        progress(snap.comments.length,leads,'本帖分析完成，结果已保存到线索');
      } catch(e) {
        const child=await analysisRepos.getJob(childId);
        if(child && ['created','collecting','analyzing'].includes(child.status))await analysisRepos.updateJob(childId,{status:signal.aborted?'cancelled':'failed',errorCode:toErrorPayload(e).code});
        throw e;
      }finally{acceptingProgress=false;}
    },
  },restored?.discovery);
  if(!restored)await analysisRepos.createJob({...baseJob(deps,jobId),ownerId:crypto.randomUUID(),kind:'discovery',productId,profileVersion:product.profileVersion,status:'collecting',totalItems:urls.length,discovery:{...task.state,direction,targets:urls,sourceTabId:tabId,navigation:{...page.navigation},completedNoteKeys:[]}});
  if(restored)await page.reconcile(urls[task.state.index]?noteKeyFromUrl(urls[task.state.index]!):undefined);
  current={id:jobId,task,page};void task.run().catch(()=>task.stop('本地存储异常，任务已停止'));
}
export function registerDiscoveryHandlers() {
  registerSensitiveHandler('DISCOVERY_START',async req=>{
    if(req.type!=='DISCOVERY_START')throw new Error('类型错误');
    if(starting || (current && !['completed','stopped'].includes(current.task.state.status)))throw new AppError('LOCK_HELD','已有寻找任务，请先停止');
    starting=true;
    try {
      const {jobId,productId,tabId,direction}=req.payload;
      const product=await analysisRepos.getProduct(productId);
      if(!product || !product.profile.searchSuggestions.includes(direction))throw new AppError('PAGE_CHANGED','请选择当前产品画像中的搜索方向');
      const response=z.object({sourceUrl:z.string().url().max(2048),urls:z.array(z.string().max(2048)).min(1).max(5)}).parse(await ask(tabId,buildRequest('XHS_DISCOVER',{})));
      if(response.urls.some(url=>!noteUrl(url)))throw new AppError('URL_INVALID','搜索结果含不支持的链接');
      await launch({jobId,productId,tabId,direction,urls:response.urls,sourceUrl:response.sourceUrl});
      return {jobId};
    }finally{starting=false;}
  });
  registerSensitiveHandler('DISCOVERY_CONTROL',async req=>{
    if(req.type!=='DISCOVERY_CONTROL')throw new Error('类型错误');
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
      if(saved.discovery.deadline<=Date.now() || ['completed','cancelled'].includes(saved.status))throw new AppError('CANCELLED','任务已结束或达到10分钟上限，请重新启动');
      await launch({jobId:saved.id,productId:saved.productId,tabId:saved.discovery.sourceTabId,direction:saved.discovery.direction,urls:saved.discovery.targets,sourceUrl:saved.discovery.navigation?.sourceUrl??'https://www.xiaohongshu.com/search_result'},saved);
      return {jobId:saved.id};
    }
    if(req.payload.action==='stop')current.task.stop();
    else if(req.payload.action==='pause')current.task.pause();
    else {await current.task.drained();await current.page.reconcile(current.task.urls[current.task.state.index]?noteKeyFromUrl(current.task.urls[current.task.state.index]!):undefined);void current.task.run().catch(()=>current?.task.stop('本地存储异常'));}
    await current.task.flush();return {jobId:current.id};
    }finally{starting=false;}
  });
}
