import {LIMITS} from '../domain/limits';
import {AppError} from '../domain/errors';
import {CaptureBudgetSchema,type CaptureBudget} from '../domain/schemas';

export function displayedCaptureBudget(count:number|null|undefined){
  const n=typeof count==='number'&&Number.isFinite(count)&&count>=0?count:0;
  return {
    durationMs:Math.min(LIMITS.captureHardDurationMs,Math.max(LIMITS.captureMaxDurationMs,n*LIMITS.captureMsPerComment)),
    maxRounds:Math.min(LIMITS.captureHardRounds,Math.max(LIMITS.captureMaxRounds,Math.ceil(n*2))),
  };
}
/** 只累计本次运行的主动时间；持久化不含墙钟时间戳。 */
export class CaptureBudgetClock {
  private state:CaptureBudget;
  private startedAt:number;
  private frozen=false;
  constructor(noteKey:string,initial:CaptureBudget|undefined,private now:()=>number=Date.now){
    if(initial && initial.noteKey!==noteKey)throw new AppError('PAGE_CHANGED','采集预算所属笔记不一致');
    this.state=initial?CaptureBudgetSchema.parse(initial):{noteKey,displayedCommentCount:null,elapsedMs:0,rounds:0,...displayedCaptureBudget(null),progressCount:0,lastProgressElapsedMs:0,extensionCount:0,lastExtensionElapsedMs:0};
    this.startedAt=now();
  }
  snapshot():CaptureBudget {
    return {...this.state,elapsedMs:Math.min(LIMITS.captureHardDurationMs,this.state.elapsedMs+(this.frozen?0:Math.max(0,this.now()-this.startedAt)))};
  }
  freeze(){this.state=this.snapshot();this.frozen=true;}
  update(count:number,displayed:number|null){
    const elapsed=this.snapshot().elapsedMs;
    if(count>this.state.progressCount){this.state.progressCount=count;this.state.lastProgressElapsedMs=elapsed;}
    if(displayed!==null)this.state.displayedCommentCount=Math.max(this.state.displayedCommentCount??0,displayed);
    const target=displayedCaptureBudget(this.state.displayedCommentCount);
    this.state.durationMs=Math.max(this.state.durationMs,target.durationMs);
    this.state.maxRounds=Math.max(this.state.maxRounds,target.maxRounds);
    // 未知总数：最近60秒有新增、距上次延长至少60秒、且接近预算边界才延长一档。
    if(this.state.displayedCommentCount===null && count>this.state.extensionCount && elapsed-this.state.lastProgressElapsedMs<=LIMITS.captureExtensionIntervalMs
      && elapsed-this.state.lastExtensionElapsedMs>=LIMITS.captureExtensionIntervalMs
      && (this.state.durationMs-elapsed<=LIMITS.captureExtensionIntervalMs || this.state.maxRounds-this.state.rounds<=50)){
      this.state.durationMs=Math.min(LIMITS.captureHardDurationMs,this.state.durationMs+LIMITS.captureMaxDurationMs);
      this.state.maxRounds=Math.min(LIMITS.captureHardRounds,this.state.maxRounds+LIMITS.captureMaxRounds);
      this.state.extensionCount=count;this.state.lastExtensionElapsedMs=elapsed;
    }
  }
  consumeRound(){this.state.rounds++;}
  stopReason(): 'time_limit'|'round_limit'|null {
    const s=this.snapshot();
    return s.elapsedMs>=s.durationMs?'time_limit':s.rounds>=s.maxRounds?'round_limit':null;
  }
}
