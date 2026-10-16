export type DiscoveryState = {
  status: 'running' | 'paused' | 'stopped' | 'completed';
  index: number; total: number; comments: number; currentComments: number;
  leads: number; currentLeads: number; phase: string; reason: string | null; deadline: number;
};
export type DiscoveryDeps = {
  navigate: (url: string, signal: AbortSignal) => Promise<void>;
  ready: (url: string, signal: AbortSignal) => Promise<void>;
  guard: () => Promise<void>;
  process: (url: string, signal: AbortSignal, progress: (comments: number, leads: number, phase?: string) => void) => Promise<void>;
  changed: (state: DiscoveryState) => Promise<void>;
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
  private totals = new Map<number, {comments:number;leads:number}>();
  async drained() { await this.pending; }
  constructor(urls: string[], private deps: DiscoveryDeps, restored?: DiscoveryState) {
    this.urls = [...new Set(urls)].slice(0,5);
    this.state = {status:'paused',index:0,total:this.urls.length,comments:0,currentComments:0,leads:0,currentLeads:0,phase:'等待启动',reason:null,deadline:deps.now()+600000};
    if(restored) {Object.assign(this.state,restored,{status:'paused'});this.totals.set(restored.index,{comments:restored.currentComments,leads:restored.currentLeads});}
  }
  private publish() { const state = {...this.state}; this.writes = this.writes.then(()=>this.deps.changed(state)).catch(()=>{this.state.status='stopped';this.state.reason='本地存储异常，任务已停止';this.controller.abort();}); }
  pause(reason = '用户暂停；已保存结果保留') {
    if (this.state.status === 'completed' || this.state.status === 'stopped') return;
    this.state.status='paused'; this.state.reason=reason; this.state.phase='任务已暂停'; this.controller.abort(); this.publish();
  }
  stop(reason = '用户停止任务；已保存结果保留') {
    if(this.state.status==='completed'||this.state.status==='stopped') return;
    if(this.expiry)clearTimeout(this.expiry);
    this.state.status='stopped';this.state.reason=reason;this.state.phase='任务已停止';this.controller.abort();this.publish();
  }
  private live() {
    if(this.deps.now()>=this.state.deadline) this.stop('达到单任务10分钟时间上限');
    if(this.controller.signal.aborted || this.state.status!=='running') throw new Error('任务已暂停或停止');
  }
  async flush() { await this.writes; }
  run(): Promise<void> {
    if(this.pending) return this.pending;
    if(this.state.status==='completed'||this.state.status==='stopped') return Promise.resolve();
    this.controller=new AbortController();this.state.status='running';this.state.reason=null;this.publish();
    this.pending=this.execute().finally(()=>{this.pending=null;}); return this.pending;
  }
  private async execute() {
    const signal=this.controller.signal;
    // 定时守卫覆盖等待页面、评论采集和AI分析阶段；没有自动刷新或恢复。
    let checking=false;
    const timer=setInterval(()=>{
      if(checking || signal.aborted) return; checking=true;
      void (async()=>{this.live();await this.deps.guard();this.live();})()
        .catch(e=>{if(!signal.aborted)this.pause(e instanceof Error?e.message:'页面检查失败');})
        .finally(()=>{checking=false;});
    },500);
    if(this.expiry)clearTimeout(this.expiry);
    this.expiry=setTimeout(()=>this.stop('达到单任务10分钟时间上限'),Math.max(0,this.state.deadline-this.deps.now()));
    try {
      while(this.state.index<this.urls.length) {
        this.live();await this.deps.guard();this.live();
        const url=this.urls[this.state.index]!;
        this.state.currentComments=0;this.state.currentLeads=0;this.state.phase='正在打开笔记';this.publish();
        await this.deps.navigate(url,signal);this.live();
        this.state.phase='等待页面正常加载';this.publish();await this.deps.ready(url,signal);this.live();
        await this.deps.guard();this.live();
        await this.deps.process(url,signal,(comments,leads,phase='正在加载评论……')=>{
          if(signal.aborted)return;
          const old=this.totals.get(this.state.index)??{comments:0,leads:0};
          this.state.comments+=Math.max(0,comments-old.comments);
          this.state.leads+=Math.max(0,leads-old.leads);
          this.totals.set(this.state.index,{comments:Math.max(comments,old.comments),leads:Math.max(leads,old.leads)});
          this.state.currentComments=comments;this.state.currentLeads=leads;this.state.phase=phase;this.publish();
        });
        this.live();await this.deps.guard();this.live();
        this.state.index++;
        if(this.state.currentComments>=500) {this.state.reason='达到单帖500条安全上限，结束本次任务';break;}
      }
      this.state.status='completed';this.state.phase='本次任务已结束（不代表全部评论）';this.publish();
    } catch(e) { if(!signal.aborted)this.pause(e instanceof Error?e.message:'任务异常，需人工检查'); }
    finally {clearInterval(timer);if(this.state.status!=='paused' && this.expiry)clearTimeout(this.expiry);await this.flush();}
  }
}
