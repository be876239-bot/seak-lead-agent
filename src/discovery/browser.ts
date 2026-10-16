import { browser } from 'wxt/browser';
import { AppError } from '../domain/errors';
import { buildRequest } from '../messaging/protocol';
import { ask, getNoteStatus } from '../xhs/capture';
import { noteKeyFromUrl, noteUrl } from '../xhs/discovery-dom';

export function assertRunning(signal: AbortSignal) {
  if(signal.aborted) throw new AppError('CANCELLED','任务已暂停或停止');
}
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  assertRunning(signal);
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new AppError('CANCELLED','任务已暂停或停止'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
/** 只保留一个前台任务标签；不关闭用户搜索页，不自动刷新，不发送网页写操作。 */
export class DiscoveryBrowser {
  tabId: number | null = null;
  private loading=false;
  private expected: string | null=null;
  constructor(private sourceId: number, tabId: number | null=null, expected: string | null=null) {this.tabId=tabId;this.expected=expected;}
  async guard() {
    const id=this.tabId??this.sourceId;
    if(this.loading)return; // 页面是否就绪由有30秒上限的ready负责。
    const tab=await browser.tabs.get(id);
    if(tab.url==='about:blank' && !this.expected)return;
    if(!tab.url?.startsWith('https://www.xiaohongshu.com/'))throw new AppError('PAGE_CHANGED','页面离开小红书或无法读取地址，任务暂停');
    await ask(id,buildRequest('XHS_GUARD',{}));
    if(this.expected) {
      if(noteKeyFromUrl(tab.url)!==this.expected)throw new AppError('PAGE_CHANGED','当前页面与任务笔记不一致');
      const status=await getNoteStatus(id);
      if(!status.supported || status.noteKey!==this.expected)throw new AppError('PARSE_FAILED','笔记结构异常，任务已暂停');
    }
  }
  async navigate(url: string, signal: AbortSignal) {
    assertRunning(signal); if(!noteUrl(url))throw new AppError('URL_INVALID','非公开笔记链接');
    this.loading=true;
    try {
      if(this.tabId===null) { const tab=await browser.tabs.create({url:'about:blank',active:true}); this.tabId=tab.id??null; }
      assertRunning(signal);
      if(this.tabId===null)throw new AppError('PERMISSION_DENIED','无法创建任务标签页');
      this.expected=noteKeyFromUrl(url);
      await browser.tabs.update(this.tabId,{url,active:true}); assertRunning(signal);
    } catch(e) {this.loading=false;throw e;}
  }
  async ready(url: string, externalSignal: AbortSignal) {
    assertRunning(externalSignal);
    const controller=new AbortController();const signal=controller.signal;
    const abort=()=>controller.abort();externalSignal.addEventListener('abort',abort,{once:true});
    let timedOut=false;
    const deadline=setTimeout(()=>{timedOut=true;controller.abort();},30000);
    let failures=0;
    try {
      for(let round=0;round<30;round++) {
        assertRunning(signal);
        const tab=await browser.tabs.get(this.tabId!);
        if(tab.status==='complete') {
          // 已加载页面的验证提示优先检查；仅脚本尚未就绪允许最多3次读查询，不刷新。
          try {
            await ask(this.tabId!,buildRequest('XHS_GUARD',{}),signal);
            if(!tab.url || !noteUrl(tab.url) || noteKeyFromUrl(tab.url)!==noteKeyFromUrl(url))throw new AppError('PAGE_CHANGED','笔记发生跳转或页面要求异常操作，请人工检查');
            const status=await getNoteStatus(this.tabId!,signal);assertRunning(signal);
            if(status.blocked)throw new AppError('PAGE_BLOCKED','平台限制：请人工验证或登录');
            if(status.supported && status.noteKey===noteKeyFromUrl(url))return;
            failures++;
          } catch(e) {
            if(!(e instanceof AppError) || e.code!=='PAGE_UNSUPPORTED')throw e;
            failures++;
          }
          if(failures>=3)throw new AppError('PARSE_FAILED','连续3次无法读取笔记结构，任务暂停；不会自动刷新');
        }
        await wait(1000,signal);
      }
      throw new AppError('PAGE_UNREACHABLE','页面30秒内未正常加载，任务暂停');
    } catch(e) {if(timedOut && !externalSignal.aborted)throw new AppError('PAGE_UNREACHABLE','页面30秒内未正常加载，任务暂停');throw e;}
    finally {clearTimeout(deadline);externalSignal.removeEventListener('abort',abort);this.loading=false;}
  }
}
