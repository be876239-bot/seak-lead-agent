import {readFileSync} from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SerialDiscovery, type DiscoveryDeps, type DiscoveryState } from '../../src/discovery/serial';
import { LIMITS } from '../../src/domain/limits';
import { readSearchNotes, platformBlock, noteKeyFromUrl, noteUrl } from '../../src/xhs/discovery-dom';

const urls = Array.from({length: 8}, (_,i) => `https://www.xiaohongshu.com/explore/${String(i+1).padStart(24,'a')}`);
function setup(overrides: Partial<DiscoveryDeps> = {}) {
  const deps: DiscoveryDeps = { navigate: vi.fn(async () => {}), ready: vi.fn(async () => {}),
    process: vi.fn(async (_u, _s, progress) => { progress(40, 6); }), guard: vi.fn(async () => {}),
    changed: vi.fn(async () => {}), now: () => Date.now(), ...overrides };
  return { deps, task: new SerialDiscovery(urls, deps) };
}
function search() { document.body.innerHTML = `<section class="note-item"><a href="${urls[0]}">note</a><a href="${urls[0]}">duplicate</a></section><section class="note-item"><a href="https://evil.test/explore/${'a'.repeat(24)}">bad</a></section>`; }

describe('bounded serial discovery', () => {
  it('search cards yield normal same-origin note links, stable dedup, exclude other origins', () => { search(); expect(readSearchNotes(document, 'https://www.xiaohongshu.com/search_result?keyword=AI')).toEqual([urls[0]]); });
  it('refuses non-search source pages', () => { search(); expect(() => readSearchNotes(document, urls[0]!)).toThrow(); });
  it('extracts up to 100 unique notes from already-loaded search cards when configured', () => {
    document.body.innerHTML=Array.from({length:120},(_,i)=>`<section class="note-item"><a href="https://www.xiaohongshu.com/explore/${String(i+1).padStart(24,'a')}">note</a></section>`).join('');
    const found=readSearchNotes(document,'https://www.xiaohongshu.com/search_result?keyword=AI',100);
    expect(found).toHaveLength(100);expect(new Set(found.map(noteKeyFromUrl)).size).toBe(100);
  });
  it('configures a 100-post queue while keeping serial execution', async () => {
    const many=Array.from({length:120},(_,i)=>`note-${i}`);const {deps}=setup();
    const task=new SerialDiscovery(many,deps,undefined,100);await task.run();
    expect(task.state.status).toBe('completed');expect(task.state.total).toBe(100);expect(deps.navigate).toHaveBeenCalledTimes(100);expect(deps.process).toHaveBeenCalledTimes(100);
  });
  it('navigates at most five notes serially and waits for readiness before processing', async () => {
    const order: string[] = []; let concurrent = 0;
    const {task} = setup({navigate: async u => { expect(concurrent).toBe(0); concurrent++; order.push('navigate:'+u); }, ready: async () => { order.push('ready'); }, process: async (u) => { order.push('process:'+u); concurrent--; }});
    await task.run(); expect(task.state.status).toBe('completed'); expect(order).toHaveLength(15);
    for(let i=0;i<5;i++) expect(order.slice(i*3,i*3+3)).toEqual(['navigate:'+urls[i], 'ready', 'process:'+urls[i]]);
  });
  it('maintains note-local progress without mixing note A into B', async () => {
    const seen: number[] = []; const {task} = setup({ process: async (_u,_s,p) => { seen.push(task.state.currentComments); p(40,2); } });
    await task.run(); expect(seen).toEqual([0,0,0,0,0]); expect(task.state.comments).toBe(200); expect(task.state.leads).toBe(10);
  });
  it.each(['pause','stop'] as const)('%s aborts current operation and opens no next note', async action => {
    const {task,deps} = setup({process: async (_u,signal) => { task[action](); expect(signal.aborted).toBe(true); }});
    await task.run(); expect(task.state.status).toBe(action==='pause'?'paused':'stopped'); expect(deps.navigate).toHaveBeenCalledTimes(1);
  });
  it('resume is explicit, drained, rechecks guard and does not navigate past a blocked note', async () => {
    const guard = vi.fn(async () => { throw new Error('安全验证'); }); const {task,deps}=setup({guard});
    await task.run(); expect(task.state.status).toBe('paused'); expect(deps.navigate).not.toHaveBeenCalled();
    await task.run(); expect(guard).toHaveBeenCalledTimes(2); expect(deps.navigate).not.toHaveBeenCalled();
  });
  it('500-comment per-post cap allows all five posts to finish automatically', async () => {
    const {task,deps}=setup({process: async (_u,_s,p) => { p(500,1); }}); await task.run();
    expect(task.state.status).toBe('completed'); expect(deps.navigate).toHaveBeenCalledTimes(5); expect(task.state.comments).toBe(2500); expect(task.state.reason).toBeNull();
  });
  it('has no task-wide deadline and pauses when one post active timeout expires', async () => {
    vi.useFakeTimers();try {
      const {task,deps}=setup({postTimeoutMs:1000,process:async(_u,signal)=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))});
      const pending=task.run();await vi.advanceTimersByTimeAsync(1000);await pending;
      expect(task.state.status).toBe('paused');expect(task.state.reason).toContain('主动处理达到');expect(deps.navigate).toHaveBeenCalledTimes(1);
    } finally {vi.useRealTimers();}
  });
  it('paused time does not consume the single-post active timeout budget', async () => {
    vi.useFakeTimers();try {
      let calls=0;const {task,deps}=setup({postTimeoutMs:1000,process:async(_u,signal)=>{
        if(++calls===1){await new Promise<void>(resolve=>setTimeout(resolve,400));task.pause();return;}
        await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));
      }});
      const first=task.run();await vi.advanceTimersByTimeAsync(400);await first;
      expect(task.state.status).toBe('paused');expect(task.state.postElapsedMs).toBe(400);
      await vi.advanceTimersByTimeAsync(5000);expect(task.state.status).toBe('paused');
      const resumed=task.run();await vi.advanceTimersByTimeAsync(599);expect(task.state.status).toBe('running');
      await vi.advanceTimersByTimeAsync(1);await resumed;
      expect(task.state.status).toBe('paused');expect(task.state.reason).toContain('主动处理达到');expect(deps.navigate).toHaveBeenCalledTimes(2);
    } finally {vi.useRealTimers();}
  });
  it.each(['CAPTCHA','登录失效','页面结构异常','浏览器权限异常','连续加载失败'])('%s pauses once without refresh or automatic retry', async message => {
    const {task,deps}=setup({ready:async()=>{throw new Error(message);}}); await task.run();
    expect(task.state.status).toBe('paused'); expect(task.state.reason).toContain(message); expect(deps.navigate).toHaveBeenCalledTimes(1); expect(deps.process).not.toHaveBeenCalled();
  });
  it('concurrent run calls do not open parallel tabs', async () => { const {task,deps}=setup(); await Promise.all([task.run(),task.run(),task.run()]); expect(deps.navigate).toHaveBeenCalledTimes(5); });
  it('ignores late progress after cancellation', async () => { const {task}=setup({process:async(_u,_s,p)=>{task.stop();p(99,9);}}); await task.run(); expect(task.state.comments).toBe(0); });
  it('detects verification/login/risk prompts without scanning comment prose', () => {
    for(const text of ['请完成安全验证','请拖动滑块','账号异常','请登录后继续']) { document.body.innerHTML=`<div role="dialog">${text}</div>`; expect(platformBlock(document)).not.toBeNull(); }
    document.body.innerHTML='<div class="content">我的产品是验证码服务</div>'; expect(platformBlock(document)).toBeNull();
  });
  it('hidden obsolete verification elements do not block', () => { document.body.innerHTML='<div role="dialog" style="display:none">安全验证</div>'; expect(platformBlock(document)).toBeNull(); });
});

it('timer guard interrupts an in-flight operation on verification and never opens next note',async()=>{
 vi.useFakeTimers();try {
  let guarded=0;
  const {task,deps}=setup({guard:async()=>{if(++guarded>=3)throw new Error('安全验证');},process:async(_u,signal)=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))});
  const pending=task.run();await vi.advanceTimersByTimeAsync(501);await pending;
  expect(task.state.status).toBe('paused');expect(task.state.reason).toBe('安全验证');expect(deps.navigate).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('single-post timeout pauses in-flight work without a task-wide cutoff',async()=>{
 vi.useFakeTimers();try{
 const {task,deps}=setup({postTimeoutMs:1000,process:async(_u,signal)=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))});
 const pending=task.run();await vi.advanceTimersByTimeAsync(1000);await pending;
 expect(task.state.status).toBe('paused');expect(task.state.reason).toContain('主动处理达到');expect(deps.navigate).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});

it('单篇整体看门狗随采集预算延长，并为AI分析保留30分钟余量',async()=>{
 vi.useFakeTimers();try{
  const captureBudget={noteKey:'note-a',displayedCommentCount:LIMITS.maxSessionComments,elapsedMs:0,rounds:0,durationMs:LIMITS.captureHardDurationMs,maxRounds:LIMITS.captureHardRounds,progressCount:0,lastProgressElapsedMs:0,extensionCount:0,lastExtensionElapsedMs:0};
  const restored:DiscoveryState={status:'paused',index:0,total:urls.length,comments:0,currentComments:0,leads:0,currentLeads:0,phase:'paused',reason:null,postElapsedMs:0,post:{stage:'capturing',commentKeys:[],captureBudget}};
  const {deps}=setup({process:async(_u,signal,_progress,checkpoint)=>{
   await checkpoint.budget(captureBudget);
   await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));
  }});
  const task=new SerialDiscovery(urls,deps,restored);const pending=task.run();
  await vi.advanceTimersByTimeAsync(31*60_000);
  expect(task.state.status).toBe('running');
  task.pause();await pending;expect(task.state.status).toBe('paused');
 }finally{vi.useRealTimers();}
});
it('restored task preserves per-post elapsed time and aggregate counts',async()=>{
 const {deps}=setup();const task=new SerialDiscovery(urls,deps,{status:'paused',index:2,total:5,comments:80,currentComments:0,leads:12,currentLeads:0,phase:'paused',reason:null,postElapsedMs:1234});
 await task.run();expect(deps.navigate).toHaveBeenCalledTimes(3);expect(task.state.comments).toBe(200);expect(task.state.leads).toBe(30);
});
it('resume of partly captured note does not double count progress',async()=>{
 let count=0;const {task}=setup({process:async(_u,_s,p)=>{p(40,6);if(++count===1)task.pause();}});
 await task.run();await task.run();expect(task.state.comments).toBe(200);expect(task.state.leads).toBe(30);
});

it('暂停很久不会自动退出或消耗单篇主动运行预算',async()=>{
 vi.useFakeTimers();try{const {task}=setup({postTimeoutMs:1000,process:async()=>{task.pause();}});await task.run();await vi.advanceTimersByTimeAsync(3600000);expect(task.state.status).toBe('paused');expect(task.state.postElapsedMs).toBe(0);}finally{vi.useRealTimers();}
});

it('历史真实脱敏fixture的卡片结构可提取5篇；仅替换匿名ID为格式合法的合成ID',()=>{
 document.body.innerHTML=readFileSync('tests/fixtures/xhs/feed-only.html','utf8').replace(/anonnote(\d+)/g,(_m,n)=>String(n).padStart(24,'a'));
 const found=readSearchNotes(document,'https://www.xiaohongshu.com/search_result?keyword=AI');expect(found).toHaveLength(5);expect(new Set(found.map(noteKeyFromUrl)).size).toBe(5);
});
it('search_result笔记路由与正常链接查询参数按原样保留，仅限同源公开路径',()=>{
 const value='https://www.xiaohongshu.com/search_result/'+ 'a'.repeat(24)+'?source=synthetic';expect(noteUrl(value)).toBe(value);expect(noteKeyFromUrl(value)).toBe('xhs:'+'a'.repeat(24));
 expect(noteUrl('https://u:p@www.xiaohongshu.com/explore/'+ 'a'.repeat(24))).toBeNull();
});

it('返回搜索失败时保留已完成索引，手动继续只重试返回，不重新分析完成帖子',async()=>{
 const finish=vi.fn(async()=>{if(finish.mock.calls.length===1)throw new Error('返回失败');});const {deps}=setup();const task=new SerialDiscovery(urls.slice(0,1),{...deps,finish});
 await task.run();expect(task.state.status).toBe('paused');expect(task.state.index).toBe(1);await task.run();expect(task.state.status).toBe('completed');expect(deps.process).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledTimes(2);
});
it('高评论数帖子不会阻止后续帖子和最终返回搜索',async()=>{
 const finish=vi.fn(async()=>{});const {task}=setup({finish,process:async(_u,_s,p)=>{p(LIMITS.maxSessionComments,1);}});await task.run();expect(finish).toHaveBeenCalledTimes(1);expect(task.state.status).toBe('completed');expect(task.state.comments).toBe(LIMITS.maxSessionComments*5);
});
