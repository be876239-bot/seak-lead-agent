import { describe, expect, it } from 'vitest';
import { redactText, containsContact } from '../../src/privacy/redact';
import { buildClassificationInput, buildProfileInput } from '../../src/privacy/ai-payload';
import type { Comment, Note, ProductProfile } from '../../src/domain/schemas';

describe('redactText', () => {
  it('打码手机号、邮箱、身份证、带标签微信/QQ', () => {
    expect(containsContact('联系我 13812345678')).toBe(true);
    expect(containsContact('a.b@example.com')).toBe(true);
    expect(containsContact('身份证 11010119900307123X')).toBe(true);
    expect(containsContact('微信：xhs_buyer_001')).toBe(true);
    expect(containsContact('QQ 123456789')).toBe(true);
    for (const s of [
      '联系我 13812345678', 'a.b@example.com', '身份证 11010119900307123X',
      '微信：xhs_buyer_001', 'QQ 123456789',
    ]) {
      const out = redactText(s);
      expect(containsContact(out), out).toBe(false);
      expect(out).not.toContain('13812345678');
    }
  });

  it('重复处理结果稳定（幂等）', () => {
    const once = redactText('电话13812345678 或 email abc@qq.com');
    expect(redactText(once)).toBe(once);
  });

  it('保留业务信号：年份/价格/题号/数量不被简单删除', () => {
    const keep = '2026 年的题，50 元一套，第 123 题有坑，累计 1091 道真题';
    expect(redactText(keep)).toBe(keep);
  });

  it('昵称中的联系方式也打码', () => {
    expect(redactText('momo13812345678')).toContain('【已脱敏】');
  });
});

const profile: ProductProfile = {
  schemaVersion: 1,
  name: { value: '备考题库', status: 'observed', evidence: [] },
  category: { value: '竞赛备考', status: 'observed', evidence: [] },
  summary: { value: '历年真题练习网站', status: 'observed', evidence: [] },
  capabilities: [{ value: '历年真题', status: 'observed', evidence: [] }],
  targetAudience: [], needsServed: [], exclusions: [{ value: '不提供代答', status: 'observed', evidence: [] }],
  accessMethod: { value: '邀请码解锁', status: 'observed', evidence: [] },
  price: { value: null, status: 'unknown', evidence: [] },
  purchaseChannel: { value: null, status: 'unknown', evidence: [] },
  searchSuggestions: [],
};

const note: Note = {
  noteKey: 'xhs:n1', sourceUrl: 'https://www.xiaohongshu.com/explore/n1?xsec_token=SECRET',
  title: '备考分享', bodyExcerpt: '浙江网络安全知识挑战赛题库', capturedAt: '2026-10-15T00:00:00Z', parserVersion: 'xhs-dom-v1',
};

const mkComment = (over: Partial<Comment> = {}): Comment => ({
  commentKey: 'xhs:n1:c1', noteKey: 'xhs:n1', platformCommentId: 'c1', parentKey: null,
  text: '这个题库多少钱', authorDisplayName: '小明', authorLocalKey: 'u-123',
  profileUrl: 'https://www.xiaohongshu.com/user/profile/u-123', publishedText: null, publishedAt: null,
  likeCount: null, capturedAt: '2026-10-15T00:00:00Z', identityQuality: 'strong', truncated: false, ...over,
});

describe('AI 白名单 DTO', () => {
  it('产品来源进入画像请求前脱敏，不修改原始输入', () => {
    const blocks = [{ id: 's001', text: '在线题库，50 元。联系 13812345678 或 buyer@example.com' }];
    const out = buildProfileInput(blocks);
    expect(containsContact(out.blocks[0]!.text)).toBe(false);
    expect(out.blocks[0]!.text).toContain('50 元');
    expect(blocks[0]!.text).toContain('13812345678');
  });

  it('DTO 不含昵称、主页、用户 ID、完整 URL 与 token', () => {
    const parent = mkComment({ commentKey: 'xhs:n1:p1', platformCommentId: 'p1', text: '亲测好用' });
    const child = mkComment({ commentKey: 'xhs:n1:c2', platformCommentId: 'c2', parentKey: parent.commentKey, text: '哪里买' });
    const { input } = buildClassificationInput(profile, note, [parent, child], new Map([[parent.commentKey, parent]]), 12000);
    const json = JSON.stringify(input);
    expect(json).not.toContain('小明');
    expect(json).not.toContain('u-123');
    expect(json).not.toContain('user/profile');
    expect(json).not.toContain('xsec_token');
    expect(json).not.toContain('xiaohongshu.com');
    expect(input.items[1]!.parent?.text).toBe('亲测好用');
    expect(input.idMap.map((m) => m.tempId)).toEqual(['c001', 'c002']);
  });

  it('批次文本受预算约束，超预算条目不进入请求', () => {
    const comments = Array.from({ length: 10 }, (_, i) => mkComment({ commentKey: `xhs:n1:c${i}`, text: '求'.repeat(100) }));
    const { input, used } = buildClassificationInput(profile, note, comments, new Map(), 500);
    expect(input.items.length).toBeLessThan(10);
    expect(used).toBeLessThanOrEqual(500);
  });

  it('画像输入受 30000 字符预算约束并标记截断', () => {
    const blocks = Array.from({ length: 3 }, (_, i) => ({ id: `s00${i + 1}`, text: 'x'.repeat(15000) }));
    const out = buildProfileInput(blocks);
    expect(out.truncated).toBe(true);
    expect(out.blocks.reduce((n, b) => n + b.text.length, 0)).toBeLessThanOrEqual(30000);
  });
});
