import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildError, buildOk } from '../../src/messaging/protocol';
import type { Comment, Note } from '../../src/domain/schemas';
import { AppError } from '../../src/domain/errors';
import { LIMITS } from '../../src/domain/limits';

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock('wxt/browser', () => ({ browser: { tabs: { sendMessage } } }));

const { captureNote, captureIncompleteReason } = await import('../../src/xhs/capture');
const { parseDisplayedCommentCount } = await import('../../src/xhs/adapter');

const NOTE_KEY = 'xhs:abcdef';
const TS = '2026-10-15T00:00:00Z';

const note: Note = {
  noteKey: NOTE_KEY, sourceUrl: 'https://www.xiaohongshu.com/explore/abcdef',
  title: '笔记标题', bodyExcerpt: '正文摘录', capturedAt: TS, parserVersion: 'xhs-v1',
};

function comment(id: string): Comment {
  return {
    commentKey: `${NOTE_KEY}:c${id}`, noteKey: NOTE_KEY, platformCommentId: null, parentKey: null,
    text: `评论${id}`, authorDisplayName: null, authorLocalKey: null, profileUrl: null,
    publishedText: null, publishedAt: null, likeCount: null,
    capturedAt: TS, identityQuality: 'weak', truncated: false,
  };
}

function snapshot(comments: Comment[], nextCursor: string | null, extra: Record<string, unknown> = {}) {
  return {
    sessionId: 's1', noteKey: NOTE_KEY, parserVersion: 'xhs-v1', capturedAt: TS,
    note, comments, hasMoreLoaded: false, truncated: false, nextCursor, ...extra,
  };
}

const statusOk = (over: Record<string, unknown> = {}) =>
  buildOk('r', { noteKey: NOTE_KEY, parserVersion: 'xhs-v1', supported: true, blocked: false, ...over });

type Handlers = Record<string, (req: { requestId: string; type: string }) => unknown>;

function route(handlers: Handlers): void {
  sendMessage.mockImplementation((_tabId: number, req: { requestId: string; type: string }) => {
    const h = handlers[req.type];
    return Promise.resolve(h
      ? h(req)
      : buildError(req.requestId, { code: 'UNKNOWN', message: '未路由', retryable: false }));
  });
}

beforeEach(() => { sendMessage.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('captureNote 采集编排', () => {
  it('a temporarily missing list preserves saved comments and retries without another scroll',async()=>{
    let calls=0;const wait=vi.fn(async()=>{});const saved:string[]=[];
    route({XHS_GET_STATUS:()=>statusOk(),XHS_START_SESSION:()=>buildOk('r',snapshot([comment('1')],null)),
      XHS_GET_SNAPSHOT:()=>++calls<3?buildError('r',{code:'PARSE_FAILED',message:'未找到评论列表容器',retryable:false}):buildOk('r',snapshot([comment('2')],null,{truncated:true})),
      XHS_STOP_SESSION:()=>buildOk('r',{stopped:true})});
    const result=await captureNote(7,{autoLoad:true,wait,onDelta:async(_note,comments)=>{saved.push(...comments.map(c=>c.commentKey));}});
    expect(result.comments).toHaveLength(2);expect(saved).toEqual([comment('1').commentKey,comment('2').commentKey]);expect(wait).toHaveBeenCalledTimes(2);
    const requests=sendMessage.mock.calls.map(([,r])=>r).filter(r=>r.type==='XHS_GET_SNAPSHOT');
    expect(requests.map(r=>r.payload.advance===true)).toEqual([true,false,false]);
  });
  it.each(['persistent','cancelled','blocked','changed','other-parse'])('missing-list wait remains bounded and guarded: %s',async mode=>{
    const ac=new AbortController();let calls=0;const wait=vi.fn(async()=>{if(mode==='cancelled')ac.abort();});
    route({XHS_GET_STATUS:()=>statusOk(),XHS_START_SESSION:()=>buildOk('r',snapshot([comment('1')],null)),
      XHS_GET_SNAPSHOT:()=>{calls++;return buildError('r',calls>1&&mode==='blocked'?{code:'PAGE_BLOCKED',message:'安全验证',retryable:false}:calls>1&&mode==='changed'?{code:'PAGE_CHANGED',message:'页面变化',retryable:false}:{code:'PARSE_FAILED',message:mode==='other-parse'?'回复父关系异常':'未找到评论列表容器',retryable:false});},
      XHS_STOP_SESSION:()=>buildOk('r',{stopped:true})});
    await expect(captureNote(7,{autoLoad:true,signal:ac.signal,wait})).rejects.toMatchObject({code:mode==='cancelled'?'CANCELLED':mode==='blocked'?'PAGE_BLOCKED':mode==='changed'?'PAGE_CHANGED':'PARSE_FAILED'});
    expect(wait).toHaveBeenCalledTimes(mode==='persistent'?10:mode==='other-parse'?0:1);expect(calls).toBe(mode==='persistent'?11:mode==='other-parse'||mode==='cancelled'?1:2);
    expect(sendMessage.mock.calls.at(-1)![1].type).toBe('XHS_STOP_SESSION');
  });
  it('采集中页面消息不返回，取消仍能立即终止等待并发送STOP', async () => {
    const ac = new AbortController();
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], null)),
      XHS_GET_SNAPSHOT: () => { queueMicrotask(() => ac.abort()); return new Promise(() => {}); },
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    await expect(captureNote(7, { autoLoad: true, signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(sendMessage.mock.calls.at(-1)![1].type).toBe('XHS_STOP_SESSION');
  });

  it('页面消息超时有明确错误，不无限等待', async () => {
    vi.useFakeTimers();
    sendMessage.mockReturnValue(new Promise(() => {}));
    const assertion = expect(captureNote(7)).rejects.toMatchObject({ code: 'PARSE_FAILED', retryable: true });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });

  it('按 cursor 翻页汇总全部评论，结束后必发 STOP', async () => {
    let snapCalls = 0;
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], 'c2')),
      XHS_GET_SNAPSHOT: () => {
        snapCalls += 1;
        return snapCalls === 1
          ? buildOk('r', snapshot([comment('2')], 'c3'))
          : buildOk('r', snapshot([comment('3')], null));
      },
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    const cap = await captureNote(7);
    expect(cap.comments.map((c) => c.commentKey)).toEqual([
      `${NOTE_KEY}:c1`, `${NOTE_KEY}:c2`, `${NOTE_KEY}:c3`,
    ]);
    expect(cap.note.noteKey).toBe(NOTE_KEY);
    expect(cap.hasMoreLoaded).toBe(false);
    expect(cap.truncated).toBe(false);
    const types = sendMessage.mock.calls.map(([, req]) => (req as { type: string }).type);
    expect(types).toEqual(['XHS_GET_STATUS', 'XHS_START_SESSION', 'XHS_GET_SNAPSHOT', 'XHS_GET_SNAPSHOT', 'XHS_STOP_SESSION']);
  });

  it('翻页中途报错也执行 STOP；错误码原样抛出', async () => {
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], 'c2')),
      XHS_GET_SNAPSHOT: () => buildError('r', { code: 'SNAPSHOT_EXPIRED', message: '缓冲已变化', retryable: true }),
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    await expect(captureNote(7)).rejects.toMatchObject({ code: 'SNAPSHOT_EXPIRED' });
    const types = sendMessage.mock.calls.map(([, req]) => (req as { type: string }).type);
    expect(types[types.length - 1]).toBe('XHS_STOP_SESSION');
  });

  it('blocked → PAGE_BLOCKED；unsupported → PAGE_UNSUPPORTED；均不建会话', async () => {
    route({ XHS_GET_STATUS: () => statusOk({ blocked: true, noteKey: null, supported: false }) });
    await expect(captureNote(7)).rejects.toMatchObject({ code: 'PAGE_BLOCKED' });

    route({ XHS_GET_STATUS: () => statusOk({ supported: false }) });
    await expect(captureNote(7)).rejects.toMatchObject({ code: 'PAGE_UNSUPPORTED' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('标签页不可达（消息抛错）→ PAGE_UNSUPPORTED 且可重试', async () => {
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    const err = await captureNote(99).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('PAGE_UNSUPPORTED');
    expect(err.retryable).toBe(true);
  });

  it('hasMoreLoaded 与 truncated 跨页取或；不谎称全部评论', async () => {
    route({
      XHS_GET_STATUS: () => statusOk(),
      XHS_START_SESSION: () => buildOk('r', snapshot([comment('1')], 'c2', { hasMoreLoaded: true })),
      XHS_GET_SNAPSHOT: () => buildOk('r', snapshot([comment('2')], null, { truncated: true, note: null })),
      XHS_STOP_SESSION: () => buildOk('r', { stopped: true }),
    });
    const cap = await captureNote(7);
    expect(cap.hasMoreLoaded).toBe(true);
    expect(cap.truncated).toBe(true);
    expect(cap.note.title).toBe('笔记标题');
  });

  it('reads only the verified comment total selector and supports 万 units', () => {
    document.body.innerHTML = '<div id="noteContainer"><div class="comments-el"><div class="total">共 1.2万 条评论</div></div></div>';
    expect(parseDisplayedCommentCount(document)).toBe(12000);
    document.querySelector('.total')!.textContent = '共 86 条评论';
    expect(parseDisplayedCommentCount(document)).toBe(86);
    document.querySelector('.total')!.textContent = '评论加载中';
    expect(parseDisplayedCommentCount(document)).toBeNull();
  });
});

describe('D021 动态预算采集循环',()=>{
 function runPage(total:number|null){
   route({XHS_GET_STATUS:()=>statusOk(),XHS_START_SESSION:()=>buildOk('r',snapshot([comment('1')],null,{displayedCommentCount:total,atBottom:false})),
     XHS_GET_SNAPSHOT:()=>buildOk('r',snapshot([comment('1')],null,{displayedCommentCount:total,atBottom:false})),XHS_STOP_SESSION:()=>buildOk('r',{stopped:true})});
 }
 it.each([[100,180000,72],[200,360000,144],[350,630000,252],[500,900000,360]])('显示%s条实际循环到%s毫秒，推进%s轮',async(total,elapsed,rounds)=>{
   runPage(total);let now=0;let saved:import('../../src/domain/schemas').CaptureBudget|undefined;
   const r=await captureNote(7,{autoLoad:true,now:()=>now,wait:async ms=>{now+=ms;},onBudget:async b=>{saved=b;}});
   expect(r.stopReason).toBe('time_limit');expect(now).toBe(elapsed);
   expect(saved?.rounds).toBe(rounds);expect(r.comments).toHaveLength(1);
   expect(sendMessage.mock.calls.filter(([,q])=>q.type==='XHS_GET_SNAPSHOT'&&q.payload.advance)).toHaveLength(rounds!);
 });
 it('动态轮数上限350条可运行700轮而非固定200轮',async()=>{
   runPage(350);let saved:import('../../src/domain/schemas').CaptureBudget|undefined;
   const r=await captureNote(7,{autoLoad:true,now:()=>0,wait:async()=>{},onBudget:async b=>{saved=b;}});
   expect(r.stopReason).toBe('round_limit');expect(saved?.rounds).toBe(700);
 });
 it('暂停后复用剩余预算，反复继续已耗尽预算不会再滚动',async()=>{
   runPage(200);let now=0;let saved:import('../../src/domain/schemas').CaptureBudget|undefined;
   const ac=new AbortController();
   await expect(captureNote(7,{autoLoad:true,signal:ac.signal,now:()=>now,onBudget:async b=>{saved=b;},wait:async ms=>{now+=ms;if(now===60000)ac.abort();}})).rejects.toMatchObject({code:'CANCELLED'});
   expect(saved?.elapsedMs).toBe(60000);const rounds=saved!.rounds;
   now+=3600000;
   const r=await captureNote(7,{autoLoad:true,initialBudget:saved,now:()=>now,onBudget:async b=>{saved=b;},wait:async ms=>{now+=ms;}});
   expect(r.stopReason).toBe('time_limit');expect(saved?.elapsedMs).toBe(360000);expect(saved!.rounds).toBeGreaterThan(rounds);
   const advances=()=>sendMessage.mock.calls.filter(([,q])=>q.type==='XHS_GET_SNAPSHOT'&&q.payload.advance).length;const before=advances();
   for(let i=0;i<3;i++){now+=3600000;const again=await captureNote(7,{autoLoad:true,initialBudget:saved,now:()=>now,onBudget:async b=>{saved=b;}});expect(again.stopReason).toBe('time_limit');}
   expect(advances()).toBe(before);
 });
 it('大量评论预算仍可在底部持续安静后早停',async()=>{
   route({XHS_GET_STATUS:()=>statusOk(),XHS_START_SESSION:()=>buildOk('r',snapshot([comment('1')],null,{displayedCommentCount:500,atBottom:true})),XHS_GET_SNAPSHOT:()=>buildOk('r',snapshot([comment('1')],null,{displayedCommentCount:500,atBottom:true})),XHS_STOP_SESSION:()=>buildOk('r',{stopped:true})});
   let now=0;const r=await captureNote(7,{autoLoad:true,now:()=>now,wait:async ms=>{now+=ms;}});expect(r.stopReason).toBe('no_new');expect(now).toBe(15000);
 });
});

it('未知数量在持续新评论时逐档延长而非3分钟停止，最终仍在15分钟停止',async()=>{
 let now=0;const budgets=new Set<number>();
 const page=()=>snapshot(Array.from({length:Math.floor(now/30000)+1},(_,i)=>comment(String(i))),null,{displayedCommentCount:null,atBottom:false,loadingComments:true});
 route({XHS_GET_STATUS:()=>statusOk(),XHS_START_SESSION:()=>buildOk('r',page()),XHS_GET_SNAPSHOT:()=>buildOk('r',page()),XHS_STOP_SESSION:()=>buildOk('r',{stopped:true})});
 const r=await captureNote(7,{autoLoad:true,now:()=>now,wait:async ms=>{now+=ms;},onBudget:async b=>{budgets.add(b.durationMs);}});
 expect(r.stopReason).toBe('time_limit');expect(now).toBe(900000);expect([...budgets]).toEqual([180000,360000,540000,720000,900000]);
 expect(r.comments.length).toBeGreaterThan(6);expect(r.comments.length).toBeLessThan(LIMITS.maxSessionComments);
});

it('触及单帖上限或显示数高于采集数时，统一判定为不完整',()=>{
 const capped=captureIncompleteReason({comments:Array.from({length:LIMITS.maxSessionComments},(_,i)=>comment(String(i))),truncated:true,stopReason:'limit',displayedCommentCount:1500});
 expect(capped).toContain(`${LIMITS.maxSessionComments}条单帖安全上限`);expect(capped).toContain('跳过 AI 分析');
 const short=captureIncompleteReason({comments:[comment('one')],truncated:false,stopReason:'no_new',displayedCommentCount:1500});
 expect(short).toContain('当前采集到1条');
 const matched=captureIncompleteReason({comments:Array.from({length:1500},(_,i)=>comment(String(i))),truncated:false,stopReason:'no_new',displayedCommentCount:1500});
 expect(matched).toBeNull();
 const unknown=captureIncompleteReason({comments:[comment('one')],truncated:false,stopReason:'no_new',displayedCommentCount:null});
 expect(unknown).toBeNull();
 const timeBudget=captureIncompleteReason({comments:[comment('one')],truncated:false,stopReason:'time_limit',displayedCommentCount:1500});
 expect(timeBudget).toContain('累计时间预算');
 const roundBudget=captureIncompleteReason({comments:[comment('one')],truncated:false,stopReason:'round_limit',displayedCommentCount:1500});
 expect(roundBudget).toContain('累计轮数预算');
});

it('回复加载警告即使显示数匹配或未知仍触发共享不完整分析门禁',async()=>{
 const {captureIncompleteReason}=await import('../../src/xhs/capture');
 const base={comments:[comment('1')],truncated:false,stopReason:'no_new' as const,replyLoadWarningCount:1};
 expect(captureIncompleteReason({...base,displayedCommentCount:1})).toContain('回复展开后未确认');
 expect(captureIncompleteReason({...base,displayedCommentCount:null})).toContain('跳过 AI 分析');
 expect(captureIncompleteReason({...base,replyLoadWarningCount:0,displayedCommentCount:1})).toBeNull();
});

it('评论先保存，相邻advance之间保留至少2.5秒的增量采样',async()=>{
 let now=0;let advances=0;let saved=false;const times:number[]=[];
 route({XHS_GET_STATUS:()=>statusOk(),XHS_START_SESSION:()=>buildOk('r',snapshot([comment('1')],null)),
 XHS_GET_SNAPSHOT:raw=>{const req=raw as unknown as {payload:{advance?:boolean}};if(req.payload.advance){expect(saved).toBe(true);times.push(now);advances++;}return buildOk('r',snapshot([comment('1')],null,{atBottom:false,truncated:advances>=3}));},
 XHS_STOP_SESSION:()=>buildOk('r',{stopped:true})});
 await captureNote(7,{autoLoad:true,now:()=>now,onDelta:async()=>{saved=true;},wait:async ms=>{now+=ms;}});
 expect(times).toEqual([0,2500,5000]);
});
