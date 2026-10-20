/** Synthetic UI-only fixture. No real user, credential, or platform data. */
import { ProductSchema, CommentSchema, AnalysisSchema, JobSchema, NoteSchema } from '../../../src/domain/schemas';
const at = '2026-10-20T00:00:00.000Z';
const claim = (value: string) => ({ value, status: 'observed', evidence: [] });
export const uiProduct = ProductSchema.parse({
  id: '11111111-1111-4111-8111-111111111111', inputUrl: 'https://example.com/product', finalUrl: 'https://example.com/product',
  profileVersion: 1, createdAt: at, updatedAt: at, modelId: 'synthetic', promptVersion: 'synthetic', sourceBlocks: [],
  profile: { schemaVersion: 1, name: claim('Gamma · 合成产品'), category: claim('AI 演示文稿工具'), summary: claim('将想法组织成清晰的演示文稿，适合一人公司准备客户提案。'),
    capabilities: [claim('生成提纲与演示文稿'), claim('在线编辑与分享')], targetAudience: [claim('一人公司与咨询顾问')], needsServed: [claim('减少重复排版时间')], exclusions: [],
    accessMethod: claim('网页版'), price: { value: null, status: 'unknown', evidence: [] }, purchaseChannel: claim('官网'),
    searchSuggestions: ['AI PPT', '公司提案怎么快速做 PPT', '客户演示文稿排版工具推荐'] },
});
export const uiNotes = ['6a826ba00000000008013140','6a313f28000000001503cfe0'].map((id,i) => NoteSchema.parse({
  noteKey: `xhs:${id}`, sourceUrl: `https://www.xiaohongshu.com/explore/${id}`, title: i ? '给客户做提案，如何整理演示文稿？（合成）' : 'AI PPT 工具的实际使用讨论（合成）',
  bodyExcerpt: '这是隔离的合成测试内容，用于检查标题、正文摘要、评论数量、证据和详情，不代表真实平台验收。', capturedAt: at, parserVersion: 'synthetic',
}));
export const uiComments = ['公司需要做商用演示文稿，想了解怎么收费，有没有团队方案？', '这个产品好用吗？', '我需要给客户展示项目方案，内容很多，想找能减少排版时间的工具。'.repeat(4)].map((text,i)=>CommentSchema.parse({
  commentKey: `synthetic:c${i}`, noteKey: uiNotes[0]!.noteKey, platformCommentId: `synthetic-${i}`, parentKey: i===2?'synthetic:c1':null, isReply:i===2,
  text, authorDisplayName: ['测试用户甲','测试用户乙','测试回复用户'][i], authorLocalKey:null, profileUrl:'https://example.com/profile', locationText:'合成地区', publishedText:'今天', publishedAt:null, likeCount:null,capturedAt:at,identityQuality:'strong',truncated:false,
}));
export const uiAnalyses = [0,2].map((i)=>AnalysisSchema.parse({
  id:i===0?'22222222-2222-4222-8222-222222222222':'33333333-3333-4333-8333-333333333333',cacheKey:`synthetic-cache-${i}`,productId:uiProduct.id,profileVersion:1,commentKey:uiComments[i]!.commentKey,contextHash:'synthetic-hash',
  decision:{commentId:`c${i}`,relevance:'direct',need:'explicit',purchaseIntent:i===0?'explicit_buy':'unknown',speakerRole:'seeker',intentTarget:'our_product',productFit:'supported',needSummary:i===0?'公司商用，询问收费与团队方案':'希望减少客户提案的排版时间',evidence:[{sourceId:`c${i}`,quote:uiComments[i]!.text.slice(0,40)}],reason:'合成判断：评论明确描述具体工作需求，保留原文供人工核实。',uncertainty:'预算和采购时间尚未确认。'},group:i===0?'high_intent':'need',modelId:'synthetic',promptVersion:'synthetic',ruleVersion:'group-v2',createdAt:at,
}));
export const uiJob = JobSchema.parse({
 id:'44444444-4444-4444-8444-444444444444',kind:'discovery',status:'collecting',ownerId:'synthetic',generation:0,productId:uiProduct.id,profileVersion:1,tabId:1,noteKey:uiNotes[1]!.noteKey,provider:'synthetic',modelId:'synthetic',promptVersion:'synthetic',totalItems:2,completedItems:1,failedItems:0,createdAt:at,updatedAt:at,errorCode:null,
 collection:{discoveredCount:19,addedCount:3,topLevelCount:12,replyCount:7,loading:true,loadingReplies:true,displayedCommentCount:30,countStatus:'below_displayed_total',stopReason:null},
 discovery:{status:'running',index:1,total:2,comments:73,currentComments:19,leads:2,currentLeads:0,targets:uiNotes.map(n=>n.sourceUrl),sourceTabId:1,phase:'正在加载回复……',reason:null,direction:'AI PPT',completedNoteKeys:[uiNotes[0]!.noteKey],partialPosts:1,post:{stage:'capturing',commentKeys:[]}},
});
