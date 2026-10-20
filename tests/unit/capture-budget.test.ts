import {expect,it} from 'vitest';
import {CaptureBudgetClock,displayedCaptureBudget} from '../../src/xhs/capture-budget';
import {CaptureBudgetSchema} from '../../src/domain/schemas';
it.each([[50,300000,200],[100,300000,200],[200,600000,400],[350,1050000,700],[500,1500000,1000],[2000,6000000,4000]])('显示%s条预算为%s毫秒/%s轮',(count,durationMs,maxRounds)=>{
 expect(displayedCaptureBudget(count)).toEqual({durationMs,maxRounds});
});
it.each([null,undefined,NaN,-1])('无效或未知总数%s用5分钟基础预算',n=>{expect(displayedCaptureBudget(n)).toEqual({durationMs:300000,maxRounds:200});});
it('未知总数：仅在持续进展且接近边界时逐档延长5分钟/200轮，最多100分钟/4000轮',()=>{
 let now=0;const b=new CaptureBudgetClock('note',undefined,()=>now);b.update(1,null);
 now=180000;b.update(1,null);expect(b.snapshot().durationMs).toBe(300000);
 now=240000;b.update(2,null);expect(b.snapshot()).toMatchObject({durationMs:600000,maxRounds:400});
 now=250000;b.update(3,null);expect(b.snapshot().durationMs).toBe(600000);
 let count=3;
 for(let i=1;i<19;i++){now=b.snapshot().durationMs-60000;b.update(++count,null);}
 expect(b.snapshot()).toMatchObject({durationMs:6000000,maxRounds:4000});
 now=6000000;expect(b.stopReason()).toBe('time_limit');
});
it('暂停冻结；恢复跨多个墙钟间隔累计时间和轮数而非重置',()=>{
 let now=0;let b=new CaptureBudgetClock('note',undefined,()=>now);
 for(let i=0;i<3;i++){now+=30000;b.consumeRound();b.freeze();const saved=b.snapshot();now+=3600000;expect(b.snapshot()).toEqual(saved);b=new CaptureBudgetClock('note',JSON.parse(JSON.stringify(saved)),()=>now);}
 expect(b.snapshot()).toMatchObject({elapsedMs:90000,rounds:3,durationMs:300000});
 now+=210000;expect(b.stopReason()).toBe('time_limit');
 b.freeze();b=new CaptureBudgetClock('note',b.snapshot(),()=>now+999999);expect(b.stopReason()).toBe('time_limit');
});
it('轮数最多4000，旧D021预算仍可恢复并升级到新时间预算',()=>{
 const b=new CaptureBudgetClock('a',undefined,()=>0);b.update(1,2000);for(let i=0;i<4000;i++)b.consumeRound();
 expect(b.stopReason()).toBe('round_limit');expect(new CaptureBudgetClock('a',b.snapshot(),()=>0).stopReason()).toBe('round_limit');
 expect(()=>new CaptureBudgetClock('b',b.snapshot())).toThrow('预算所属笔记不一致');
 expect(CaptureBudgetSchema.safeParse({...b.snapshot(),rounds:4001}).success).toBe(false);
 const legacy={...new CaptureBudgetClock('legacy',undefined,()=>0).snapshot(),durationMs:180000,maxRounds:1000};
 const restored=new CaptureBudgetClock('legacy',legacy,()=>0);restored.update(1,100);
 expect(restored.snapshot()).toMatchObject({durationMs:300000,maxRounds:1000});
});
