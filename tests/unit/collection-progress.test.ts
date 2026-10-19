import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CollectionProgressView from '../../src/ui/CollectionProgress';

it('采集中实时显示计数、加载状态和未知总量', () => {
  document.body.innerHTML = renderToStaticMarkup(createElement(CollectionProgressView, {
    progress: { discoveredCount: 40, addedCount: 20, loading: true, stopReason: null },
  }));
  expect(document.body.textContent).toContain('已发现 40 条');
  expect(document.body.textContent).toContain('本轮新增 20 条');
  expect(document.body.textContent).toContain('正在滚动');
  expect(document.body.textContent).toContain('尚未确认');
});

it('无新增停止不能渲染成已采集全部', () => {
  document.body.innerHTML = renderToStaticMarkup(createElement(CollectionProgressView, {
    progress: { discoveredCount: 40, addedCount: 0, loading: false, stopReason: 'no_new' },
  }));
  expect(document.body.textContent).toContain('无法确认是否全部');
  expect(document.body.textContent).not.toContain('已采集全部');
});

it('分类计数和回复加载状态可见，旧任务缺计数不伪造为零回复',()=>{
 document.body.innerHTML=renderToStaticMarkup(createElement(CollectionProgressView,{progress:{discoveredCount:137,addedCount:2,loading:true,stopReason:null,topLevelCount:82,replyCount:55,loadingReplies:true}}));
 expect(document.body.textContent).toContain('一级评论：82');expect(document.body.textContent).toContain('回复：55');expect(document.body.textContent).toContain('正在加载回复');
});

it('未关联回复单独提示且计入回复数量',()=>{
 document.body.innerHTML=renderToStaticMarkup(createElement(CollectionProgressView,{progress:{discoveredCount:16,addedCount:1,loading:false,stopReason:'no_new',topLevelCount:10,replyCount:6,unresolvedReplyCount:2}}));
 expect(document.body.textContent).toContain('有 2 条回复缺少父评论上下文');
 expect(document.body.textContent).toContain('一级评论：10');
});

it('D021 展示实际动态预算与累计耗时轮数',async()=>{
 const {CaptureBudgetClock}=await import('../../src/xhs/capture-budget');const b=new CaptureBudgetClock('note',undefined,()=>0);b.update(1,350);
 document.body.innerHTML=renderToStaticMarkup(createElement(CollectionProgressView,{progress:{discoveredCount:1,addedCount:1,loading:true,stopReason:null,budget:b.snapshot()}}));
 expect(document.body.textContent).toContain('0 / 630 秒');expect(document.body.textContent).toContain('0 / 700');
});

it('回复加载超时显示非阻塞警告，不冒充完整',()=>{
 document.body.innerHTML=renderToStaticMarkup(createElement(CollectionProgressView,{progress:{discoveredCount:274,addedCount:0,loading:true,stopReason:null,replyLoadWarningCount:1}}));
 expect(document.body.textContent).toContain('1 组回复加载未确认');expect(document.body.textContent).toContain('继续采集其他内容');
 expect(document.body.textContent).toContain('结果可能不完整');
});
