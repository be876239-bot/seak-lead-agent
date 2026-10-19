import { browser } from 'wxt/browser';
import { AppError } from '../domain/errors';
import { LIMITS } from '../domain/limits';
import {CaptureBudgetClock} from './capture-budget';
import type {CaptureBudget} from '../domain/schemas';
class CaptureBudgetStop extends Error {constructor(readonly reason:'time_limit'|'round_limit'){super(reason);}}
import type { CaptureProgress, Comment, Note } from '../domain/schemas';
import {
  buildRequest, ResponseSchema, SnapshotPayload, XhsStatusPayload, type Request,
} from '../messaging/protocol';

export type CapturedNote = {
  noteKey: string;
  parserVersion: string;
  note: Note;
  comments: Comment[];
  truncated: boolean;
  hasMoreLoaded: boolean;
  stopReason?: CaptureProgress['stopReason'];
  displayedCommentCount?: number | null;
  replyLoadWarningCount?:number;
};

/** Shared guard: never send a known-truncated capture to AI or mark it complete. */
export function captureIncompleteReason(snap:Pick<CapturedNote,'comments'|'truncated'|'stopReason'|'displayedCommentCount'|'replyLoadWarningCount'>):string|null {
  const reasons:string[]=[];
  if(snap.replyLoadWarningCount)reasons.push(`有${snap.replyLoadWarningCount}组回复展开后未确认加载结果`);
  if(snap.truncated||snap.stopReason==='limit')reasons.push(`已达到${LIMITS.maxSessionComments}条单帖安全上限`);
  if(snap.stopReason==='time_limit'||snap.stopReason==='round_limit')
    reasons.push(`评论采集达到本帖累计${snap.stopReason==='time_limit'?'时间':'轮数'}预算`);
  if(snap.displayedCommentCount!==undefined&&snap.displayedCommentCount!==null&&snap.comments.length<snap.displayedCommentCount)
    reasons.push(`页面显示约${snap.displayedCommentCount}条评论，当前采集到${snap.comments.length}条`);
  if(!reasons.length)return null;
  return `${reasons.join('；')}。已保存评论保留，跳过 AI 分析以避免对不完整数据消耗额度。页面统计口径可能包含折叠或不可见内容。`;
}

export async function ask(tabId: number, req: Request, signal?: AbortSignal, timeoutMs:number=LIMITS.captureMessageTimeoutMs): Promise<unknown> {
  let raw: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    raw = await new Promise((resolve, reject) => {
      abort = () => reject(new AppError('CANCELLED', '评论采集已取消'));
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new AppError('PARSE_FAILED', '页面采集请求超时；已停止，已保存评论保留', true)), Math.max(1,Math.min(LIMITS.captureMessageTimeoutMs,timeoutMs)));
      Promise.resolve(browser.tabs.sendMessage(tabId, req)).then(resolve, reject);
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('PAGE_UNSUPPORTED', '无法连接笔记页面脚本：请刷新该小红书标签页后重试（扩展重新加载后旧标签页的脚本会失效）', true);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
  const res = ResponseSchema.safeParse(raw);
  if (!res.success) throw new AppError('PARSE_FAILED', '页面脚本返回了非法响应');
  if (!res.data.ok) {
    const e = res.data.error;
    throw new AppError(e?.code ?? 'UNKNOWN', e?.message ?? '页面脚本通信失败', e?.retryable ?? false);
  }
  return res.data.data;
}

/** 面板用于显示当前标签页状态的只读查询。 */
export async function getNoteStatus(tabId: number, signal?: AbortSignal): Promise<XhsStatusPayload> {
  return XhsStatusPayload.parse(await ask(tabId, buildRequest('XHS_GET_STATUS', {}), signal));
}

export type CaptureOptions = {
  autoLoad?: boolean;
  initialComments?: Comment[];
  signal?: AbortSignal;
  initialBudget?: CaptureBudget;
  initialReplyLoadWarnings?:string[];
  onReplyLoadWarnings?:(parents:string[])=>Promise<void>;
  onBudget?: (budget:CaptureBudget)=>Promise<void>;
  now?:()=>number;
  onDelta?: (note: Note, comments: Comment[]) => Promise<void>;
  onProgress?: (progress: CaptureProgress) => Promise<void> | void;
  /** 测试可注入等待；生产默认可取消的500ms采样。 */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError('CANCELLED', '评论采集已取消');
}

function waitForLoad(ms: number, signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new AppError('CANCELLED', '评论采集已取消')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** STATUS → START → 分页累计/持久化 → 小步滚动/等待/再累计 → STOP。 */
export async function captureNote(tabId: number, options: CaptureOptions = {}): Promise<CapturedNote> {
  const { signal } = options;
  checkCancelled(signal);
  const status = await getNoteStatus(tabId,signal);
  checkCancelled(signal);
  checkCancelled(signal);
  if (status.blocked) throw new AppError('PAGE_BLOCKED', '平台限制：登录或风控遮挡，请手动处理后重试');
  if (!status.supported || !status.noteKey) throw new AppError('PAGE_UNSUPPORTED', '当前标签页不是受支持的小红书笔记页');
  const expectedNoteKey = status.noteKey;
  const budget=new CaptureBudgetClock(expectedNoteKey,options.initialBudget,options.now);
  const initial=options.initialComments??[];
  if(initial.some(c=>c.noteKey!==expectedNoteKey))throw new AppError('PAGE_CHANGED','本地评论与当前笔记不匹配');
  const found = new Map<string, Comment>(initial.slice(0,LIMITS.maxSessionComments).map(c=>[c.commentKey,c]));
  let first: SnapshotPayload | null = null;
  let stopPromise: Promise<unknown> | null = null;
  const stop = () => {
    if (first && !stopPromise) stopPromise = ask(tabId, buildRequest('XHS_STOP_SESSION', { sessionId: first.sessionId })).catch(() => {});
    return stopPromise;
  };
  const abort = () => { budget.freeze();void stop(); };
  let note: Note | null = null;
  let truncated = false;
  let hasMoreLoaded = false;
  let endOfList = false;
  let addedCount = 0;
  let loadingReplies=false;
  const replyLoadWarnings=new Set(options.initialReplyLoadWarnings??[]);
  let activityVersion=0,atBottom=true,loadingComments=false;
  let displayedCommentCount:number|null=options.initialBudget?.displayedCommentCount??null;
  const report = async (loading: boolean, stopReason: CaptureProgress['stopReason'] = null) => {
    budget.update(found.size,displayedCommentCount);
    const budgetState=budget.snapshot();
    await options.onBudget?.(budgetState);
    await options.onReplyLoadWarnings?.([...replyLoadWarnings]);
    const replyCount=[...found.values()].filter(c=>c.isReply===true || c.parentKey!==null).length;
    const topLevelCount=found.size-replyCount;
    const countStatus=displayedCommentCount===null?'unknown':found.size<displayedCommentCount?'below_displayed_total':'meets_or_exceeds_displayed_total';
    await options.onProgress?.({ replyLoadWarningCount:replyLoadWarnings.size,budget:budgetState,discoveredCount: found.size, addedCount, loading, stopReason,replyCount,topLevelCount,unresolvedReplyCount:[...found.values()].filter(c=>c.isReply===true && !c.parentKey).length,loadingReplies:loading&&loadingReplies,displayedCommentCount,countStatus });
  };
  const accept = async (page: SnapshotPayload) => {
    checkCancelled(signal);
    if (page.noteKey !== expectedNoteKey || page.sessionId !== first!.sessionId || (page.note && page.note.noteKey !== expectedNoteKey)) {
      throw new AppError('PAGE_CHANGED', '快照所属笔记或会话改变，已停止采集');
    }
    loadingReplies=page.loadingReplies===true;
    for(const parent of page.replyLoadWarnings??[])replyLoadWarnings.add(parent);
    activityVersion=page.activityVersion??activityVersion;
    atBottom=page.atBottom??true;
    loadingComments=page.loadingComments===true;
    if(page.displayedCommentCount!==undefined && page.displayedCommentCount!==null) displayedCommentCount=page.displayedCommentCount;
    note ??= page.note;
    if (!note) throw new AppError('PARSE_FAILED', '未能解析笔记内容');
    const fresh = page.comments.filter(c=>!found.has(c.commentKey)).slice(0,LIMITS.maxSessionComments-found.size);
    const updates = page.comments.filter(c=>{
      const previous=found.get(c.commentKey);
      return previous && !previous.parentKey && !!c.parentKey;
    });
    const delta = [...fresh,...updates];
    if (delta.some((c) => c.noteKey !== expectedNoteKey)) throw new AppError('PAGE_CHANGED', '快照混入其他笔记评论');
    if ((delta.length || found.size === 0) && options.onDelta) {
      try { await options.onDelta(note, delta); }
      catch (err) { if (err instanceof AppError) throw err; throw new AppError('STORAGE_ERROR', '新增评论保存失败，已停止采集'); }
    }
    checkCancelled(signal);
    for (const comment of delta) {
      if (!found.has(comment.commentKey) && found.size >= LIMITS.maxSessionComments) { truncated = true; continue; }
      found.set(comment.commentKey, comment);
    }
    addedCount += fresh.length;
    truncated ||= page.truncated || found.size >= LIMITS.maxSessionComments;
    hasMoreLoaded ||= page.hasMoreLoaded;
    endOfList ||= page.endOfList === true;
    budget.update(found.size,displayedCommentCount);
  };
  const snapshot = async (cursor: string | null, advance = false) => {
    for(let sample=0;;sample++) {
      checkCancelled(signal);
      if(budget.stopReason()==='time_limit')throw new CaptureBudgetStop('time_limit');
      try {
        return SnapshotPayload.parse(await ask(tabId, buildRequest('XHS_GET_SNAPSHOT', {
          sessionId: first!.sessionId, expectedNoteKey, cursor, ...(advance ? { advance: true } : {}),
        }), signal,budget.snapshot().durationMs-budget.snapshot().elapsedMs));
      }catch(err) {
        if(err instanceof AppError && err.code==='PARSE_FAILED' && err.message.startsWith('页面采集请求超时') && budget.stopReason()==='time_limit')throw new CaptureBudgetStop('time_limit');
        const missingScroll=err instanceof AppError && err.message==='无法确认当前笔记的评论滚动容器；已停止，已保存评论保留';
        // Only known missing-list/layout errors get bounded readiness sampling.
        // Every retry still validates the same session/note and platform guards.
        if(!options.autoLoad || !(err instanceof AppError) || err.code!=='PARSE_FAILED' ||
          !['未找到评论列表容器','未找到评论容器，页面可能未加载完成或结构已变化','无法确认当前笔记的评论滚动容器；已停止，已保存评论保留'].includes(err.message))throw err;
        if(sample>=LIMITS.captureListWaitSamples)throw new AppError('PARSE_FAILED',`${missingScroll?'评论滚动容器在5秒等待后仍未就绪':'评论列表在5秒等待后仍未恢复'}；已保存 ${found.size} 条评论，请人工检查后继续`);
        // 此精确错误在任何滚动前抛出；可安全重试推进。列表异常仍禁止补滚。
        advance=missingScroll;
        await report(true);
        await (options.wait??waitForLoad)(Math.min(LIMITS.capturePollMs,Math.max(0,budget.snapshot().durationMs-budget.snapshot().elapsedMs)),signal);
        if(missingScroll){
          checkCancelled(signal);
          if(budget.stopReason()==='time_limit')throw new CaptureBudgetStop('time_limit');
          // 等待布局期间也提取并保存已出现的内容，避免虚拟列表移除后丢失。
          const page=SnapshotPayload.parse(await ask(tabId,buildRequest('XHS_GET_SNAPSHOT',{
            sessionId:first!.sessionId,expectedNoteKey,cursor:null,
          }),signal,budget.snapshot().durationMs-budget.snapshot().elapsedMs));
          await drain(page);
          if(endOfList||truncated)return {...page,nextCursor:null};
        }
      }
    }
  };
  const drain = async (page: SnapshotPayload) => {
    let restarts = 0;
    for (;;) {
      await accept(page);
      if (!page.nextCursor) return;
      try { page = await snapshot(page.nextCursor); }
      catch (err) {
        if (!options.autoLoad || !(err instanceof AppError) || err.code !== 'SNAPSHOT_EXPIRED' || ++restarts > 3) throw err;
        // 追加缓冲使旧cursor失效：从头取，已经落库的条目按稳定键跳过。
        page = await snapshot(null);
      }
    }
  };
  try {
    signal?.addEventListener('abort', abort, { once: true });
    checkCancelled(signal);
    await options.onBudget?.(budget.snapshot());
    first = SnapshotPayload.parse(await ask(tabId, buildRequest('XHS_START_SESSION', { expectedNoteKey,replyLoadWarnings:[...replyLoadWarnings] }),signal));
    await drain(first);
    await report(false);
    let stopReason: CaptureProgress['stopReason'] = null;
    let idleRounds = 0;
    let quietMs=0;
    if (options.autoLoad) {
      for (;;) {
        checkCancelled(signal);
        if (truncated) { stopReason = 'limit'; break; }
        if (endOfList) { stopReason = 'no_more'; break; }
        budget.update(found.size,displayedCommentCount);
        const exhausted=budget.stopReason();
        if(exhausted){stopReason=exhausted;break;}
        budget.consumeRound();
        const before = found.size;
        const activityBefore=activityVersion;
        addedCount = 0;
        await report(true);
        await drain(await snapshot(null, true));
        for (let sample = 0; sample < LIMITS.captureSamplesPerRound && !truncated && !endOfList; sample++) {
          await (options.wait ?? waitForLoad)(Math.min(LIMITS.capturePollMs,Math.max(0,budget.snapshot().durationMs-budget.snapshot().elapsedMs)), signal);
          checkCancelled(signal);
          const countBefore=found.size,versionBefore=activityVersion;
          await drain(await snapshot(null));
          quietMs=found.size===countBefore&&activityVersion===versionBefore&&atBottom&&!loadingComments&&!loadingReplies?quietMs+LIMITS.capturePollMs:0;
          await report(true);
        }
        if(loadingReplies||loadingComments||activityVersion!==activityBefore) idleRounds=0;
        else if (found.size === before) idleRounds += 1; else idleRounds = 0;
        if (truncated) { stopReason = 'limit'; break; }
        if (endOfList) { stopReason = 'no_more'; break; }
        if (idleRounds >= LIMITS.captureIdleRounds && atBottom && quietMs>=LIMITS.captureQuietMs) { stopReason = 'no_new'; break; }
      }
    }
    checkCancelled(signal);
    await report(false, stopReason);
    return { noteKey: expectedNoteKey, parserVersion: status.parserVersion, note: note!, comments: [...found.values()], truncated, hasMoreLoaded, stopReason, displayedCommentCount,replyLoadWarningCount:replyLoadWarnings.size };
  } catch (err) {
    if(err instanceof CaptureBudgetStop && !signal?.aborted){
      await report(false,err.reason);
      return {noteKey:expectedNoteKey,parserVersion:status.parserVersion,note:note!,comments:[...found.values()],truncated,hasMoreLoaded,stopReason:err.reason,displayedCommentCount,replyLoadWarningCount:replyLoadWarnings.size};
    }
    await report(false, signal?.aborted ? 'cancelled' : 'error').catch(() => {});
    if (signal?.aborted) throw new AppError('CANCELLED', '评论采集已取消');
    throw err;
  } finally {
    budget.freeze();
    try{await options.onBudget?.(budget.snapshot());}
    finally{signal?.removeEventListener('abort', abort);await stop();}
  }
}
