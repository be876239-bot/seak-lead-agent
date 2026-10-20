import CollectionProgressView from '../../src/ui/CollectionProgress';
import DiscoveryPostResults from './DiscoveryPostResults';
import ErrorNotice from '../../src/ui/ErrorNotice';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Job, Product } from '../../src/domain/schemas';
import { LIMITS } from '../../src/domain/limits';
import { sendRequest } from '../../src/messaging/client';
import { requestOriginForUrl } from '../../src/messaging/handlers';
import { toErrorPayload } from '../../src/domain/errors';
import { getSelectedProductId, ui } from '../../src/ui/store';
import { copyTextToClipboard } from '../../src/ui/clipboard';
import { isValidMaxPostsInput } from '../../src/ui/discovery-input';
import { isBackgroundInterruptedDiscovery, isDiscoveryTaskBlockingStart } from '../../src/discovery/task-state';
import { noteKeyFromUrl } from '../../src/xhs/discovery-dom';
import { isProductConfirmed } from '../../src/product/research';

const LAST='discovery.lastJobId';
const REPROCESS_LAST='discovery.reprocessJobId';
type DiscoveryProps = { onSearchConfirmed?: () => void; onTaskStarted?: () => void };

function DiscoveryPostSummary({ noteKey }: { noteKey: string }) {
  const [summary, setSummary] = useState<{ title: string | null; bodyExcerpt: string | null; commentCount: number } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([ui.getNote(noteKey), ui.commentsForNote(noteKey)]).then(([note, comments]) => {
      if (active) setSummary({ title: note?.title ?? null, bodyExcerpt: note?.bodyExcerpt ?? null, commentCount: comments.length });
    }).catch(() => {});
    return () => { active = false; };
  }, [noteKey]);
  return <div className="sl-discovery-results__summary-text">
    <b>{summary?.title || summary?.bodyExcerpt || noteKey}</b>
    {summary?.title && summary.bodyExcerpt && <span>{summary.bodyExcerpt}</span>}
    {summary && <span className="sl-page-footnote">本地已保存 {summary.commentCount} 条评论</span>}
  </div>;
}

export default function Discovery({ onSearchConfirmed, onTaskStarted }: DiscoveryProps) {
  const [products,setProducts]=useState<Product[]>([]);
  const confirmedProducts = products.filter(isProductConfirmed);
  const [productId,setProductId]=useState('');
  const [direction,setDirection]=useState('');
  const [maxPostsInput,setMaxPostsInput]=useState('20');
  const maxPostsValid=isValidMaxPostsInput(maxPostsInput);
  const [job,setJob]=useState<Job|null>(null);
  const [error,setError]=useState('');const [sending,setSending]=useState(false);
  const [searchConfirmed,setSearchConfirmed]=useState(false);
  const [copyFeedback,setCopyFeedback]=useState('');
  const [expandedPostKey,setExpandedPostKey]=useState<string|null>(null);
  const [reprocessJob,setReprocessJob]=useState<Job|null>(null);
  const [postResultsRefreshKey,setPostResultsRefreshKey]=useState(0);
  const product=products.find(p=>p.id===productId);
  const resultProduct=products.find(p=>p.id===job?.productId)??null;
  const state=job?.discovery;
  const backgroundInterrupted=isBackgroundInterruptedDiscovery(job);
  // Only a running task blocks a new task; a paused checkpoint remains saved and resumable.
  const blockingStart=isDiscoveryTaskBlockingStart(job);
  const reprocessActive=!!reprocessJob && !['completed','stopped'].includes(reprocessJob.discovery?.status??'');
  useEffect(()=>{void (async()=>{
    const list=await ui.listProducts();setProducts(list);const selected=await getSelectedProductId();
    const usable = list.filter(isProductConfirmed);
    setProductId(usable.find(p=>p.id===selected)?.id??usable[0]?.id??'');
    const saved=await browser.storage.local.get([LAST,REPROCESS_LAST]);
    if(typeof saved[LAST]==='string') {
      const res=await sendRequest<{job:Job|null}>('JOB_GET',{jobId:saved[LAST]});setJob(res.job);
    }
    if(typeof saved[REPROCESS_LAST]==='string') {
      const res=await sendRequest<{job:Job|null}>('JOB_GET',{jobId:saved[REPROCESS_LAST]});setReprocessJob(res.job);
    }
  })().catch(e=>setError(toErrorPayload(e).message));},[]);
  useEffect(()=>{setDirection(product?.profile.searchSuggestions[0]??'');setSearchConfirmed(false);setCopyFeedback('');},[product]);
  useEffect(()=>{
    if(!job || ['completed','stopped'].includes(job.discovery?.status??''))return;const id=job.id;
    const timer=window.setInterval(()=>{void sendRequest<{job:Job|null}>('JOB_GET',{jobId:id}).then(res=>setJob(res.job)).catch(e=>setError(toErrorPayload(e).message));},1000);
    return ()=>window.clearInterval(timer);
  },[job?.id,job?.discovery?.status]);
  useEffect(()=>{
    if(!reprocessJob || ['completed','stopped'].includes(reprocessJob.discovery?.status??''))return;const id=reprocessJob.id;
    const timer=window.setInterval(()=>{void sendRequest<{job:Job|null}>('JOB_GET',{jobId:id}).then(res=>setReprocessJob(res.job)).catch(e=>setError(toErrorPayload(e).message));},1000);
    return ()=>window.clearInterval(timer);
  },[reprocessJob?.id,reprocessJob?.discovery?.status]);
  useEffect(()=>{
    if(reprocessJob && ['completed','stopped'].includes(reprocessJob.discovery?.status??''))setPostResultsRefreshKey(key=>key+1);
  },[reprocessJob?.discovery?.status]);
  const copyCurrentDirection=async()=>{
    setCopyFeedback('');
    setSearchConfirmed(false);
    if(!direction)return;
    try {await copyTextToClipboard(direction);setCopyFeedback(`已复制“${direction}”。请切回小红书搜索框粘贴并点击搜索。`);}
    catch(e){setCopyFeedback(e instanceof Error?e.message:'复制失败，请手动选择关键词复制');}
  };
  const start=async()=>{
    setError('');
    if(reprocessActive){setError('本帖重新采集任务仍在运行，请先完成、暂停或停止它。');return;}
    if(!product || !isProductConfirmed(product)){setError('请先在产品页完成产品画像并确认，再开始寻找客户。');return;}
    if(!isValidMaxPostsInput(maxPostsInput)){setError('帖子数量上限必须是 1–100 之间的整数。');return;}
    if(!searchConfirmed){setError('请先在小红书搜索框中搜索当前关键词，确认结果页已加载后勾选确认。');return;}
    setSending(true);
    try {
      // 用户点击直接申请小红书具体域权限；不请求Cookie、历史记录或全站权限。
      if(!await requestOriginForUrl('https://www.xiaohongshu.com/'))throw new Error('未授予小红书网页权限');
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});if(tab?.id==null)throw new Error('请先打开小红书搜索结果页');
      const jobId=crypto.randomUUID();
      await sendRequest('DISCOVERY_START',{jobId,productId,tabId:tab.id,direction,maxPosts:Number(maxPostsInput)});
      onTaskStarted?.();
      await browser.storage.local.set({[LAST]:jobId});
      await browser.storage.local.remove(REPROCESS_LAST);
      setReprocessJob(null);
      setExpandedPostKey(null);
      setJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId})).job);
    }catch(e){setError(e instanceof Error?e.message:'任务启动失败');}finally{setSending(false);}
  };
  const control=async(action:'pause'|'stop'|'continue')=>{
    if(!job)return;setSending(true);setError('');
    try {await sendRequest('DISCOVERY_CONTROL',{jobId:job.id,action});setJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId:job.id})).job);}
    catch(e){setError(toErrorPayload(e).message);if(action==='stop')setJob(null);}finally{setSending(false);}
  };
  const controlReprocess=async(action:'pause'|'stop'|'continue')=>{
    if(!reprocessJob)return;setSending(true);setError('');
    try {await sendRequest('DISCOVERY_CONTROL',{jobId:reprocessJob.id,action});setReprocessJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId:reprocessJob.id})).job);}
    catch(e){setError(toErrorPayload(e).message);}finally{setSending(false);}
  };
  const reprocessPost=async(postUrl:string)=>{
    if(!job?.id||!state)return;
    if(!['completed','stopped'].includes(state.status)){setError('请先完成或停止当前批量任务，再重新处理其中的帖子。原任务进度会保留。');return;}
    if(reprocessActive){setError('另一个本帖重新采集任务仍在运行。');return;}
    setSending(true);setError('');
    try {
      const jobId=crypto.randomUUID();
      await sendRequest('DISCOVERY_REPROCESS_POST',{jobId,parentJobId:job.id,postUrl});
      await browser.storage.local.set({[REPROCESS_LAST]:jobId});
      setReprocessJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId})).job);
      setExpandedPostKey(noteKeyFromUrl(postUrl));
    } catch(e) { setError(toErrorPayload(e).message); }
    finally { setSending(false); }
  };
  const retryFailed=async(jobId:string)=>{
    setSending(true);setError('');
    try {
      const before=(await sendRequest<{job:Job|null}>('JOB_GET',{jobId})).job?.status;
      await sendRequest('JOB_RETRY',{jobId});
      // JOB_RETRY is asynchronous. Wait for a persisted state transition where possible,
      // so the detail panel does not immediately redisplay the old failed state.
      for(let attempt=0;attempt<8;attempt++){
        await new Promise(resolve=>window.setTimeout(resolve,400));
        const res=await sendRequest<{job:Job|null}>('JOB_GET',{jobId});
        if(res.job && res.job.status!==before)break;
      }
      setPostResultsRefreshKey(key=>key+1);
    } catch(e) { setError(toErrorPayload(e).message); }
    finally { setSending(false); }
  };
  const controlPostTask=(action:'pause'|'stop'|'continue')=>{
    if(reprocessActive)void controlReprocess(action);
    else void control(action);
  };
  const detailTaskControl = reprocessActive && reprocessJob?.discovery
    ? {scope:'post' as const,status:reprocessJob.discovery.status as 'running'|'paused'}
    : state && (state.status==='running'||state.status==='paused')
      ? {scope:'batch' as const,status:state.status}
      : null;
  const postEntries=(state?.targets??[]).map((postUrl,index)=>{
    let noteKey:string|null=null;
    try { noteKey=noteKeyFromUrl(postUrl); } catch { /* invalid historical URL is omitted rather than guessed */ }
    if(!noteKey)return null;
    const terminalTrace=[...(state?.trace??[])].reverse().find(row=>row.postIndex===index&&(row.event==='POST_COMPLETE'||row.event==='POST_PARTIAL'));
    const completed=(state?.completedNoteKeys??[]).includes(noteKey)||index<(state?.index??0)||(index===state?.index&&['completed','partial'].includes(state?.post?.stage??''));
    let postStatus:'completed'|'partial'|'running'|'paused'|'pending'='pending';
    if(index===state?.index&&state?.status==='running'&&!completed)postStatus='running';
    else if(index===state?.index&&state?.status==='paused'&&!completed)postStatus='paused';
    else if(completed)postStatus=terminalTrace?.event==='POST_PARTIAL'||(index===state?.index&&state?.post?.stage==='partial')?'partial':'completed';
    return {postUrl,noteKey,index,status:postStatus};
  }).filter((entry):entry is NonNullable<typeof entry>=>entry!==null);
  const postActionBusy=sending||reprocessActive||state?.status==='running'||state?.status==='paused';
  return <div className="sl-page sl-discovery-page">
      <div className="sl-page-heading"><h2>寻找客户</h2><span>批量搜索 · 单页串行</span></div>
    {state && <section className="sl-task-region" aria-live="polite"><div className="sl-card sl-task-card" data-status={state.status}>
      <b>{backgroundInterrupted?'上次任务在后台中断':state.status==='running'?'SeekLead 正在寻找客户':state.status==='paused'?'任务已暂停':job?.status==='partial'?'本次任务部分完成（有帖子未采全）':state.status==='completed'?'本次任务已结束':'任务已停止'}</b>
      <p className="sl-task-product">{products.find(p=>p.id===job?.productId)?.profile.name.value??'—'}</p>
      <h3 className="sl-task-direction">{state.direction}</h3>
      <div className="sl-task-metrics">
        <div className="sl-task-metrics__posts"><strong>{job?.completedItems??state.index}</strong><span> / {state.total} 篇已处理</span></div>
        <div><strong>{state.comments}</strong><span>评论已读取</span></div>
        <div><strong>{state.leads}</strong><span>潜在线索</span></div>
      </div>
      <progress className="sl-task-progress" aria-label="帖子处理进度" value={job?.completedItems??state.index} max={Math.max(1,state.total)} />
      <p className="sl-task-phase">状态：{state.phase}</p>
      {(blockingStart || state.status==='paused') && <div className="sl-actions">
        {state.status==='running'?<button disabled={sending} onClick={()=>void control('pause')}>暂停</button>:<button disabled={sending} onClick={()=>void control('continue')}>继续上次任务（先检查小红书页面）</button>}
        <button className="sl-button--danger" disabled={sending} onClick={()=>void control('stop')}>停止任务</button>
      </div>}
      </div><div className="sl-task-context sl-stack">
      {(state.partialPosts??0)>0 && <p className="sl-notice sl-notice--warning" role="status">部分采集帖子：{state.partialPosts} 篇。已保留评论，但因采集不完整而跳过 AI 分析；这些帖子不计为完整成功。</p>}
      {state.reason && <ErrorNotice message={state.reason} code={job?.errorCode} tone="warning" />}
      <p className="sl-task-help">暂未发现新评论不代表已采集全部评论；平台限制可能影响结果。</p>
      <details className="sl-task-more">
        <summary>当前帖子与任务详情</summary>
        <p>当前帖子：第 {Math.min(state.index+1,state.total)} / {state.total}</p>
        <p className="sl-task-current">本帖已读取 {state.currentComments} 条评论</p>
        {job?.collection && job.collection.discoveredCount===state.currentComments && <div><b>本帖评论采集</b><CollectionProgressView progress={job.collection}/></div>}
        <p className="sl-task-help">线索包含高意向或有需求的评论，在线索页查看。</p>
        {!!state.trace?.length && <details><summary>任务诊断记录（本地，最多200条）</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:260,overflow:'auto'}}>{JSON.stringify(state.trace,null,2)}</pre></details>}
        {state.status==='paused' && state.post?.stage==='completed' && <p>{state.index+1<state.total?'当前帖子已完成，继续将处理下一篇。':'最后一篇已完成，继续将完成任务收尾。'}</p>}
        {state.status==='paused' && state.post?.stage==='captured' && <p>本帖评论已保存，继续将完成分析，不重新采集。</p>}
        {state.status==='paused' && state.post?.stage==='partial' && <p>本帖仅完成部分采集，评论已保留且未进行 AI 分析；继续任务会处理下一篇，不会将本帖伪装成完整采集。</p>}
        {state.status==='paused'&&!backgroundInterrupted&&<p>上次任务已暂停。你可以继续上次任务，也可以直接开始新任务；已保存的评论和线索不会删除。开始新任务前，请先确认小红书页面停在搜索结果页。</p>}
        {backgroundInterrupted&&<p>上次任务因扩展后台重启而停下来了。已经保存的评论和线索还在；你可以直接开始新任务，也可以继续上次任务。开始前请确认小红书页面停在搜索结果页。</p>}
      </details>
    </div></section>}
    <details className="sl-page-intro sl-help-disclosure"><summary>使用说明</summary><p>先选择产品和搜索方向，在已登录的小红书网页中手动搜索。插件只处理当前已加载的搜索结果卡片，不会自动搜索或扩展结果；实际处理数量可能少于所选上限。任务运行时请勿手动切换小红书标签页。</p></details>
    <section className="sl-card sl-discovery-setup" aria-label="新任务设置">
    {confirmedProducts.length === 0 && <p className="sl-notice sl-notice--warning">还没有已确认的产品画像。请先到“产品”页创建或检查画像，并点击“确认画像并用于寻客”。待确认草稿不会用于寻客。</p>}
    <label className="sl-field"><span className="sl-step-label">1 · 选择产品</span>新任务产品：<select value={productId} disabled={confirmedProducts.length === 0} onChange={e=>{setProductId(e.target.value);setSearchConfirmed(false);setCopyFeedback('');}}>{confirmedProducts.map(p=><option key={p.id} value={p.id}>{p.profile.name.value??'未命名产品'}</option>)}</select></label>
    <div data-onboarding-target="search-keyword" className="sl-stack sl-step-card">
      <b className="sl-step-label">2 · 复制并搜索关键词</b>
      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
        <label style={{display:'grid',gap:4,flex:1,minWidth:160}}>本次搜索关键词/分析方向：<select value={direction} onChange={e=>{setDirection(e.target.value);setSearchConfirmed(false);setCopyFeedback('');}}>{product?.profile.searchSuggestions.map(s=><option key={s}>{s}</option>)}</select></label>
        <button type="button" disabled={!direction||sending} onClick={()=>void copyCurrentDirection()}>复制当前关键词</button>
      </div>
      <p style={{margin:0}}>复制后切回已登录的小红书页面，粘贴到顶部搜索框并点击搜索。插件不会自动输入或提交搜索。</p>
      {copyFeedback&&<p role="status" style={{margin:0,color:copyFeedback.startsWith('已复制')?'#067647':'#b42318'}}>{copyFeedback}</p>}
      <label style={{display:'flex',gap:6,alignItems:'flex-start'}}><input type="checkbox" checked={searchConfirmed} disabled={sending||!direction} onChange={e=>{setSearchConfirmed(e.target.checked);if(e.target.checked)onSearchConfirmed?.();}} />我已在小红书搜索框中搜索该关键词，并确认当前页面已显示搜索结果。</label>
    </div>
    <p className="sl-post-limit"><span className="sl-step-label">3 · 设置处理数量</span><label htmlFor="discovery-max-posts">新任务帖子数量上限（1–100 篇）</label><input id="discovery-max-posts" type="number" inputMode="numeric" min={1} max={100} step={1} value={maxPostsInput} disabled={sending} aria-invalid={!maxPostsValid} onChange={e=>setMaxPostsInput(e.target.value)} style={{ width: 88, padding: '4px 6px' }} /></p>
    {!maxPostsValid&&<p role="alert" style={{marginTop:-8,color:'#b42318'}}>请输入 1 到 100 之间的整数。</p>}

    {blockingStart&&<p style={{ border: '1px solid #ead7a0', borderRadius: 6, padding: 8, margin: 0, background: '#fffaf0' }}>上次任务还在运行。开始新任务前会先暂停上次任务并保存进度；已保存的评论和线索不会删除。</p>}
    <button className="sl-button--primary" data-onboarding-target="discovery-start" disabled={sending||!productId||!direction||!searchConfirmed||!maxPostsValid} onClick={()=>void start()}>{blockingStart?'开始新任务（自动暂停上次）':state?.status==='paused'?'开始新任务':'开始寻找客户'}</button>
    </section>
    <details className="sl-rule-note"><summary>采集规则与安全边界</summary><p style={{ margin: '5px 0 0' }}>请确认搜索结果与该方向相关。每篇最多 {LIMITS.maxSessionComments} 条评论，按顺序串行执行，不设全任务总时限。单篇评论采集预算按页面显示评论数动态分配，每100条5分钟，最高100分钟；页面总数不可用时从5分钟起步，仅在持续出现新评论且接近预算边界时延长。单篇整体主动处理保护会在采集预算外额外预留30分钟用于导航与AI分析，最高130分钟。暂停时间不计入；超时会暂停并保留已保存结果，检查页面或模型后手动继续。达到评论安全上限或页面显示数高于采集数时，该帖子会标记为部分采集并跳过 AI 分析，不会伪装成完整结果。遇到登录、安全验证或风控提示会暂停；评论与笔记将发送给已配置的 AI 服务分析，结果保存在本机。</p></details>
    {reprocessJob?.discovery && (
      <div className="sl-card sl-stack" aria-live="polite">
        <b>本帖重新采集任务</b>
        <p>状态：{reprocessJob.discovery.status==='running'?'处理中':reprocessJob.discovery.status==='paused'?'已暂停':reprocessJob.discovery.status==='completed'?(reprocessJob.status==='partial'?'部分完成':'已完成'):'已停止'}</p>
        <p>进度：{reprocessJob.completedItems}/{reprocessJob.discovery.total} 篇 · {reprocessJob.discovery.phase}</p>
        {reprocessJob.discovery.reason && <ErrorNotice message={reprocessJob.discovery.reason} tone="warning" />}
        {reprocessJob.discovery.status==='running' && <button disabled={sending} onClick={()=>void controlReprocess('pause')}>暂停本帖任务</button>}
        {reprocessJob.discovery.status==='paused' && <div className="sl-discovery-post-results__actions">
          <button disabled={sending} onClick={()=>void controlReprocess('continue')}>继续本帖任务</button>
          <button disabled={sending} onClick={()=>void controlReprocess('stop')}>停止本帖任务</button>
        </div>}
        {reprocessJob.discovery.status==='completed' && <p className="sl-page-footnote">已完成。原批量任务的历史检查点未被覆盖，下面的本帖结果会自动刷新。</p>}
      </div>
    )}
    {postEntries.length>0 && resultProduct && (
      <section className="sl-discovery-results" aria-label="批量帖子结果">
        <h3>本次帖子结果（{postEntries.filter(p=>p.status==='completed'||p.status==='partial').length}/{postEntries.length} 已处理）</h3>
        <p className="sl-page-footnote">展开任意帖子，可查看单篇评论、证据、模型判断、人工处理状态、任务日志，并在必要时重新采集或重试失败的 AI 批次。所有操作仍属于同一个批量搜索工作流。</p>
        <div className="sl-discovery-results__list">
          {postEntries.map((post)=>(
            <article key={post.noteKey} className="sl-card sl-discovery-results__item" data-status={post.status}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'grid', gap: 4, minWidth: 0, flex: 1 }}>
                  <b>第 {post.index+1} 篇 · {post.status==='completed'?'已完成':post.status==='partial'?'部分采集':post.status==='running'?'处理中':post.status==='paused'?'已暂停':'待处理'}</b>
                  <DiscoveryPostSummary noteKey={post.noteKey} />
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <a href={post.postUrl} target="_blank" rel="noreferrer">打开笔记</a>
                  <button type="button" onClick={()=>setExpandedPostKey(key=>key===post.noteKey?null:post.noteKey)}>{expandedPostKey===post.noteKey?'收起详情':'查看详情'}</button>
                </div>
              </div>
              {expandedPostKey===post.noteKey && (
                <DiscoveryPostResults
                  product={resultProduct}
                  noteKey={post.noteKey}
                  postUrl={post.postUrl}
                  status={post.status}
                  onRetryFailed={retryFailed}
                  onReprocess={reprocessPost}
                  onTaskControl={controlPostTask}
                  taskControl={detailTaskControl}
                  controlBusy={sending}
                  busy={postActionBusy}
                  refreshKey={postResultsRefreshKey}
                />
              )}
            </article>
          ))}
        </div>
      </section>
    )}
    {error && <ErrorNotice message={error} tone="error" />}
    <p style={{ color: '#888', margin: 0, fontSize: 11 }}>遇验证码、登录或风控会暂停，不自动刷新或绕过。采用只读、单页串行、有限任务、人工可暂停设计；这不能保证平台不会采取账号限制措施。</p>
  </div>;
}
