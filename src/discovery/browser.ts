import { browser } from 'wxt/browser';
import { z } from 'zod';
import { AppError } from '../domain/errors';
import type { DiscoveryNavigation } from '../domain/schemas';
import { buildRequest } from '../messaging/protocol';
import { ask, getNoteStatus } from '../xhs/capture';
import { noteKeyFromUrl, noteUrl } from '../xhs/discovery-dom';
import { sameSearch } from '../xhs/navigation';

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
const SearchState=z.object({sourceUrl:z.string().url(),isSearch:z.boolean(),hasNote:z.boolean()});
/** 复用原搜索标签，只点击当前真实入口和正常后退；不创建标签、不直接写目标URL。 */
export class DiscoveryBrowser {
  readonly tabId:number;
  private loading=false;
  navigation:DiscoveryNavigation;
  constructor(sourceId:number,navigation:DiscoveryNavigation,private changed:(state:DiscoveryNavigation)=>Promise<void>=async()=>{}) {
    this.tabId=sourceId;this.navigation={...navigation};
  }
  private async save(phase:DiscoveryNavigation['phase'],expectedNoteKey=this.navigation.expectedNoteKey) {
    this.navigation={...this.navigation,phase,expectedNoteKey};await this.changed({...this.navigation});
  }
  private async tab() {
    const tab=await browser.tabs.get(this.tabId);
    if(!tab.url?.startsWith('https://www.xiaohongshu.com/'))throw new AppError('PAGE_CHANGED','页面离开小红书或无法读取地址，任务已暂停');
    return tab;
  }
  private async search(signal?:AbortSignal) {return SearchState.parse(await ask(this.tabId,buildRequest('XHS_SEARCH_STATE',{}),signal));}
  async guard() {
    if(this.loading){
      await this.tab();
      try{await ask(this.tabId,buildRequest('XHS_GUARD',{}));}
      catch(e){if(!(e instanceof AppError)||e.code!=='PAGE_UNSUPPORTED')throw e;}
      return; // 文档正常卸载期间允许脚本暂不可用；30秒的转换等待仍在生效。
    }
    const tab=await this.tab();await ask(this.tabId,buildRequest('XHS_GUARD',{}));
    if(this.navigation.phase==='search') {
      const state=await this.search();
      if(!sameSearch(tab.url!,this.navigation.sourceUrl)||!sameSearch(state.sourceUrl,this.navigation.sourceUrl)||state.hasNote||!state.isSearch)throw new AppError('PAGE_CHANGED','当前页面不是原搜索结果，任务已暂停');
    }else {
      if(!noteUrl(tab.url!)||noteKeyFromUrl(tab.url!)!==this.navigation.expectedNoteKey)throw new AppError('PAGE_CHANGED','当前页面与任务笔记不一致');
      const status=await getNoteStatus(this.tabId);
      if(!status.supported||status.blocked||status.noteKey!==this.navigation.expectedNoteKey)throw new AppError('PARSE_FAILED','笔记结构异常或需要人工处理，任务已暂停');
    }
  }
  /** 仅用户明确继续时同步实际页面；运行中擅自换页仍由guard暂停。 */
  async reconcile(allowedNoteKey?:string) {
    const tab=await this.tab();await ask(this.tabId,buildRequest('XHS_GUARD',{}));
    if(sameSearch(tab.url!,this.navigation.sourceUrl)) {
      const state=await this.search();if(state.isSearch&&!state.hasNote){await this.save('search',null);return;}
    }
    const expected=this.navigation.expectedNoteKey??allowedNoteKey;
    if(expected&&noteUrl(tab.url!)&&noteKeyFromUrl(tab.url!)===expected) {
      const status=await getNoteStatus(this.tabId);if(status.supported&&!status.blocked&&status.noteKey===expected){await this.save('note',expected);return;}
    }
    throw new AppError('PAGE_CHANGED','无法与原搜索结果或待处理笔记对应，请人工检查后继续；队列保留');
  }
  async navigate(url:string,signal:AbortSignal) {
    assertRunning(signal);const expected=noteKeyFromUrl(url);
    if(this.navigation.phase==='note'&&this.navigation.expectedNoteKey===expected){await this.guard();assertRunning(signal);return;}
    if(this.navigation.phase!=='search')await this.returnToSearch(signal);
    await this.guard();assertRunning(signal);this.loading=true;
    try {
      await this.save('opening',expected);assertRunning(signal);
      try {
        z.object({clicked:z.literal(true),noteKey:z.string()}).parse(await ask(this.tabId,buildRequest('XHS_CLICK_NOTE',{expectedSearchUrl:this.navigation.sourceUrl,expectedNoteKey:expected}),signal));
      } catch(e) {
        // 正常链接可能卸载旧文档、导致响应端口关闭。只确认已经进入同一目标，绝不补点或强跳URL。
        if(!(e instanceof AppError)||e.code!=='PAGE_UNSUPPORTED')throw e;
        const tab=await this.tab();if(!noteUrl(tab.url!)||noteKeyFromUrl(tab.url!)!==expected)throw e;
      }
      assertRunning(signal);
    }catch(e){this.loading=false;throw e;}
  }
  private async poll(target:'note'|'search',externalSignal:AbortSignal) {
    assertRunning(externalSignal);const controller=new AbortController();const signal=controller.signal;
    const abort=()=>controller.abort();externalSignal.addEventListener('abort',abort,{once:true});
    let timedOut=false;const deadline=setTimeout(()=>{timedOut=true;controller.abort();},30000);let failures=0;
    this.loading=true;
    try {
      for(let round=0;round<30;round++) {
        assertRunning(signal);const tab=await this.tab();
        if(tab.status==='complete') {
          try {
            await ask(this.tabId,buildRequest('XHS_GUARD',{}),signal);
            if(target==='search') {
              const state=await this.search(signal);
              if(sameSearch(tab.url!,this.navigation.sourceUrl)&&sameSearch(state.sourceUrl,this.navigation.sourceUrl)&&state.isSearch&&!state.hasNote)return;
              if(!noteUrl(tab.url!)||noteKeyFromUrl(tab.url!)!==this.navigation.expectedNoteKey)throw new AppError('PAGE_CHANGED','返回后不是原搜索结果，已暂停，不会猜测其他入口');
            }else if(noteUrl(tab.url!)&&noteKeyFromUrl(tab.url!)===this.navigation.expectedNoteKey) {
              const status=await getNoteStatus(this.tabId,signal);assertRunning(signal);
              if(status.blocked)throw new AppError('PAGE_BLOCKED','平台限制：请人工处理登录或验证');
              if(status.supported&&status.noteKey===this.navigation.expectedNoteKey)return;
              failures++;
            }else if(!sameSearch(tab.url!,this.navigation.sourceUrl))throw new AppError('PAGE_CHANGED','点击后进入异常地址，任务已暂停');
          }catch(e){if(!(e instanceof AppError)||e.code!=='PAGE_UNSUPPORTED')throw e;failures++;}
          if(failures>=3)throw new AppError('PARSE_FAILED','连续3次无法读取页面结构，已暂停，不会刷新或重新点击');
        }
        await wait(1000,signal);
      }
      throw new AppError('PAGE_UNREACHABLE','正常页面交互30秒内未完成，任务已暂停');
    }catch(e){if(timedOut&&!externalSignal.aborted)throw new AppError('PAGE_UNREACHABLE','正常页面交互30秒内未完成，任务已暂停');throw e;}
    finally{clearTimeout(deadline);externalSignal.removeEventListener('abort',abort);this.loading=false;}
  }
  async ready(url:string,signal:AbortSignal) {
    if(noteKeyFromUrl(url)!==this.navigation.expectedNoteKey)throw new AppError('PAGE_CHANGED','等待目标与任务不一致');
    await this.poll('note',signal);assertRunning(signal);await this.save('note');
  }
  async returnToSearch(signal:AbortSignal) {
    assertRunning(signal);if(this.navigation.phase==='search'){await this.guard();assertRunning(signal);return;}
    await this.guard();assertRunning(signal);this.loading=true;
    try {
      await this.save('returning');assertRunning(signal);await browser.tabs.goBack(this.tabId);assertRunning(signal);
      await this.poll('search',signal);assertRunning(signal);await this.save('search',null);
    }finally{this.loading=false;}
  }
}
