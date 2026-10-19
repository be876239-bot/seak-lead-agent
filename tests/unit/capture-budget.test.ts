import {expect,it} from 'vitest';
import {CaptureBudgetClock,displayedCaptureBudget} from '../../src/xhs/capture-budget';
import {CaptureBudgetSchema} from '../../src/domain/schemas';
it.each([[50,180000,200],[100,180000,200],[200,360000,400],[350,630000,700],[500,900000,1000],[2000,900000,1000]])('显示%s条预算为%s毫秒/%s轮',(count,durationMs,maxRounds)=>{
 expect(displayedCaptureBudget(count)).toEqual({durationMs,maxRounds});
});
it.each([null,undefined,NaN,-1])('无效或未知总数%s用基础预算',n=>{expect(displayedCaptureBudget(n)).toEqual({durationMs:180000,maxRounds:200});});
it('未知总数：临近边界且60秒内确有进展才逐步延长，最多15分钟1000轮',()=>{
 let now=0;const b=new CaptureBudgetClock('note',undefined,()=>now);b.update(1,null);
 now=120000;b.update(1,null);expect(b.snapshot().durationMs).toBe(180000);
 b.update(2,null);expect(b.snapshot()).toMatchObject({durationMs:360000,maxRounds:400});
 now=130000;b.update(3,null);expect(b.snapshot().durationMs).toBe(360000);
 for(const [time,count] of [[300000,4],[480000,5],[660000,6],[840000,7]]){now=time!;b.update(count!,null);}
 expect(b.snapshot()).toMatchObject({durationMs:900000,maxRounds:1000});
 now=900000;expect(b.stopReason()).toBe('time_limit');
});
it('暂停冻结；恢复跨多个墙钟间隔累计时间和轮数而非重置',()=>{
 let now=0;let b=new CaptureBudgetClock('note',undefined,()=>now);
 for(let i=0;i<3;i++){now+=30000;b.consumeRound();b.freeze();const saved=b.snapshot();now+=3600000;expect(b.snapshot()).toEqual(saved);b=new CaptureBudgetClock('note',JSON.parse(JSON.stringify(saved)),()=>now);}
 expect(b.snapshot()).toMatchObject({elapsedMs:90000,rounds:3,durationMs:180000});
 now+=90000;expect(b.stopReason()).toBe('time_limit');
 b.freeze();b=new CaptureBudgetClock('note',b.snapshot(),()=>now+999999);expect(b.stopReason()).toBe('time_limit');
});
it('轮数不能通过重建预算超过1000；旧记录没有预算时基础初始化，拒绝跨帖复用',()=>{
 const b=new CaptureBudgetClock('a',undefined,()=>0);b.update(1,500);for(let i=0;i<1000;i++)b.consumeRound();
 expect(b.stopReason()).toBe('round_limit');expect(new CaptureBudgetClock('a',b.snapshot(),()=>0).stopReason()).toBe('round_limit');
 expect(()=>new CaptureBudgetClock('b',b.snapshot())).toThrow('预算所属笔记不一致');
 expect(CaptureBudgetSchema.safeParse({...b.snapshot(),rounds:1001}).success).toBe(false);
});
