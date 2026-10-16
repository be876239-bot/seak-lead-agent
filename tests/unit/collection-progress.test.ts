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
