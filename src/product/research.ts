import { z } from 'zod';
import { ProductSourceSchema, type Product, type ProductSourceBlock } from '../domain/schemas';
import { LIMITS } from '../domain/limits';
import { AppError } from '../domain/errors';

export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const ResearchInputSchema = z.object({
  source: ProductSourceSchema,
  documentText: z.string().max(LIMITS.maxProductChars).optional(),
  notes: z.array(z.object({
    url: z.string().url().max(2048).refine(raw => {
      const u = new URL(raw);
      return u.protocol === 'https:' && ['www.xiaohongshu.com', 'xiaohongshu.com'].includes(u.hostname)
        && /^\/(explore|discovery\/item)\/[a-z0-9]{24}\/?$/i.test(u.pathname) && !u.username && !u.password;
    }, '请填写实际小红书笔记 URL'),
    title: z.string().trim().min(1).max(300),
    excerpt: z.string().trim().min(1).max(12000),
  })).max(2).optional(),
  searchConfirmed: z.boolean().optional(),
}).superRefine((v, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (v.source.kind === 'website') error('官网请使用网站读取入口');
  if (!v.source.description.trim()) error('请填写初步简单描述');
  if (v.source.kind === 'document' && (!v.documentText?.trim() || !v.source.fileName || !/\.(txt|md|markdown)$/i.test(v.source.fileName))) error('请选择非空 TXT/Markdown 文档');
  if (v.source.kind === 'xhs_product' && !v.source.productName?.trim()) error('产品名研究必须填写产品/品牌名称');
  if (v.source.kind === 'xhs_account' && !v.source.account?.trim()) error('账号研究必须填写独立的商家账号');
  if (v.source.kind.startsWith('xhs_') && (!v.searchConfirmed || !v.notes?.length)) error('请先手动研究，再填写实际笔记出处、标题和摘录');
});
export type ResearchInput = z.infer<typeof ResearchInputSchema>;

/** 文件仅按 UTF-8 数据读取，不渲染 HTML、不执行宏或文档指令。 */
export async function readProductDocument(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>) {
  if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error('暂仅支持 TXT/Markdown（UTF-8）；PDF/DOCX 请先导出为 TXT。');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('文档超过 512 KiB 上限');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) throw new Error('文档超过 512 KiB 上限');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('文档不是有效 UTF-8，请另存为 UTF-8 TXT/Markdown'); }
  if (!text.trim() || text.includes(String.fromCharCode(0))) throw new Error('文档为空或包含二进制内容，请使用 UTF-8 TXT/Markdown');
  return { text: text.slice(0, LIMITS.maxProductChars), truncated: text.length > LIMITS.maxProductChars };
}

export function researchBlocks(raw: ResearchInput): ProductSourceBlock[] {
  const input = ResearchInputSchema.parse(raw);
  const fetchedAt = new Date().toISOString();
  const blocks: ProductSourceBlock[] = [{ id: 'user_input', url: '', origin: 'user_provided', title: '用户提供（未经第三方核实）',
    text: JSON.stringify(input.source), fetchedAt }];
  if (input.source.kind === 'document') blocks.push({ id: 'document', url: '', origin: 'document', title: input.source.fileName,
    text: input.documentText!, fetchedAt });
  else input.notes?.forEach((n, i) => blocks.push({ id: `note${i + 1}`, url: n.url, origin: 'xhs_manual', title: n.title,
    text: `${n.title}\n${n.excerpt}`, fetchedAt }));
  return blocks;
}

/** 缺字段的历史官网产品兼容为已确认；新增来源缺状态则保守拒绝。 */
export function isProductConfirmed(product: Pick<Product, 'confirmation' | 'source'>): boolean {
  return product.confirmation === 'confirmed' || (!product.confirmation && !product.source);
}

export function requireConfirmedProduct(product: Pick<Product, 'confirmation' | 'source'>): void {
  if (!isProductConfirmed(product)) throw new AppError('PAGE_CHANGED', '产品画像仍为草稿，请先在产品页确认');
}
