import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, csvWithBom, toCsv } from '../../src/export/csv';
import { EXPORT_SCHEMA_VERSION, buildLeadsExport } from '../../src/export/json';

describe('CSV 单元格防护', () => {
  it('中文/引号/换行安全加引号转义', () => {
    expect(csvCell('你好，世界')).toBe('"你好，世界"');
    expect(csvCell('他说"贵"')).toBe('"他说""贵"""');
    expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"');
    expect(csvCell(null)).toBe('""');
  });

  it('= + - @ 公式前缀加单引号失效化', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+1-1')).toBe("\"'+1-1\"");
    expect(csvCell('-5') as string).toContain("'-5");
    expect(csvCell('@SUM(A1)')).toContain("'@SUM(A1)");
  });

  it('前置空白/制表符后的恶意前缀同样拦截；普通文本不误伤', () => {
    expect(csvCell('  =cmd')).toContain("'");
    expect(csvCell('\t=cmd')).toContain("'");
    expect(csvCell('价格 -100 元起')).not.toContain("'"); // 减号在词中间不误伤
    expect(csvCell('2026-10-15')).not.toContain("'");
  });

  it('整行/整表拼接与 BOM', () => {
    expect(csvRow(['a', 1, null])).toBe('"a","1",""');
    const text = toCsv([['h1', 'h2'], ['v', 2]]);
    expect(text.split('\r\n').length).toBe(2);
    const bommed = csvWithBom(text);
    expect(bommed.charCodeAt(0)).toBe(0xFEFF);
  });
});

describe('JSON 导出文档', () => {
  it('带 schemaVersion/profileVersion，过滤字段不含 Key/昵称/原始 DOM', () => {
    const product = {
      id: '1'.repeat(36), inputUrl: 'http://ex.com/p', finalUrl: 'https://ex.com/p',
      profileVersion: 2,
      profile: {
        schemaVersion: 1,
        name: { value: '产品A', status: 'observed', evidence: [] },
        category: { value: 'x', status: 'inferred', evidence: [] }, summary: { value: 's', status: 'inferred', evidence: [] },
        capabilities: [], targetAudience: [], needsServed: [], exclusions: [],
        accessMethod: { value: 'a', status: 'observed', evidence: [] },
        price: { value: null, status: 'unknown', evidence: [] },
        purchaseChannel: { value: null, status: 'unknown', evidence: [] },
        searchSuggestions: [],
      },
      sourceBlocks: [], modelId: 'qwen3.8-flash', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    } as never;
    const view = {
      group: 'high_intent', modelGroup: 'high_intent', source: 'model', correction: null, handled: false,
      comment: {
        commentKey: 'n:c1', noteKey: 'n', text: '多少钱？', authorDisplayName: '某昵称', authorLocalKey: 'k',
        platformCommentId: null, parentKey: null, profileUrl: null, publishedText: null, publishedAt: null,
        likeCount: null, capturedAt: '2026-10-10T00:00:00Z', truncated: false, identityQuality: 'weak',
      },
      analysis: {
        id: '2'.repeat(36), cacheKey: 'x'.repeat(20), productId: '1'.repeat(36), profileVersion: 2,
        commentKey: 'n:c1', contextHash: 'hhhhhhhh',
        decision: {
          commentId: 't1', relevance: 'direct', need: 'explicit', purchaseIntent: 'price_or_access',
          speakerRole: 'seeker', intentTarget: 'our_product', productFit: 'supported',
          needSummary: '询价', evidence: [{ sourceId: 't1:text', quote: '多少钱' }], reason: '直接询价', uncertainty: null,
        },
        group: 'high_intent', modelId: 'qwen3.8-flash', promptVersion: 'c-v1', ruleVersion: 'group-v1',
        createdAt: '2026-10-10T01:00:00Z',
      },
    } as never;
    const doc = buildLeadsExport({
      product: product as never, views: [view], noteUrls: { n: 'https://www.xiaohongshu.com/explore/abc' },
      filterLabel: '全部分组', exportedAt: '2026-10-16T00:00:00Z',
    });
    expect(doc.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(doc.product!.profileVersion).toBe(2);
    expect(doc.leads[0]!.analyzedWith.profileVersion).toBe(2);
    expect(doc.leads[0]!.noteUrl).toContain('xiaohongshu');
    const json = JSON.stringify(doc);
    expect(json).not.toContain('某昵称');
    expect(json).not.toContain('authorDisplayName');
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('sourceBlocks');
  });
});
