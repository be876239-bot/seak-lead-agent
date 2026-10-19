import type {DiscoveryTrace,CaptureBudget} from '../domain/schemas';
import {LIMITS} from '../domain/limits';
export type DiscoveryState = {
  status: 'running' | 'paused' | 'stopped' | 'completed';
  index: number; total: number; comments: number; currentComments: number;
  leads: number; currentLeads: number; phase: string; reason: string | null; postElapsedMs: number;
  /** Count of posts whose capture was intentionally marked incomplete; retained across task resume. */
  partialPosts?: number;
  post?: {stage:'capturing'|'captured'|'completed'|'partial'; commentKeys:string[];captureBudget?:CaptureBudget;replyLoadWarnings?:string[]};
};
export type DiscoveryDeps = {
  navigate: (url: string, signal: AbortSignal) => Promise<void>;
  ready: (url: string, signal: AbortSignal) => Promise<void>;
  guard: () => Promise<void>;
  finish?: (signal:AbortSignal)=>Promise<void>;
  betweenPosts?: (signal:AbortSignal)=>Promise<void>;
  process: (url: string, signal: AbortSignal, progress: (comments: number, leads: number, phase?: string) => void,
    checkpoint: {warnings:(parents:string[])=>Promise<void>;budget:(value:CaptureBudget)=>Promise<void>;post:DiscoveryState['post']; captured:(keys:string[])=>Promise<void>; completed:()=>Promise<void>;partial:(keys:string[])=>Promise<void>;event:(name:string)=>void}) => Promise<void>;
  observe?:()=>DiscoveryTrace['navigation'];
  changed: (state: DiscoveryState, event?:{name:string;runId:string;source:string;at:number;navigation?:DiscoveryTrace['navigation']}) => Promise<void>;
  now: () => number;
  /** Test override; production defaults to LIMITS.discoveryPostTimeoutMs. */
  postTimeoutMs?: number;
};
/** 有限、单通道调度。无全局截止时间；单篇主动运行超时，暂停时间不计入，继续只由用户触发。 */
export class SerialDiscovery {
  readonly urls: string[];
  readonly state: DiscoveryState;
  private controller = new AbortController();
  private pending: Promise<void> | null = null;
  private postTimer: ReturnType<typeof setTimeout> | null=null;
  private postActiveStartedAt: number | null=null;
  private writes = Promise.resolve();
  private runId=crypto.randomUUID();
  private started=false;
  private totals = new Map<number, {comments:number;leads:number}>();
  async drained() { await this.pending; }
  constructor(urls: string[], private deps: DiscoveryDeps, restored?: DiscoveryState, maxPosts=5) {
    const cap=Math.max(1,Math.min(100,Math.floor(restored?.total??maxPosts)));
    this.urls = [...new Set(urls)].slice(0,cap);
    this.state = {status:'paused',index:0,total:this.urls.length,comments:0,currentComments:0,leads:0,currentLeads:0,phase:'等待启动',reason:null,postElapsedMs:0,partialPosts:0,post:{stage:'capturing',commentKeys:[]}};
    if(restored) {this.started=true;Object.assign(this.state,restored,{status:'paused',total:this.urls.length,postElapsedMs:restored.postElapsedMs??0});this.totals.set(restored.index,{comments:restored.currentComments,leads:restored.currentLeads});}
  }
  private activePostElapsedMs() { return Math.max(0,this.state.postElapsedMs+(this.postActiveStartedAt===null?0:this.deps.now()-this.postActiveStartedAt)); }
  private publish(name?:string,source='runner') { const state = {...this.state,postElapsedMs:Math.min(this.deps.postTimeoutMs??LIMITS.discoveryPostTimeoutMs,this.activePostElapsedMs())}; const event=name?{name,source,runId:this.runId,at:this.deps.now(),navigation:this.deps.observe?.()}:undefined;this.writes = this.writes.then(()=>this.deps.changed(state,event)).catch(()=>{this.state.status='stopped';this.state.reason='本地存储异常，任务已停止';this.controller.abort();}); }
  private clearPostTimer() { if(this.postTimer)clearTimeout(this.postTimer);this.postTimer=null; }
  private freezePostClock() { this.clearPostTimer();if(this.postActiveStartedAt!==null){this.state.postElapsedMs=Math.min(this.deps.postTimeoutMs??LIMITS.discoveryPostTimeoutMs,this.activePostElapsedMs());this.postActiveStartedAt=null;} }
  private resetPostClock() { this.clearPostTimer();this.postActiveStartedAt=null;this.state.postElapsedMs=0; }
  private timeoutPost() {
    if(this.state.status!=='running')return;
    this.freezePostClock();this.state.postElapsedMs=0;this.state.status='paused';this.state.reason=`单篇笔记主动处理达到${Math.round((this.deps.postTimeoutMs??LIMITS.discoveryPostTimeoutMs)/60_000)}分钟上限（暂停时间不计入）；已暂停并保留已保存结果，请检查页面/模型后手动继续。`;this.state.phase='单篇处理超时，等待人工检查';this.controller.abort();this.publish('POST_TIMEOUT','post-timeout');
  }
  private startPostClock() {
    if(this.state.status!=='running'||this.state.index>=this.urls.length||this.isTerminalPost())return;
    if(this.postActiveStartedAt===null)this.postActiveStartedAt=this.deps.now();
    const remaining=(this.deps.postTimeoutMs??LIMITS.discoveryPostTimeoutMs)-this.activePostElapsedMs();
    if(remaining<=0){this.timeoutPost();return;}
    this.clearPostTimer();this.postTimer=setTimeout(()=>{this.postTimer=null;this.timeoutPost();},remaining);
  }
  recordControl(action:'pause'|'stop'|'continue'){this.publish(action.toUpperCase()+'_REQUESTED','DISCOVERY_CONTROL');}
  pause(reason = '用户暂停；已保存结果保留',source='user') {
    if (this.state.status === 'completed' || this.state.status === 'stopped') return;
    this.freezePostClock();this.state.status='paused'; this.state.reason=reason; this.state.phase=this.state.post?.stage==='partial'?(this.state.index+1<this.urls.length?'当前帖子部分采集，已保留数据；继续将处理下一篇':'最后一篇部分采集，已保留数据；继续将完成任务收尾'):this.state.post?.stage==='completed'?(this.state.index+1<this.urls.length?'当前帖子已完成，继续将处理下一篇':'最后一篇已完成，继续将完成任务收尾'):this.state.post?.stage==='captured'?'评论已保存，继续将完成本帖分析':'任务已暂停'; this.controller.abort(); this.publish('PAUSE',source);
  }
  stop(reason = '用户停止任务；已保存结果保留') {
    if(this.state.status==='completed'||this.state.status==='stopped') return;
    this.freezePostClock();
    this.state.status='stopped';this.state.reason=reason;this.state.phase='任务已停止';this.controller.abort();this.publish('STOP');
  }
  private live() {
    if(this.controller.signal.aborted || this.state.status!=='running') throw new Error('任务已暂停或停止');
  }
  async flush() { await this.writes; }
  private isTerminalPost(){return this.state.post?.stage==='completed'||this.state.post?.stage==='partial';}
  private async advanceToNextPost() {
    this.live();
    if(!this.isTerminalPost())throw new Error('当前帖子尚未完成');
    this.publish('ADVANCE_REQUESTED');await this.flush();this.live();
    // Completion is already persisted. Persist the next position before navigation.
    this.state.index++;this.state.post={stage:'capturing',commentKeys:[]};
    this.state.currentComments=0;this.state.currentLeads=0;this.resetPostClock();this.startPostClock();
    this.state.phase=this.state.index<this.urls.length?'下一篇准备就绪':'所有目标帖子已完成，正在收尾';
    this.publish('POST_INDEX_CHANGED');await this.flush();this.live();
  }
  run(): Promise<void> {
    if(this.pending) return this.pending;
    if(this.state.status==='completed'||this.state.status==='stopped') return Promise.resolve();
    this.runId=crypto.randomUUID();this.controller=new AbortController();this.state.status='running';this.state.reason=null;this.startPostClock();
    if(this.state.status!=='running')return Promise.resolve();
    this.publish(this.started?'RESUME':'TASK_START');this.started=true;
    this.pending=this.execute().finally(()=>{this.pending=null;}); return this.pending;
  }
  private async execute() {
    const signal=this.controller.signal;
    // 定时守卫覆盖等待页面、评论采集和AI分析阶段；没有自动刷新或恢复。
    let checking=false;let lastClockPersistAt=this.deps.now();
    const timer=setInterval(()=>{
      if(this.state.status==='running'&&this.postActiveStartedAt!==null&&this.deps.now()-lastClockPersistAt>=10_000){lastClockPersistAt=this.deps.now();this.publish();}
      if(checking || signal.aborted) return; checking=true;
      const index=this.state.index;
      void (async()=>{this.live();await this.deps.guard();if(signal.aborted)return;this.live();})()
        .catch(async e=>{
          if(signal.aborted)return;
          // Recheck the current page before acting on an old post's delayed guard failure.
          if(index!==this.state.index){try{await this.deps.guard();return;}catch(currentError){e=currentError;}}
          if(!signal.aborted)this.pause(e instanceof Error?e.message:'页面检查失败','guard');
        })
        .finally(()=>{checking=false;});
    },500);
    try {
      while(this.state.index<this.urls.length) {
        if(this.isTerminalPost()) {
          if(this.state.index+1<this.urls.length && this.deps.betweenPosts){
            this.state.phase='本帖已处理，等待3秒后进入下一篇';this.publish();
            await this.deps.betweenPosts(signal);this.live();
          }
          await this.advanceToNextPost();
          continue;
        }
        this.live();await this.deps.guard();this.live();
        const url=this.urls[this.state.index]!;
        const processingIndex=this.state.index;
        this.publish('POST_START');this.state.phase='正在打开笔记';this.publish('NAVIGATION_START');
        await this.deps.navigate(url,signal);this.live();
        this.state.phase='等待页面正常加载';this.publish();await this.deps.ready(url,signal);this.live();
        this.publish('NAVIGATION_COMPLETE');
        await this.deps.guard();this.live();
        this.publish('NEXT_POST_READY');
        const checkpoint=async(stage:'captured'|'completed'|'partial',keys=this.state.post?.commentKeys??[])=>{
          if(signal.aborted)throw new Error('旧执行已取消');this.live();if(this.state.index!==processingIndex)throw new Error('帖子检查点已过期');
          const previousStage=this.state.post?.stage;
          this.state.post={...this.state.post,stage,commentKeys:[...keys]};
          if(stage==='partial'&&previousStage!=='partial')this.state.partialPosts=(this.state.partialPosts??0)+1;
          if(stage!=='captured')this.resetPostClock();
          this.publish(stage==='captured'?'CAPTURE_COMPLETE':stage==='partial'?'POST_PARTIAL':'POST_COMPLETE');await this.flush();this.live();this.publish('CHECKPOINT_SAVED');await this.flush();this.live();
        };
        await this.deps.process(url,signal,(comments,leads,phase='正在加载评论……')=>{
          if(signal.aborted || this.state.index!==processingIndex || this.isTerminalPost())return;
          const old=this.totals.get(this.state.index)??{comments:0,leads:0};
          this.state.comments+=Math.max(0,comments-old.comments);
          this.state.leads+=Math.max(0,leads-old.leads);
          this.totals.set(this.state.index,{comments:Math.max(comments,old.comments),leads:Math.max(leads,old.leads)});
          this.state.currentComments=Math.max(comments,old.comments);this.state.currentLeads=Math.max(leads,old.leads);this.state.phase=phase;this.publish(this.state.post?.stage==='captured'?'ANALYSIS_PROGRESS':'CAPTURE_PROGRESS');
        },{warnings:async parents=>{
          if(this.state.index!==processingIndex||this.state.post?.stage!=='capturing'||(signal.aborted&&this.state.status==='running'))return;
          const previous=this.state.post.replyLoadWarnings??[];const merged=[...new Set([...previous,...parents])];
          if(merged.length===previous.length)return;
          this.state.post={...this.state.post,replyLoadWarnings:merged};this.publish();await this.flush();
        },budget:async value=>{
          // Abort后的最终耗时也要保存；旧帖子和已完成检查点不能被迟到回调覆盖。
          if(this.state.index!==processingIndex||this.state.post?.stage!=='capturing'||(signal.aborted&&this.state.status==='running'))return;
          const previous=this.state.post.captureBudget;
          if(previous&&(value.elapsedMs<previous.elapsedMs||value.rounds<previous.rounds))return;
          this.state.post={...this.state.post,captureBudget:{...value}};this.publish();await this.flush();
        },post:this.state.post,captured:keys=>checkpoint('captured',keys),completed:()=>checkpoint('completed'),partial:keys=>checkpoint('partial',keys),event:name=>{if(!signal.aborted&&this.state.index===processingIndex)this.publish(name,'process');}});
        // Persist successful processing BEFORE any fallible page check or next navigation.
        this.live();if(!this.isTerminalPost())await checkpoint('completed');
      }
      if(this.deps.finish){this.live();this.state.phase='正在返回搜索结果';this.publish();await this.deps.finish(signal);this.live();}
      this.state.status='completed';this.state.phase=(this.state.partialPosts??0)>0?'本次任务已结束（含部分采集帖子；这些帖子已跳过AI分析）':'本次任务已结束（不代表全部评论）';this.publish('TASK_COMPLETE');
    } catch(e) { if(!signal.aborted)this.pause(e instanceof Error?e.message:'任务异常，需人工检查','execute'); }
    finally {clearInterval(timer);if(this.state.status!=='running')this.clearPostTimer();await this.flush();}
  }
}
