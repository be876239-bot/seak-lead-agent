import { describe, expect, it } from 'vitest';
import {
  isProductConfirmed,
  MAX_DOCUMENT_BYTES,
  readProductDocument,
  ResearchInputSchema,
  researchBlocks,
  requireConfirmedProduct,
} from '../../src/product/research';

const note = {
  url: 'https://www.xiaohongshu.com/explore/123456789012345678901234',
  title: '眼镜框试戴分享',
  excerpt: '这款镜框戴起来比较轻，鼻托也舒服。',
};
const description = '这是一款眼镜，想了解它的特点和适合的人群。';
function fakeFile(name: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

describe('multi-source product research', () => {
  it('distinguishes product-name research from merchant-account research', () => {
    const productName = ResearchInputSchema.safeParse({
      source: { kind: 'xhs_product', productName: 'Massing', category: '眼镜', description },
      notes: [note], searchConfirmed: true,
    });
    const account = ResearchInputSchema.safeParse({
      source: { kind: 'xhs_account', account: 'Massing 官方账号', targetProduct: '轻量镜框', description },
      notes: [note], searchConfirmed: true,
    });
    expect(productName.success).toBe(true);
    expect(account.success).toBe(true);
    expect(ResearchInputSchema.safeParse({
      source: { kind: 'xhs_product', account: 'Massing 官方账号', description },
      notes: [note], searchConfirmed: true,
    }).success).toBe(false);
    expect(ResearchInputSchema.safeParse({
      source: { kind: 'xhs_account', productName: 'Massing', description },
      notes: [note], searchConfirmed: true,
    }).success).toBe(false);
  });

  it('requires explicit confirmation and at least one actual note for XHS research', () => {
    const base = { source: { kind: 'xhs_product', productName: 'Massing', description } };
    expect(ResearchInputSchema.safeParse({ ...base, notes: [note], searchConfirmed: false }).success).toBe(false);
    expect(ResearchInputSchema.safeParse({ ...base, notes: [], searchConfirmed: true }).success).toBe(false);
    expect(ResearchInputSchema.safeParse({ ...base, notes: [note], searchConfirmed: true }).success).toBe(true);
  });

  it('creates evidence blocks that preserve source identity and distinguish user input', () => {
    const blocks = researchBlocks({
      source: { kind: 'xhs_product', productName: 'Massing', category: '眼镜', description },
      notes: [note], searchConfirmed: true,
    });
    expect(blocks.map(block => block.id)).toEqual(['user_input', 'note1']);
    expect(blocks[0]?.origin).toBe('user_provided');
    expect(blocks[0]?.title).toContain('未经第三方核实');
    expect(blocks[1]?.origin).toBe('xhs_manual');
    expect(blocks[1]?.url).toBe(note.url);
    expect(blocks[1]?.text).toContain(note.excerpt);
  });

  it('reads bounded UTF-8 Markdown and rejects unsupported formats or oversized files', async () => {
    await expect(readProductDocument(fakeFile('product.md', '# 产品\n这是产品介绍'))).resolves.toMatchObject({
      text: '# 产品\n这是产品介绍', truncated: false,
    });
    await expect(readProductDocument(fakeFile('product.pdf', 'not a real pdf'))).rejects.toThrow('暂仅支持 TXT/Markdown');
    const huge = { name: 'huge.txt', size: MAX_DOCUMENT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) };
    await expect(readProductDocument(huge)).rejects.toThrow('512 KiB');
  });

  it('truncates long documents to the profile budget and rejects empty or invalid UTF-8', async () => {
    const result = await readProductDocument(fakeFile('long.txt', 'a'.repeat(35_000)));
    expect(result.text).toHaveLength(30_000);
    expect(result.truncated).toBe(true);
    await expect(readProductDocument(fakeFile('empty.md', '   '))).rejects.toThrow('文档为空');
    const invalidBytes = Uint8Array.from([0xff]);
    const invalid = { name: 'bad.txt', size: 1, arrayBuffer: async () => invalidBytes.buffer };
    await expect(readProductDocument(invalid)).rejects.toThrow('不是有效 UTF-8');
  });

  it('treats legacy website products as confirmed but blocks new drafts until confirmed', () => {
    expect(isProductConfirmed({})).toBe(true);
    expect(isProductConfirmed({ source: { kind: 'document', description: '' }, confirmation: 'draft' })).toBe(false);
    expect(isProductConfirmed({ source: { kind: 'document', description: '' }, confirmation: 'confirmed' })).toBe(true);
    expect(() => requireConfirmedProduct({ source: { kind: 'document', description: '' }, confirmation: 'draft' }))
      .toThrow('仍为草稿');
    expect(() => requireConfirmedProduct({})).not.toThrow();
  });
});
