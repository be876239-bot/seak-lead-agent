import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import LeadExplanation from '../../src/ui/LeadExplanation';
import type { Decision } from '../../src/domain/schemas';

const decision: Decision = {
  commentId: 'c001', relevance: 'direct', need: 'explicit', purchaseIntent: 'solution_seeking',
  speakerRole: 'seeker', intentTarget: 'category', productFit: 'supported',
  needSummary: '模拟：寻找客户管理工具', evidence: [{ sourceId: 'c001:text', quote: '求推荐' }],
  reason: '评论明确求推荐，需求与产品能力匹配；仍需人工核实。<script>bad()</script>',
  uncertainty: '尚未确认预算',
};

it('渲染理由与不确定点，主页只作为用户点击链接，模型文本不执行 HTML', () => {
  document.body.innerHTML = renderToStaticMarkup(createElement(LeadExplanation, {
    decision, profileUrl: 'https://www.xiaohongshu.com/user/profile/synthetic',
  }));
  expect(document.body.textContent).toContain(decision.reason);
  expect(document.body.textContent).toContain('尚未确认预算');
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('a')?.getAttribute('rel')).toBe('noreferrer');
  expect(document.querySelector('a')?.getAttribute('target')).toBe('_blank');
});

it.each([null, 'javascript:alert(1)', 'file:///private'])('无效主页 %s 不生成链接', (profileUrl) => {
  document.body.innerHTML = renderToStaticMarkup(createElement(LeadExplanation, { decision, profileUrl }));
  expect(document.querySelector('a')).toBeNull();
});
