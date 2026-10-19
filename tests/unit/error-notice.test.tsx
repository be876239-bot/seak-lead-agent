import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ErrorNotice from '../../src/ui/ErrorNotice';

it('shows what happened, impact, next step, and keeps technical detail collapsed', () => {
  const html = renderToStaticMarkup(createElement(ErrorNotice, {
    message: '候选帖子当前不在已加载搜索DOM中；队列保留，请正常加载原结果后继续',
    code: 'PAGE_CHANGED',
  }));
  expect(html).toContain('网页和任务记录对不上了');
  expect(html).toContain('当前影响');
  expect(html).toContain('建议操作');
  expect(html).toContain('<details');
  expect(html).toContain('技术详情（排查时再展开）');
  expect(html).toContain('搜索DOM');
});

it('does not render an empty error notice', () => {
  expect(renderToStaticMarkup(createElement(ErrorNotice, { message: '' }))).toBe('');
});
