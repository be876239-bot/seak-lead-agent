import { clickSearchNote, closeNote, searchState } from './navigation';
import { platformBlock, readSearchNotes } from './discovery-dom';
import { AppError } from '../domain/errors';
import { LIMITS } from '../domain/limits';
import { commentIdentity, normalizeCommentText, parsePublishedAt } from '../domain/identity';
import type { Comment, Note } from '../domain/schemas';
import { redactText } from '../privacy/redact';
import {
  type Request,
  type XhsStatusPayload,
  type SnapshotPayload,
} from '../messaging/protocol';
import { detectPage, parseLoadedComments, parseCommentSubtree, parseNote, replyExpandControls, type ParsedComment } from './adapter';
import { SEL, PARSER_VERSION } from './selectors';

export type EndReason = 'stopped' | 'page_changed' | 'blocked' | 'heartbeat';

const encoder = new TextEncoder();

function isoNow(now: () => number): string {
  return new Date(now()).toISOString();
}

/** 登录遮挡即使笔记容器仍在 DOM 也必须停止采集。 */
function pageBlocked(doc: Document): boolean {
  return detectPage(doc) === 'blocked' || platformBlock(doc) !== null;
}

/** 解码 cursor（不透明字符串）；任何不匹配都视为失效。 */
function parseCursor(cursor: string): { sessionId: string; version: number; offset: number } | null {
  const m = /^([0-9a-f-]{36})\.(\d+)\.(\d+)$/.exec(cursor);
  if (!m) return null;
  return { sessionId: m[1]!, version: Number(m[2]), offset: Number(m[3]) };
}

class ActiveSession {
  readonly id = crypto.randomUUID();
  noteKey: string;
  note: Note;
  buffer: Comment[] = [];
  keySet = new Set<string>();
  elementKey = new Map<string, string>();
  elementOrdinal = new Map<string, number>();
  weakElements = new WeakMap<Element, { signature: string; ordinal: number }>();
  sourceKeys = new WeakMap<Element,string>();
  weakOwners = new Map<string,Element>();
  activityVersion = 0;
  activityText = '';
  replyLoad: {parentKey:string;before:number;startedAt:number;lastCount:number;changedAt:number} | null = null;
  replyActions = 0;
  replyRequests = new Set<string>();
  version = 0;
  limitReached = false;
  lastActivityAt: number;

  constructor(noteKey: string, note: Note, startedAt: number) {
    this.noteKey = noteKey;
    this.note = note;
    this.lastActivityAt = startedAt;
  }
}

export class XhsSessionManager {
  private session: ActiveSession | null = null;
  private lastEnd: EndReason | null = null;
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ordinal = 0;
  private knownLists = new WeakSet<Element>();
  private knownAreas = new WeakSet<Element>();

  constructor(
    private getDoc: () => Document,
    private now: () => number = () => Date.now(),
  ) {}

  async handle(req: Request): Promise<unknown> {
    switch (req.type) {
      case 'XHS_GET_STATUS': return this.status();
      case 'XHS_DISCOVER': return { urls: readSearchNotes(this.getDoc(), this.getDoc().URL), sourceUrl:this.getDoc().URL };
      case 'XHS_SEARCH_STATE': return searchState(this.getDoc());
      case 'XHS_CLOSE_NOTE': return closeNote(this.getDoc(),req.payload.expectedNoteKey);
      case 'XHS_CLICK_NOTE': return clickSearchNote(this.getDoc(),req.payload.expectedSearchUrl,req.payload.expectedNoteKey);
      case 'XHS_GUARD': { const reason=platformBlock(this.getDoc()); if(reason) throw new AppError('PAGE_BLOCKED',reason); return {ok:true}; }
      case 'XHS_START_SESSION': return this.start(req.payload.expectedNoteKey);
      case 'XHS_GET_SNAPSHOT': return this.snapshot(req.payload.sessionId, req.payload.expectedNoteKey, req.payload.cursor, req.payload.advance);
      case 'XHS_STOP_SESSION': return this.stop(req.payload.sessionId);
      default: throw new AppError('UNKNOWN', '不支持的消息类型');
    }
  }

  private status(): XhsStatusPayload {
    const doc = this.getDoc();
    const kind = detectPage(doc);
    if (kind === 'blocked' || platformBlock(doc)) {
      return { noteKey: null, parserVersion: PARSER_VERSION, supported: false, blocked: true };
    }
    let noteKey: string | null = null;
    try {
      noteKey = parseNote(doc).noteKey;
    } catch {
      noteKey = null;
    }
    return { noteKey, parserVersion: PARSER_VERSION, supported: kind === 'note', blocked: false };
  }

  private start(expectedNoteKey: string): SnapshotPayload {
    const doc = this.getDoc();
    if (pageBlocked(doc)) throw new AppError('PAGE_BLOCKED', '页面被登录或风控遮挡，已停止采集');
    const parsed = parseNote(doc);
    if (parsed.noteKey !== expectedNoteKey) {
      throw new AppError('PAGE_CHANGED', '当前笔记与请求笔记不一致，请重新获取状态');
    }
    if (this.session) this.endSession('stopped');
    const note: Note = {
      noteKey: parsed.noteKey,
      sourceUrl: parsed.sourceUrl.slice(0, LIMITS.maxUrlChars),
      title: redactText(parsed.title).slice(0, LIMITS.maxNoteChars),
      bodyExcerpt: redactText(parsed.bodyExcerpt),
      capturedAt: isoNow(this.now),
      parserVersion: parsed.parserVersion,
    };
    this.session = new ActiveSession(parsed.noteKey, note, this.now());
    this.ordinal=0;
    this.knownLists=new WeakSet();
    this.knownAreas=new WeakSet();
    const list=doc.querySelector(SEL.listContainer);if(list)this.knownLists.add(list);
    const area=doc.querySelector(SEL.commentsArea);if(area)this.knownAreas.add(area);
    this.lastEnd = null;
    this.ingest();
    this.attachObserver();
    this.ensureHeartbeatTimer();
    return this.buildChunk(0);
  }

  private assertLive(sessionId: string, expectedNoteKey: string): ActiveSession {
    if (this.session && pageBlocked(this.getDoc())) {
      this.endSession('blocked');
    }
    if (!this.session) {
      const reason = this.lastEnd;
      if (reason === 'page_changed') throw new AppError('PAGE_CHANGED', '笔记已切换，旧会话已失效');
      if (reason === 'blocked') throw new AppError('PAGE_BLOCKED', '页面被遮挡，会话已停止');
      throw new AppError('SNAPSHOT_EXPIRED', '采集会话不存在或已结束，请重新开始');
    }
    const session = this.session;
    if (session.id !== sessionId) throw new AppError('SNAPSHOT_EXPIRED', '会话 ID 不匹配');
    if (session.noteKey !== expectedNoteKey) throw new AppError('PAGE_CHANGED', '笔记已切换，本会话不再返回数据');
    if (parseNote(this.getDoc()).noteKey !== session.noteKey) {
      this.endSession('page_changed');
      throw new AppError('PAGE_CHANGED', '当前笔记已切换，停止采集');
    }
    session.lastActivityAt = this.now();
    return session;
  }

  private snapshot(sessionId: string, expectedNoteKey: string, cursor: string | null, advance = false): SnapshotPayload {
    const session = this.assertLive(sessionId, expectedNoteKey);
    if (!cursor) this.ingest(true);
    this.settleReplyLoad();
    if (advance && !session.limitReached) {
      if (cursor) throw new AppError('SNAPSHOT_EXPIRED', '分页期间不能滚动加载');
      if(!this.advanceReplies()) this.scrollComments();
      this.assertLive(sessionId, expectedNoteKey);
      this.ingest(true);
      this.settleReplyLoad();
    }
    let offset = 0;
    if (cursor) {
      const parsed = parseCursor(cursor);
      if (!parsed || parsed.sessionId !== session.id) {
        throw new AppError('SNAPSHOT_EXPIRED', 'cursor 与当前会话不匹配');
      }
      if (parsed.version !== session.version) {
        throw new AppError('SNAPSHOT_EXPIRED', '缓冲在分页期间发生变化，请从头重新获取');
      }
      if (parsed.offset < 0 || parsed.offset > session.buffer.length) {
        throw new AppError('SNAPSHOT_EXPIRED', 'cursor 越界，请重新获取');
      }
      offset = parsed.offset;
    }
    return this.buildChunk(offset);
  }

  private settleReplyLoad(): void {
    const session=this.session!;const pending=session.replyLoad;if(!pending)return;
    const count=session.buffer.filter(c=>c.parentKey===pending.parentKey).length;
    if(count!==pending.lastCount){pending.lastCount=count;pending.changedAt=this.now();}
    if(count>pending.before && this.now()-pending.changedAt>=LIMITS.replyQuietMs){session.replyLoad=null;return;}
    if(count===pending.before && this.now()-pending.startedAt>=LIMITS.replyLoadTimeoutMs)throw new AppError('PARSE_FAILED','回复展开后10秒未发现新增回复；已暂停，请人工检查，已保存结果保留');
  }

  /** 一次只加载一组回复，等待增量数据后才能再次展开或滚动；任何动作前再次校验会话与平台状态。 */
  private advanceReplies(): boolean {
    const session=this.session!;
    if(session.replyLoad)return true;
    for(const {control,parent} of replyExpandControls(this.getDoc())) {
      const parentKey=session.sourceKeys.get(parent) ?? (parent.id?session.elementKey.get(parent.id):undefined);
      if(!parentKey)throw new AppError('PARSE_FAILED','无法确认回复控件的父评论关系，已暂停');
      const before=session.buffer.filter(c=>c.parentKey===parentKey).length;
      const requestKey=`${parentKey}\u0001${before}\u0001${(control.textContent??'').replace(/\s+/g,' ').trim()}`;
      if(session.replyRequests.has(requestKey))throw new AppError('PARSE_FAILED','回复控件未产生新内容，已暂停，禁止重复点击');
      if(session.replyActions>=LIMITS.maxReplyActions)throw new AppError('PARSE_FAILED','达到本帖100次回复展开上限；已暂停，已保存内容保留');
      this.assertLive(session.id,session.noteKey);
      if(session.limitReached)return true;
      session.replyRequests.add(requestKey);session.replyActions++;
      session.replyLoad={parentKey,before,startedAt:this.now(),lastCount:before,changedAt:this.now()};
      control.click();
      return true;
    }
    return false;
  }

  /** 状态判断与实际滚动必须选择同一祖先；不足一屏的内层不能冒充外层已到底。 */
  private scrollContainer():HTMLElement|null {
    const doc = this.getDoc();
    const root = doc.querySelector(SEL.noteRoot);
    let el = doc.querySelector<HTMLElement>(SEL.listContainer);
    let shortList: HTMLElement | null = null;
    while (el && root?.contains(el)) {
      const style = doc.defaultView?.getComputedStyle(el);
      if (/(auto|scroll)/.test(style?.overflowY || style?.overflow || '') && el.clientHeight > 0) {
        shortList ??= el;
        if (el.scrollHeight > el.clientHeight) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return shortList;
  }
  /** 只滚动已确认评论列表在当前笔记内的可滚动祖先，不访问接口。 */
  private scrollComments(): void {
    const el=this.scrollContainer();
    if(!el)throw new AppError('PARSE_FAILED', '无法确认当前笔记的评论滚动容器；已停止，已保存评论保留');
    el.scrollBy({top:Math.max(1,Math.min(400,el.clientHeight*0.5)),behavior:'instant'});
  }

  private stop(sessionId: string): { stopped: boolean } {
    if (this.session && this.session.id === sessionId) this.endSession('stopped');
    return { stopped: true };
  }

  /** 从 offset 起按 UTF-8 大小分块，整条消息不超过 maxMessageBytes。 */
  private buildChunk(offset: number): SnapshotPayload {
    const session = this.session!;
    const budget = LIMITS.maxMessageBytes - 65_536;
    const chunk: Comment[] = [];
    let bytes = 0;
    for (let i = offset; i < session.buffer.length; i++) {
      const c = session.buffer[i]!;
      const size = encoder.encode(JSON.stringify(c)).length;
      if (chunk.length > 0 && bytes + size > budget) break;
      chunk.push(c);
      bytes += size;
    }
    const hasMore = offset + chunk.length < session.buffer.length;
    const area=this.getDoc().querySelector(SEL.commentsArea);
    const scroll=this.scrollContainer();
    return {
      sessionId: session.id,
      noteKey: session.noteKey,
      parserVersion: PARSER_VERSION,
      capturedAt: isoNow(this.now),
      note: session.note,
      comments: chunk,
      loadingReplies: session.replyLoad !== null,
      hasMoreLoaded: hasMore,
      truncated: session.limitReached,
      nextCursor: hasMore ? `${session.id}.${session.version}.${offset + chunk.length}` : null,
      // 只使用现有真实 fixture 证实的空评论标志；不能用“未新增”冒充平台末尾。
      endOfList: session.buffer.length === 0 && !!this.getDoc().querySelector(`${SEL.commentsArea} ${SEL.noComments}`),
      activityVersion:session.activityVersion,
      atBottom:scroll?scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-2:undefined,
      // 仅页面DOM的标准加载语义，不检查网络请求、账号状态或私有接口。
      loadingComments:!!area&&(area.getAttribute('aria-busy')==='true'||!!area.querySelector('[aria-busy="true"],[role="progressbar"]')),
    };
  }

  /** 增量读取：先打码再暂存；500 条上限后停止增加。 */
  private ingest(strict = false, extracted?:ParsedComment[]): void {
    const session = this.session;
    if (!session) return;
    let parsedList: ParsedComment[];
    try {
      parsedList = extracted ?? parseLoadedComments(this.getDoc(), session.noteKey);
    } catch (err) {
      if (strict) throw err;
      return;
    }
    const capturedAt = isoNow(this.now);
    for (const p of parsedList) {
      if (session.buffer.length >= LIMITS.maxSessionComments) {
        session.limitReached = true;
        break;
      }
      const text = redactText(p.text);
      if (!normalizeCommentText(text)) continue; // 空骨架可在后续填充时重试，不分配已保存身份。
      const parentKey = p.isSub
        ? (p.parentElementId ? session.elementKey.get(p.parentElementId) : undefined) ?? (p.parentElement ? session.sourceKeys.get(p.parentElement) : undefined) ?? (p.parentContainer ? session.sourceKeys.get(p.parentContainer) : undefined) ?? null
        : null;
      if(p.isSub && !parentKey){if(strict)throw new AppError('PARSE_FAILED','无法确认回复的父评论关系，已暂停；不会把回复当一级评论');continue;}
      if (p.elementId && !session.elementOrdinal.has(p.elementId)) {
        session.elementOrdinal.set(p.elementId, this.ordinal++);
      }
      const signature = `${text}\u0001${p.authorLocalKey ?? ''}\u0001${p.publishedText ?? ''}\u0001${parentKey ?? ''}`;
      let weak = session.weakElements.get(p.sourceElement);
      if (!weak || weak.signature !== signature) {
        weak = { signature, ordinal: this.ordinal++ };
        session.weakElements.set(p.sourceElement, weak);
      }
      const ordinal = p.elementId ? session.elementOrdinal.get(p.elementId)! : weak.ordinal;
      const identity = commentIdentity({
        noteKey: session.noteKey,
        platformCommentId: p.platformCommentId,
        authorLocalKey: p.authorLocalKey,
        text,
        publishedText: p.publishedText,
        parentKey,
        ordinal,
      });
      // 无平台ID不能因作者/短文本/相对时间相同就合并不同节点。
      // 同一节点仍沿用ordinal；节点身份完全丢失时宁保留weak记录，不冒充强去重。
      if(!p.platformCommentId) {
        const owner=session.weakOwners.get(identity.commentKey);
        if(owner&&owner!==p.sourceElement)identity.commentKey+=`:occ:${ordinal}`;
        else session.weakOwners.set(identity.commentKey,p.sourceElement);
      }
      session.sourceKeys.set(p.sourceElement,identity.commentKey);
      if(!p.isSub){const wrapper=p.sourceElement.closest(SEL.parentWrapper);if(wrapper)session.sourceKeys.set(wrapper,identity.commentKey);}
      if (p.elementId) session.elementKey.set(p.elementId, identity.commentKey);
      if (session.keySet.has(identity.commentKey)) continue;
      session.keySet.add(identity.commentKey);
      session.buffer.push({
        commentKey: identity.commentKey,
        noteKey: session.noteKey,
        platformCommentId: p.platformCommentId,
        parentKey,
        text,
        authorDisplayName: p.authorDisplayName ? normalizeCommentText(p.authorDisplayName).slice(0, 120) || null : null,
        authorLocalKey: p.authorLocalKey,
        profileUrl: p.profileUrl,
        locationText: p.locationText ? redactText(p.locationText).slice(0, 60) : null,
        publishedText: p.publishedText,
        publishedAt: parsePublishedAt(p.publishedText),
        likeCount: p.likeCount,
        capturedAt,
        identityQuality: identity.identityQuality,
        truncated: p.truncated,
      });
      session.version += 1;
    }
    if (session.buffer.length >= LIMITS.maxSessionComments) session.limitReached = true;
  }

  private attachObserver(): void {
    this.observer?.disconnect();
    const doc = this.getDoc();
    // 微任务即提取，避免500ms防抖期间可见项已被虚拟列表移除。
    this.observer = new MutationObserver(records => this.checkDom(records));
    this.observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true,attributes:true,attributeFilter:['id','class','aria-busy'] });
  }

  private scheduleCheck(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.checkDom();
    }, LIMITS.observerDebounceMs);
  }

  private checkDom(records:MutationRecord[]=[]): void {
    if (!this.session) return;
    const doc = this.getDoc();
    if (pageBlocked(doc)) {
      this.endSession('blocked');
      return;
    }
    let currentNoteKey: string | null = null;
    try {
      currentNoteKey = parseNote(doc).noteKey;
    } catch {
      currentNoteKey = null;
    }
    if (currentNoteKey && currentNoteKey !== this.session.noteKey) {
      this.endSession('page_changed');
      return;
    }
    if (!doc.querySelector(SEL.commentsArea)) return;
    if(currentNoteKey!==this.session.noteKey)return;
    const list=doc.querySelector(SEL.listContainer);if(list)this.knownLists.add(list);
    const area=doc.querySelector(SEL.commentsArea);if(area)this.knownAreas.add(area);
    // 先处理来自已确认列表的变更记录。只重扫live DOM会丢失同一任务中插入又移除的节点。
    const scopes:Element[]=[];
    for(const record of records) {
      let inList=false,inArea=false;
      let ancestor:Node|null=record.target;
      while(ancestor){if(ancestor.nodeType===1){inList ||=this.knownLists.has(ancestor as Element);inArea ||=this.knownAreas.has(ancestor as Element);}ancestor=ancestor.parentNode;}
      for(const node of [...record.addedNodes,...record.removedNodes]) {
        if(node.nodeType!==1)continue;
        const el=node as Element;
        if(inList)scopes.push(el);
        else if(inArea) {
          // 整个列表替换：只找已知列表结构，不能把评论区内列表外的推荐当评论。
          const lists=[...(el.matches('.list-container')?[el]:[]),...el.querySelectorAll('.list-container')];
          for(const candidate of lists){this.knownLists.add(candidate);scopes.push(candidate);}
        }
      }
    }
    // 相同内容的重复重渲染不是持续加载；避免虚拟列表无变化重绘阻止有界收尾。
    const activityText=list?.textContent??'';
    if(records.some(r=>list?.contains(r.target)||area===r.target)&&activityText!==this.session.activityText){this.session.activityVersion++;this.session.activityText=activityText;}
    for(const scope of scopes){if(this.session.limitReached)break;this.ingest(false,parseCommentSubtree(scope,this.session.noteKey));}
    this.ingest();
  }

  private ensureHeartbeatTimer(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.session && this.now() - this.session.lastActivityAt > LIMITS.sessionHeartbeatTimeoutMs) {
        this.endSession('heartbeat');
      }
    }, LIMITS.sessionHeartbeatIntervalMs);
  }

  private endSession(reason: EndReason): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.session = null;
    this.lastEnd = reason;
  }

  /** 供页面卸载或测试收尾。 */
  dispose(): void {
    this.endSession('stopped');
  }
}
