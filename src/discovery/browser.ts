import {LIMITS} from '../domain/limits';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { AppError } from '../domain/errors';
import type { DiscoveryNavigation } from '../domain/schemas';
import { buildRequest } from '../messaging/protocol';
import { ask, getNoteStatus } from '../xhs/capture';
import { noteKeyFromUrl, noteUrl } from '../xhs/discovery-dom';
import { MISSING_SEARCH_CARD_MESSAGE, sameSearch } from '../xhs/navigation';

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
const SearchScrollResult=z.object({scrollable:z.boolean(),moved:z.boolean(),atTop:z.boolean(),atBottom:z.boolean(),scrollTop:z.number(),maxTop:z.number()});
/** 复用原搜索标签，只点击当前真实入口和正常后退；不创建标签、不直接写目标URL。 */
export class DiscoveryBrowser {
  readonly tabId:number;
  private loading=false;
  navigation:DiscoveryNavigation;
  observation:{actualUrl:string|null;resolvedPostKey:string|null;hasNote?:boolean;isSearch?:boolean;matchesSearch?:boolean}={actualUrl:null,resolvedPostKey:null};
  constructor(sourceId:number,navigation:DiscoveryNavigation,private changed:(state:DiscoveryNavigation)=>Promise<void>=async()=>{}) {
    this.tabId=sourceId;this.navigation={...navigation};
  }
  private async save(phase:DiscoveryNavigation['phase'],expectedNoteKey=this.navigation.expectedNoteKey) {
    this.navigation={...this.navigation,phase,expectedNoteKey};await this.changed({...this.navigation});
  }
  private async tab() {
    const tab=await browser.tabs.get(this.tabId);
    if(tab.url){const parsed=new URL(tab.url);this.observation={actualUrl:parsed.origin+parsed.pathname,resolvedPostKey:noteUrl(tab.url)?noteKeyFromUrl(tab.url):null,matchesSearch:sameSearch(tab.url,this.navigation.sourceUrl)};}
    if(!tab.url?.startsWith('https://www.xiaohongshu.com/'))throw new AppError('PAGE_CHANGED','页面离开小红书或无法读取地址，任务已暂停');
    return tab;
  }
  private async search(signal?:AbortSignal) {const state=SearchState.parse(await ask(this.tabId,buildRequest('XHS_SEARCH_STATE',{}),signal));this.observation={...this.observation,hasNote:state.hasNote,isSearch:state.isSearch};return state;}
  async guard() {
    const navigation=this.navigation;
    if(this.loading){
      await this.tab();
      try{await ask(this.tabId,buildRequest('XHS_GUARD',{}));}
      catch(e){if(!(e instanceof AppError)||e.code!=='PAGE_UNSUPPORTED')throw e;}
      return; // 文档正常卸载期间允许脚本暂不可用；30秒的转换等待仍在生效。
    }
    const tab=await this.tab();await ask(this.tabId,buildRequest('XHS_GUARD',{}));
    if(navigation!==this.navigation)return; // The transition has its own identity check.
    if(this.navigation.phase==='search') {
      const state=await this.search();
      if(navigation!==this.navigation)return;
      if(!sameSearch(tab.url!,this.navigation.sourceUrl)||!sameSearch(state.sourceUrl,this.navigation.sourceUrl)||state.hasNote||!state.isSearch)throw new AppError('PAGE_CHANGED','当前页面不是原搜索结果，任务已暂停');
    }else {
      if(!noteUrl(tab.url!)||noteKeyFromUrl(tab.url!)!==this.navigation.expectedNoteKey)throw new AppError('PAGE_CHANGED','当前页面与任务笔记不一致');
      const status=await getNoteStatus(this.tabId);
      if(navigation!==this.navigation)return;
      if(!status.supported||status.blocked||status.noteKey!==this.navigation.expectedNoteKey)throw new AppError('PARSE_FAILED','笔记结构异常或需要人工处理，任务已暂停');
    }
  }
  /** 仅用户明确继续时同步实际页面；运行中擅自换页仍由guard暂停。 */
  async reconcile(allowedNoteKey?:string) {
    const tab=await this.tab();await ask(this.tabId,buildRequest('XHS_GUARD',{}));
    if(sameSearch(tab.url!,this.navigation.sourceUrl)) {
      // A SPA may update its URL before unmounting the old note. Reconcile the
      // pending return in place; another Back would leave the original search.
      await this.poll('search',new AbortController().signal);
      await this.save('search',null);return;
    }
    const expected=this.navigation.expectedNoteKey??allowedNoteKey;
    if(expected&&noteUrl(tab.url!)&&noteKeyFromUrl(tab.url!)===expected) {
      const status=await getNoteStatus(this.tabId);if(status.supported&&!status.blocked&&status.noteKey===expected){await this.save('note',expected);return;}
    }
    throw new AppError('PAGE_CHANGED','无法与原搜索结果或待处理笔记对应，请人工检查后继续；队列保留');
  }
  private missingSearchCard(error:unknown):error is AppError {
    return error instanceof AppError&&error.code==='PAGE_CHANGED'&&error.message===MISSING_SEARCH_CARD_MESSAGE;
  }
  private async clickSearchTarget(expectedNoteKey:string,signal:AbortSignal) {
    const click=async()=>z.object({clicked:z.literal(true),noteKey:z.string()}).parse(
      await ask(this.tabId,buildRequest('XHS_CLICK_NOTE',{expectedSearchUrl:this.navigation.sourceUrl,expectedNoteKey}),signal),
    );
    const scroll=async(direction:'down'|'top')=>SearchScrollResult.parse(
      await ask(this.tabId,buildRequest('XHS_SCROLL_SEARCH',{expectedSearchUrl:this.navigation.sourceUrl,direction}),signal),
    );
    try { return await click(); }
    catch(initialError) {
      if(!this.missingSearchCard(initialError))throw initialError;
      // Two bounded passes: continue from the current position, then rescan from the top.
      // Each scroll is a separate cancellable message; a late click cannot occur after Pause.
      for(let pass=0;pass<2;pass++) {
        assertRunning(signal);
        if(pass===1) {
          const top=await scroll('top');assertRunning(signal);
          if(!top.scrollable)break;
          await wait(LIMITS.searchScrollWaitMs,signal);
          try { return await click(); }
          catch(error) { if(!this.missingSearchCard(error))throw error; }
        }
        for(let step=0;step<40;step++) {
          assertRunning(signal);
          const result=await scroll('down');assertRunning(signal);
          if(!result.scrollable||!result.moved)break;
          await wait(LIMITS.searchScrollWaitMs,signal);assertRunning(signal);
          try { return await click(); }
          catch(error) { if(!this.missingSearchCard(error))throw error; }
        }
      }
      throw new AppError('PAGE_CHANGED','已自动滚动并重新检查搜索结果，仍找不到队列中的这篇笔记。可能搜索结果已变化或小红书未重新加载它。请确认原搜索结果页后继续；任务进度与已保存线索保留。');
    }
  }
  async navigate(url:string,signal:AbortSignal) {
    assertRunning(signal);const expected=noteKeyFromUrl(url);
    if(this.navigation.phase==='note'&&this.navigation.expectedNoteKey===expected){await this.guard();assertRunning(signal);return;}
    if(this.navigation.phase!=='search')await this.returnToSearch(signal);
    await this.guard();assertRunning(signal);this.loading=true;
    try {
      await this.save('opening',expected);assertRunning(signal);
      try {
        await this.clickSearchTarget(expected,signal);
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
              if(!sameSearch(tab.url!,this.navigation.sourceUrl) && (!noteUrl(tab.url!)||noteKeyFromUrl(tab.url!)!==this.navigation.expectedNoteKey))throw new AppError('PAGE_CHANGED','返回后不是原搜索结果，已暂停，不会猜测其他入口');
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
      await this.save('returning');assertRunning(signal);
      try {await browser.tabs.goBack(this.tabId);}
      catch(e) {
        // Some SPA note entries have no browser-history predecessor. Use one
        // normal, fixture-confirmed dismiss action, never a forced URL or retry.
        if(!(e instanceof Error)||!/^Cannot find a next page in history\.?$/.test(e.message))throw e;
        assertRunning(signal);const tab=await this.tab();assertRunning(signal);
        if(!sameSearch(tab.url!,this.navigation.sourceUrl)) {
          const key=this.navigation.expectedNoteKey;
          if(!key||!noteUrl(tab.url!)||noteKeyFromUrl(tab.url!)!==key)throw new AppError('PAGE_CHANGED','关闭前页面与原任务笔记不一致');
          const result=z.object({clicked:z.literal(true),noteKey:z.string()}).parse(await ask(this.tabId,buildRequest('XHS_CLOSE_NOTE',{expectedNoteKey:key}),signal));
          if(result.noteKey!==key)throw new AppError('PAGE_CHANGED','关闭响应的笔记身份不一致');
        }
      }
      assertRunning(signal);
      await this.poll('search',signal);assertRunning(signal);await this.save('search',null);
    }finally{this.loading=false;}
  }
}
