import {describe,it,expect,vi} from 'vitest';
import {SerialDiscovery,type DiscoveryDeps} from '../../src/discovery/serial';

const urls=['note-a','note-b'];
function setup(overrides:Partial<DiscoveryDeps>={}) {
 const deps:DiscoveryDeps={navigate:vi.fn(async()=>{}),ready:vi.fn(async()=>{}),guard:vi.fn(async()=>{}),process:vi.fn(async()=>{}),changed:vi.fn(async()=>{}),now:()=>Date.now(),...overrides};
 return {deps,task:new SerialDiscovery(urls,deps)};
}
describe('post completion boundaries',()=>{
 it('completed process followed by a failed guard resumes the next post, not capture A again',async()=>{
  let processed=false,blocked=true;
  const {deps,task}=setup({process:vi.fn(async()=>{processed=true;}),guard:async()=>{if(processed&&blocked)throw new Error('安全验证');}});
  await task.run();expect(task.state.status).toBe('paused');
  blocked=false;await task.run();
  expect(vi.mocked(deps.process).mock.calls.map(c=>c[0])).toEqual(urls);
 });
 it('persists completed boundary across runner restoration',async()=>{
  let processed=false;
  const {deps,task}=setup({process:vi.fn(async()=>{processed=true;}),guard:async()=>{if(processed)throw new Error('页面暂停');}});
  await task.run();await task.flush();
  const restored=new SerialDiscovery(urls,{...deps,guard:async()=>{}},JSON.parse(JSON.stringify(task.state)));
  await restored.run();expect(vi.mocked(deps.process).mock.calls.map(c=>c[0])).toEqual(urls);
 });
 it.each([0,1])('unfinished post %i resumes itself after user pause',async index=>{
  let paused=false;const calls:string[]=[];
  const {task}=setup({process:async u=>{calls.push(u);if(u===urls[index]&&!paused){paused=true;task.pause();}}});
  await task.run();expect(task.state.index).toBe(index);await task.run();
  expect(calls).toEqual(index===0?['note-a','note-a','note-b']:['note-a','note-b','note-b']);
 });
 it('500 is a post boundary: explicit continue reaches B without recapturing A',async()=>{
  const {deps,task}=setup({process:vi.fn(async(_u,_s,p)=>{p(500,1);})});
  await task.run();expect(task.state.status).toBe('paused');expect(deps.navigate).toHaveBeenCalledTimes(1);
  await task.run();expect(task.state.status).toBe('completed');expect(vi.mocked(deps.process).mock.calls.map(c=>c[0])).toEqual(urls);
 });
 it('stop at boundary never navigates to B',async()=>{
  const {deps,task}=setup({process:async(_u,_s,p)=>{p(500,1);}});
  await task.run();task.stop();await task.run();expect(deps.navigate).toHaveBeenCalledTimes(1);expect(task.state.status).toBe('stopped');
 });
 it('platform failure during unfinished processing does not skip the note',async()=>{
  let blocked=true;const {deps,task}=setup({process:vi.fn(async()=>{if(blocked)throw new Error('CAPTCHA');})});
  await task.run();expect(task.state.index).toBe(0);blocked=false;await task.run();
  expect(vi.mocked(deps.process).mock.calls.map(c=>c[0])).toEqual(['note-a','note-a','note-b']);
 });
 it('explicit completion followed by user pause advances, including the last post',async()=>{
  const {deps,task}=setup({process:vi.fn(async(_u,_s,p,checkpoint)=>{p(40,2);await checkpoint.completed();task.pause();})});
  await task.run();expect(task.state.post?.stage).toBe('completed');await task.run();expect(task.state.index).toBe(1);
  await task.run();expect(task.state.status).toBe('completed');expect(deps.process).toHaveBeenCalledTimes(2);expect(deps.navigate).toHaveBeenCalledTimes(2);
 });
 it('captured checkpoint survives pause and restores to analysis for the same post',async()=>{
  let captured=0;const analyzed:string[]=[];
  const {deps,task}=setup({process:async(u,_s,_p,checkpoint)=>{
   if(checkpoint.post?.stage!=='captured'){captured++;await checkpoint.captured([u+':c1']);if(captured===1){task.pause();return;}}
   analyzed.push(u);
  }});
  await task.run();const restored=new SerialDiscovery(urls,deps,JSON.parse(JSON.stringify(task.state)));await restored.run();
  expect(captured).toBe(2);expect(analyzed).toEqual(urls);expect(restored.state.status).toBe('completed');task.stop();
 });
 it('completion checkpoint storage failure never starts another note',async()=>{
  const {deps,task}=setup({changed:async state=>{if(state.post?.stage==='completed')throw new Error('disk');}});
  await task.run();expect(task.state.status).toBe('stopped');expect(deps.navigate).toHaveBeenCalledTimes(1);
 });
 it('boundary continue keeps the original ten minute deadline',async()=>{
  let now=0;const {deps,task}=setup({now:()=>now,process:async(_u,_s,p)=>{p(500,1);}});
  await task.run();now=600001;await task.run();expect(task.state.status).toBe('stopped');expect(deps.navigate).toHaveBeenCalledTimes(1);
 });
 it('does not process B until navigation and readiness for B finish',async()=>{
  let release!:()=>void;let ready!:()=>void;
  const navigation=new Promise<void>(r=>{release=r;});const readiness=new Promise<void>(r=>{ready=r;});
  const {deps,task}=setup({navigate:async u=>{if(u===urls[1])await navigation;},ready:async u=>{if(u===urls[1])await readiness;}});
  const run=task.run();await vi.waitFor(()=>expect(deps.process).toHaveBeenCalledTimes(1));
  release();await Promise.resolve();expect(deps.process).toHaveBeenCalledTimes(1);ready();await run;
  expect(vi.mocked(deps.process).mock.calls.map(c=>c[0])).toEqual(urls);
 });
 it('late analysis progress from A cannot overwrite B counters or phase',async()=>{
  let late:((comments:number,leads:number)=>void)|undefined;
  const {task}=setup({process:async(u,_s,p)=>{if(u===urls[0]){p(40,2);late=p;}else{p(20,1);late?.(99,99);}}});
  await task.run();expect(task.state.comments).toBe(60);expect(task.state.leads).toBe(3);
 });
 it('restarting after a lower replay progress preserves per-note aggregate high water marks',async()=>{
  const {deps,task}=setup({process:async(_u,_s,p)=>{p(40,6);p(40,0);task.pause();}});
  await task.run();const restored=new SerialDiscovery(urls,{...deps,process:async(_u,_s,p)=>{p(40,6);}},JSON.parse(JSON.stringify(task.state)));
  await restored.run();expect(restored.state.comments).toBe(80);expect(restored.state.leads).toBe(12);task.stop();
 });
});
