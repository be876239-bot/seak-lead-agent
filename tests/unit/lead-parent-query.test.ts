import 'fake-indexeddb/auto';
import {afterEach,expect,it,vi} from 'vitest';
import type{Comment}from '../../src/domain/schemas';
vi.mock('wxt/browser',()=>({browser:{}}));
const {ui,getLeadComments}=await import('../../src/ui/store');
const {getDb}=await import('../../src/storage/db');
const record=(commentKey:string,noteKey:string,parentKey:string|null):Comment=>({commentKey,noteKey,parentKey,text:commentKey,platformCommentId:null,authorDisplayName:null,authorLocalKey:null,profileUrl:null,publishedText:null,publishedAt:null,likeCount:null,capturedAt:new Date().toISOString(),identityQuality:'weak',truncated:false});
afterEach(async()=>{await getDb().comments.clear();});
it('仅回复参与分析时，线索查询仍补取本地真实父评论',async()=>{
 await ui.putComments([record('parent','note',null),record('reply','note','parent')]);
 const result=await getLeadComments(['reply']);expect(result.map(c=>c.commentKey)).toEqual(['reply','parent']);
});
it('父评论不存在或跨笔记时不拼接错误上下文，旧一级评论可直接读取',async()=>{
 await ui.putComments([record('parent','other-note',null),record('reply','note','parent'),record('top','note',null)]);
 expect((await getLeadComments(['reply'])).map(c=>c.commentKey)).toEqual(['reply']);expect((await getLeadComments(['top']))[0]?.parentKey).toBeNull();
});
