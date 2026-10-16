import {readFileSync} from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SerialDiscovery, type DiscoveryDeps } from '../../src/discovery/serial';
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
  it('500-comment guard prevents any further note navigation', async () => {
    const {task,deps}=setup({process: async (_u,_s,p) => { p(500,1); }}); await task.run();
    expect(task.state.status).toBe('completed'); expect(deps.navigate).toHaveBeenCalledTimes(1); expect(task.state.reason).toContain('500');
  });
  it('wall-clock deadline stops without another navigation', async () => {
    let now=0; const {task,deps}=setup({now:()=>now,process:async()=>{now=600001;}}); await task.run();
    expect(task.state.status).toBe('stopped'); expect(deps.navigate).toHaveBeenCalledTimes(1);
  });
  it('deadline also applies to paused time and cannot be reset by Continue', async () => {
    let now=0; const {task,deps}=setup({now:()=>now,process:async()=>{task.pause();}}); await task.run(); now=600001; await task.run();
    expect(deps.navigate).toHaveBeenCalledTimes(1); expect(task.state.status).toBe('stopped');
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
it('time limit aborts in-flight work without waiting for it to finish normally',async()=>{
 vi.useFakeTimers();try{
 const {task,deps}=setup({process:async(_u,signal)=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))});
 const pending=task.run();await vi.advanceTimersByTimeAsync(600000);await pending;
 expect(task.state.status).toBe('stopped');expect(deps.navigate).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('restored task preserves deadline and aggregate counts rather than resetting task limits',async()=>{
 const {deps}=setup();const task=new SerialDiscovery(urls,deps,{status:'paused',index:2,total:5,comments:80,currentComments:0,leads:12,currentLeads:0,phase:'paused',reason:null,deadline:Date.now()+10000});
 await task.run();expect(deps.navigate).toHaveBeenCalledTimes(3);expect(task.state.comments).toBe(200);expect(task.state.leads).toBe(30);
});
it('resume of partly captured note does not double count progress',async()=>{
 let count=0;const {task}=setup({process:async(_u,_s,p)=>{p(40,6);if(++count===1)task.pause();}});
 await task.run();await task.run();expect(task.state.comments).toBe(200);expect(task.state.leads).toBe(30);
});

it('暂停期间截止时间到达也会停止，不能后台无限等待',async()=>{
 vi.useFakeTimers();try{const {task}=setup({process:async()=>{task.pause();}});await task.run();await vi.advanceTimersByTimeAsync(600000);expect(task.state.status).toBe('stopped');}finally{vi.useRealTimers();}
});

it('历史真实脱敏fixture的卡片结构可提取5篇；仅替换匿名ID为格式合法的合成ID',()=>{
 document.body.innerHTML=readFileSync('tests/fixtures/xhs/feed-only.html','utf8').replace(/anonnote(\d+)/g,(_m,n)=>String(n).padStart(24,'a'));
 const found=readSearchNotes(document,'https://www.xiaohongshu.com/search_result?keyword=AI');expect(found).toHaveLength(5);expect(new Set(found.map(noteKeyFromUrl)).size).toBe(5);
});
it('search_result笔记路由与正常链接查询参数按原样保留，仅限同源公开路径',()=>{
 const value='https://www.xiaohongshu.com/search_result/'+ 'a'.repeat(24)+'?source=synthetic';expect(noteUrl(value)).toBe(value);expect(noteKeyFromUrl(value)).toBe('xhs:'+'a'.repeat(24));
 expect(noteUrl('https://u:p@www.xiaohongshu.com/explore/'+ 'a'.repeat(24))).toBeNull();
});
