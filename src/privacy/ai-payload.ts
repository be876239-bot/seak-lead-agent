import type { Claim, Comment, Note, ProductProfile } from '../domain/schemas';
import { LIMITS } from '../domain/limits';

export type SourceBlockDto = { id: string; text: string };

export type ProfileInput = { blocks: SourceBlockDto[]; truncated: boolean };

export type ClassificationItem = {
  commentId: string;
  sourceId: string;
  text: string;
  parent: { sourceId: string; text: string } | null;
};

export type ClassificationInput = {
  product: {
    name: string | null;
    category: string | null;
    summary: string | null;
    capabilities: string[];
    targetAudience: string[];
    needsServed: string[];
    exclusions: string[];
    accessMethod: string | null;
    price: string | null;
  };
  note: { sourceId: 'n001'; text: string };
  items: ClassificationItem[];
  idMap: { commentKey: string; tempId: string }[];
};

const claimText = (c: Claim | undefined): string | null => c?.value ?? null;

const claimList = (cs: Claim[], cap: number): string[] =>
  cs.map((c) => c.value).filter((v): v is string => v !== null).slice(0, cap);

/** 产品来源块 → 画像输入。总字符预算 maxProductChars，超出截断并标记。 */
export function buildProfileInput(blocks: SourceBlockDto[]): ProfileInput {
  const out: SourceBlockDto[] = [];
  let total = 0;
  let truncated = false;
  for (const b of blocks) {
    const remaining = LIMITS.maxProductChars - total;
    if (remaining <= 0) { truncated = true; break; }
    if (b.text.length > remaining) {
      out.push({ id: b.id, text: b.text.slice(0, remaining) });
      truncated = true;
      break;
    }
    out.push({ id: b.id, text: b.text });
    total += b.text.length;
  }
  return { blocks: out, truncated };
}

export type ClassificationInputBudget = { used: number; full: boolean };

/** 评论 → 意向判断输入。只取白名单字段；昵称/主页/平台 ID/URL 一律不进 DTO。 */
export function buildClassificationInput(
  profile: ProductProfile,
  note: Note,
  comments: Comment[],
  parentLookup: Map<string, Comment>,
  budgetChars: number,
): { input: ClassificationInput; used: number } {
  const productClaims: Claim[] = [
    profile.name, profile.category, profile.summary, profile.accessMethod, profile.price,
    ...profile.capabilities, ...profile.targetAudience, ...profile.needsServed, ...profile.exclusions,
  ];
  const productTextLen = productClaims.reduce((n, c) => n + (c.value?.length ?? 0), 0);
  const noteText = note.bodyExcerpt.slice(0, LIMITS.maxNoteChars);
  let used = productTextLen + noteText.length;

  const items: ClassificationItem[] = [];
  const idMap: { commentKey: string; tempId: string }[] = [];
  const parentTemp = new Map<string, string>();
  let seq = 0;
  let parentSeq = 0;

  for (const c of comments) {
    const est = c.text.length + (c.parentKey ? (parentLookup.get(c.parentKey)?.text.length ?? 0) : 0);
    if (used + est > budgetChars) break;
    used += est;
    const commentId = `c${String(++seq).padStart(3, '0')}`;
    let parent: ClassificationItem['parent'] = null;
    if (c.parentKey) {
      const p = parentLookup.get(c.parentKey);
      if (p) {
        let pid = parentTemp.get(c.parentKey);
        if (!pid) {
          pid = `p${String(++parentSeq).padStart(3, '0')}`;
          parentTemp.set(c.parentKey, pid);
        }
        parent = { sourceId: `${pid}:text`, text: p.text };
      }
    }
    items.push({ commentId, sourceId: `${commentId}:text`, text: c.text, parent });
    idMap.push({ commentKey: c.commentKey, tempId: commentId });
  }

  return {
    input: {
      product: {
        name: claimText(profile.name),
        category: claimText(profile.category),
        summary: claimText(profile.summary),
        capabilities: claimList(profile.capabilities, LIMITS.maxProfileList),
        targetAudience: claimList(profile.targetAudience, LIMITS.maxProfileList),
        needsServed: claimList(profile.needsServed, LIMITS.maxProfileList),
        exclusions: claimList(profile.exclusions, LIMITS.maxProfileList),
        accessMethod: claimText(profile.accessMethod),
        price: claimText(profile.price),
      },
      note: { sourceId: 'n001', text: noteText },
      items,
      idMap,
    },
    used,
  };
}
