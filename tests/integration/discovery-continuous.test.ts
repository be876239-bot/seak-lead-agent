import {expect,it,vi} from 'vitest';
import {SerialDiscovery,type DiscoveryDeps,type DiscoveryState} from '../../src/discovery/serial';
const urls=['a','b','c'];
function setup(overrides:Partial<DiscoveryDeps>={}){
 const states:DiscoveryState[]=[];
 const deps:DiscoveryDeps={now:()=>Date.now(),guard:async()=>{},navigate:vi.fn(async()=>{}),ready:vi.fn(async()=>{}),process:vi.fn(async(_u,_s,p)=>{p(500,2);}),changed:async s=>{states.push(s);},...overrides};
 return {task:new SerialDiscovery(urls,deps),deps,states};
}
it.each([40,500])('three posts at %i comments run to completion with no paused publication or Continue',async count=>{
 const {task,deps,states}=setup({process:vi.fn(async(_u,_s,p)=>{p(count,2);})});
 await task.run();expect(task.state.status).toBe('completed');expect(task.state.index).toBe(3);
 expect(vi.mocked(deps.process).mock.calls.map(c=>c[0])).toEqual(urls);expect(deps.navigate).toHaveBeenCalledTimes(3);
 expect(states.some(s=>s.status==='paused')).toBe(false);expect(task.state.comments).toBe(count*3);
});
it.each(['登录要求','扫码验证','CAPTCHA'])('second post %s pauses without opening the third',async reason=>{
 const {task,deps}=setup({ready:async u=>{if(u==='b')throw new Error(reason);}});
 await task.run();expect(task.state.status).toBe('paused');expect(task.state.reason).toBe(reason);
 expect(vi.mocked(deps.navigate).mock.calls.map(c=>c[0])).toEqual(['a','b']);expect(deps.process).toHaveBeenCalledTimes(1);
});
it('next navigation waits for the completed checkpoint to persist',async()=>{
 let release!:()=>void;const saved=new Promise<void>(r=>{release=r;});let reached=false;
 const {task,deps}=setup({changed:async s=>{if(s.index===0&&s.post?.stage==='completed'){reached=true;await saved;}}});
 const pending=task.run();await vi.waitFor(()=>expect(reached).toBe(true));expect(deps.navigate).toHaveBeenCalledTimes(1);
 release();await pending;expect(deps.navigate).toHaveBeenCalledTimes(3);expect(task.state.status).toBe('completed');
});
