import type {DiscoveryTrace} from '../domain/schemas';
export type DiscoveryState = {
  status: 'running' | 'paused' | 'stopped' | 'completed';
  index: number; total: number; comments: number; currentComments: number;
  leads: number; currentLeads: number; phase: string; reason: string | null; deadline: number;
  post?: {stage:'capturing'|'captured'|'completed'; commentKeys:string[]};
};
export type DiscoveryDeps = {
  navigate: (url: string, signal: AbortSignal) => Promise<void>;
  ready: (url: string, signal: AbortSignal) => Promise<void>;
  guard: () => Promise<void>;
  finish?: (signal:AbortSignal)=>Promise<void>;
  process: (url: string, signal: AbortSignal, progress: (comments: number, leads: number, phase?: string) => void,
    checkpoint: {post:DiscoveryState['post']; captured:(keys:string[])=>Promise<void>; completed:()=>Promise<void>;event:(name:string)=>void}) => Promise<void>;
  observe?:()=>DiscoveryTrace['navigation'];
  changed: (state: DiscoveryState, event?:{name:string;runId:string;source:string;at:number;navigation?:DiscoveryTrace['navigation']}) => Promise<void>;
  now: () => number;
};
/** 有限、单通道调度。暂停不重置截止时间；继续只由用户触发，先等旧执行完全退出。 */
export class SerialDiscovery {
  readonly urls: string[];
  readonly state: DiscoveryState;
  private controller = new AbortController();
  private pending: Promise<void> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null=null;
  private writes = Promise.resolve();
  private runId=crypto.randomUUID();
  private started=false;
  private totals = new Map<number, {comments:number;leads:number}>();
  async drained() { await this.pending; }
  constructor(urls: string[], private deps: DiscoveryDeps, restored?: DiscoveryState) {
    this.urls = [...new Set(urls)].slice(0,5);
    this.state = {status:'paused',index:0,total:this.urls.length,comments:0,currentComments:0,leads:0,currentLeads:0,phase:'等待启动',reason:null,deadline:deps.now()+600000,post:{stage:'capturing',commentKeys:[]}};
    if(restored) {this.started=true;Object.assign(this.state,restored,{status:'paused'});this.totals.set(restored.index,{comments:restored.currentComments,leads:restored.currentLeads});}
  }
  private publish(name?:string,source='runner') { const state = {...this.state}; const event=name?{name,source,runId:this.runId,at:this.deps.now(),navigation:this.deps.observe?.()}:undefined;this.writes = this.writes.then(()=>this.deps.changed(state,event)).catch(()=>{this.state.status='stopped';this.state.reason='本地存储异常，任务已停止';this.controller.abort();}); }
  recordControl(action:'pause'|'stop'|'continue'){this.publish(action.toUpperCase()+'_REQUESTED','DISCOVERY_CONTROL');}
  pause(reason = '用户暂停；已保存结果保留',source='user') {
    if (this.state.status === 'completed' || this.state.status === 'stopped') return;
    this.state.status='paused'; this.state.reason=reason; this.state.phase=this.state.post?.stage==='completed'?(this.state.index+1<this.urls.length?'当前帖子已完成，继续将处理下一篇':'最后一篇已完成，继续将完成任务收尾'):this.state.post?.stage==='captured'?'评论已保存，继续将完成本帖分析':'任务已暂停'; this.controller.abort(); this.publish('PAUSE',source);
  }
  stop(reason = '用户停止任务；已保存结果保留') {
    if(this.state.status==='completed'||this.state.status==='stopped') return;
    if(this.expiry)clearTimeout(this.expiry);
    this.state.status='stopped';this.state.reason=reason;this.state.phase='任务已停止';this.controller.abort();this.publish('STOP');
  }
  private live() {
    if(this.deps.now()>=this.state.deadline) this.stop('达到单任务10分钟时间上限');
    if(this.controller.signal.aborted || this.state.status!=='running') throw new Error('任务已暂停或停止');
  }
  async flush() { await this.writes; }
  private hasCompletedPost(){return this.state.post?.stage==='completed';}
  private async advanceToNextPost() {
    this.live();
    if(this.state.post?.stage!=='completed')throw new Error('当前帖子尚未完成');
    this.publish('ADVANCE_REQUESTED');await this.flush();this.live();
    // Completion is already persisted. Persist the next position before navigation.
    this.state.index++;this.state.post={stage:'capturing',commentKeys:[]};
    this.state.currentComments=0;this.state.currentLeads=0;
    this.state.phase=this.state.index<this.urls.length?'下一篇准备就绪':'所有目标帖子已完成，正在收尾';
    this.publish('POST_INDEX_CHANGED');await this.flush();this.live();
  }
  run(): Promise<void> {
    if(this.pending) return this.pending;
    if(this.state.status==='completed'||this.state.status==='stopped') return Promise.resolve();
    this.runId=crypto.randomUUID();this.controller=new AbortController();this.state.status='running';this.state.reason=null;this.publish(this.started?'RESUME':'TASK_START');this.started=true;
    this.pending=this.execute().finally(()=>{this.pending=null;}); return this.pending;
  }
  private async execute() {
    const signal=this.controller.signal;
    // 定时守卫覆盖等待页面、评论采集和AI分析阶段；没有自动刷新或恢复。
    let checking=false;
    const timer=setInterval(()=>{
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
    if(this.expiry)clearTimeout(this.expiry);
    this.expiry=setTimeout(()=>this.stop('达到单任务10分钟时间上限'),Math.max(0,this.state.deadline-this.deps.now()));
    try {
      while(this.state.index<this.urls.length) {
        if(this.state.post?.stage==='completed') {
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
        const checkpoint=async(stage:'captured'|'completed',keys=this.state.post?.commentKeys??[])=>{
          if(signal.aborted)throw new Error('旧执行已取消');this.live();if(this.state.index!==processingIndex)throw new Error('帖子检查点已过期');
          this.state.post={stage,commentKeys:[...keys]};this.publish(stage==='captured'?'CAPTURE_COMPLETE':'POST_COMPLETE');await this.flush();this.live();this.publish('CHECKPOINT_SAVED');await this.flush();this.live();
        };
        await this.deps.process(url,signal,(comments,leads,phase='正在加载评论……')=>{
          if(signal.aborted || this.state.index!==processingIndex || this.state.post?.stage==='completed')return;
          const old=this.totals.get(this.state.index)??{comments:0,leads:0};
          this.state.comments+=Math.max(0,comments-old.comments);
          this.state.leads+=Math.max(0,leads-old.leads);
          this.totals.set(this.state.index,{comments:Math.max(comments,old.comments),leads:Math.max(leads,old.leads)});
          this.state.currentComments=Math.max(comments,old.comments);this.state.currentLeads=Math.max(leads,old.leads);this.state.phase=phase;this.publish(this.state.post?.stage==='captured'?'ANALYSIS_PROGRESS':'CAPTURE_PROGRESS');
        },{post:this.state.post,captured:keys=>checkpoint('captured',keys),completed:()=>checkpoint('completed'),event:name=>{if(!signal.aborted&&this.state.index===processingIndex)this.publish(name,'process');}});
        // Persist successful processing BEFORE any fallible page check or next navigation.
        this.live();if(!this.hasCompletedPost())await checkpoint('completed');
      }
      if(this.deps.finish){this.live();this.state.phase='正在返回搜索结果';this.publish();await this.deps.finish(signal);this.live();}
      this.state.status='completed';this.state.phase='本次任务已结束（不代表全部评论）';this.publish('TASK_COMPLETE');
    } catch(e) { if(!signal.aborted)this.pause(e instanceof Error?e.message:'任务异常，需人工检查','execute'); }
    finally {clearInterval(timer);if(this.state.status!=='paused' && this.expiry)clearTimeout(this.expiry);await this.flush();}
  }
}
