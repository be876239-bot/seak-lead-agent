import { browser } from 'wxt/browser';
import { AppError } from '../domain/errors';
import { LIMITS } from '../domain/limits';
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
};

export async function ask(tabId: number, req: Request, signal?: AbortSignal): Promise<unknown> {
  let raw: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    raw = await new Promise((resolve, reject) => {
      abort = () => reject(new AppError('CANCELLED', '评论采集已取消'));
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new AppError('PARSE_FAILED', '页面采集请求超时；已停止，已保存评论保留', true)), LIMITS.captureMessageTimeoutMs);
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
  const status = await getNoteStatus(tabId);
  checkCancelled(signal);
  if (status.blocked) throw new AppError('PAGE_BLOCKED', '平台限制：登录或风控遮挡，请手动处理后重试');
  if (!status.supported || !status.noteKey) throw new AppError('PAGE_UNSUPPORTED', '当前标签页不是受支持的小红书笔记页');
  const expectedNoteKey = status.noteKey;
  const initial=options.initialComments??[];
  if(initial.some(c=>c.noteKey!==expectedNoteKey))throw new AppError('PAGE_CHANGED','本地评论与当前笔记不匹配');
  const found = new Map<string, Comment>(initial.slice(0,LIMITS.maxSessionComments).map(c=>[c.commentKey,c]));
  let first: SnapshotPayload | null = null;
  let stopPromise: Promise<unknown> | null = null;
  const stop = () => {
    if (first && !stopPromise) stopPromise = ask(tabId, buildRequest('XHS_STOP_SESSION', { sessionId: first.sessionId })).catch(() => {});
    return stopPromise;
  };
  const abort = () => { void stop(); };
  let note: Note | null = null;
  let truncated = false;
  let hasMoreLoaded = false;
  let endOfList = false;
  let addedCount = 0;
  let loadingReplies=false;
  let activityVersion=0,atBottom=true,loadingComments=false;
  let displayedCommentCount:number|null=null;
  const report = async (loading: boolean, stopReason: CaptureProgress['stopReason'] = null) => {
    const replyCount=[...found.values()].filter(c=>c.parentKey!==null).length;
    const topLevelCount=found.size-replyCount;
    const countStatus=displayedCommentCount===null?'unknown':found.size<displayedCommentCount?'below_displayed_total':'meets_or_exceeds_displayed_total';
    await options.onProgress?.({ discoveredCount: found.size, addedCount, loading, stopReason,replyCount,topLevelCount,loadingReplies:loading&&loadingReplies,displayedCommentCount,countStatus });
  };
  const accept = async (page: SnapshotPayload) => {
    checkCancelled(signal);
    if (page.noteKey !== expectedNoteKey || page.sessionId !== first!.sessionId || (page.note && page.note.noteKey !== expectedNoteKey)) {
      throw new AppError('PAGE_CHANGED', '快照所属笔记或会话改变，已停止采集');
    }
    loadingReplies=page.loadingReplies===true;
    activityVersion=page.activityVersion??activityVersion;
    atBottom=page.atBottom??true;
    loadingComments=page.loadingComments===true;
    if(page.displayedCommentCount!==undefined && page.displayedCommentCount!==null) displayedCommentCount=page.displayedCommentCount;
    note ??= page.note;
    if (!note) throw new AppError('PARSE_FAILED', '未能解析笔记内容');
    const delta = page.comments.filter((c) => !found.has(c.commentKey)).slice(0,LIMITS.maxSessionComments-found.size);
    if (delta.some((c) => c.noteKey !== expectedNoteKey)) throw new AppError('PAGE_CHANGED', '快照混入其他笔记评论');
    if ((delta.length || found.size === 0) && options.onDelta) {
      try { await options.onDelta(note, delta); }
      catch (err) { if (err instanceof AppError) throw err; throw new AppError('STORAGE_ERROR', '新增评论保存失败，已停止采集'); }
    }
    checkCancelled(signal);
    for (const comment of delta) {
      if (found.size >= LIMITS.maxSessionComments) { truncated = true; break; }
      found.set(comment.commentKey, comment);
    }
    addedCount += delta.length;
    truncated ||= page.truncated || found.size >= LIMITS.maxSessionComments;
    hasMoreLoaded ||= page.hasMoreLoaded;
    endOfList ||= page.endOfList === true;
  };
  const snapshot = async (cursor: string | null, advance = false) => {
    for(let sample=0;;sample++) {
      checkCancelled(signal);
      try {
        return SnapshotPayload.parse(await ask(tabId, buildRequest('XHS_GET_SNAPSHOT', {
          sessionId: first!.sessionId, expectedNoteKey, cursor, ...(advance ? { advance: true } : {}),
        }), signal));
      }catch(err) {
        // Only these two known adapter errors can mean a temporary DOM rebuild.
        // Every retry still validates the same session/note and platform guards.
        if(!options.autoLoad || !(err instanceof AppError) || err.code!=='PARSE_FAILED' ||
          !['未找到评论列表容器','未找到评论容器，页面可能未加载完成或结构已变化'].includes(err.message))throw err;
        if(sample>=LIMITS.captureListWaitSamples)throw new AppError('PARSE_FAILED',`评论列表在5秒等待后仍未恢复；已保存 ${found.size} 条评论，请人工检查后继续`);
        advance=false; // The failed request may already have scrolled. Never scroll again while waiting.
        await report(true);
        await (options.wait??waitForLoad)(LIMITS.capturePollMs,signal);
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
    first = SnapshotPayload.parse(await ask(tabId, buildRequest('XHS_START_SESSION', { expectedNoteKey })));
    signal?.addEventListener('abort', abort, { once: true });
    await drain(first);
    await report(false);
    let stopReason: CaptureProgress['stopReason'] = null;
    const startedAt = Date.now();
    let idleRounds = 0;
    let quietMs=0;
    if (options.autoLoad) {
      for (let round = 0; round < LIMITS.captureMaxRounds; round++) {
        checkCancelled(signal);
        if (truncated) { stopReason = 'limit'; break; }
        if (endOfList) { stopReason = 'no_more'; break; }
        if (Date.now() - startedAt >= LIMITS.captureMaxDurationMs) { stopReason = 'time_limit'; break; }
        const before = found.size;
        const activityBefore=activityVersion;
        addedCount = 0;
        await report(true);
        await drain(await snapshot(null, true));
        for (let sample = 0; sample < LIMITS.captureSamplesPerRound && !truncated && !endOfList; sample++) {
          await (options.wait ?? waitForLoad)(LIMITS.capturePollMs, signal);
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
        if (round === LIMITS.captureMaxRounds - 1) stopReason = 'round_limit';
      }
    }
    checkCancelled(signal);
    await report(false, stopReason);
    return { noteKey: expectedNoteKey, parserVersion: status.parserVersion, note: note!, comments: [...found.values()], truncated, hasMoreLoaded, stopReason, displayedCommentCount };
  } catch (err) {
    await report(false, signal?.aborted ? 'cancelled' : 'error').catch(() => {});
    if (signal?.aborted) throw new AppError('CANCELLED', '评论采集已取消');
    throw err;
  } finally {
    signal?.removeEventListener('abort', abort);
    await stop();
  }
}
