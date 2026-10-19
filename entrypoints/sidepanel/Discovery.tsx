import CollectionProgressView from '../../src/ui/CollectionProgress';
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

const LAST='discovery.lastJobId';
export default function Discovery() {
  const [products,setProducts]=useState<Product[]>([]);
  const [productId,setProductId]=useState('');
  const [direction,setDirection]=useState('');
  const [maxPostsInput,setMaxPostsInput]=useState('20');
  const maxPostsValid=isValidMaxPostsInput(maxPostsInput);
  const [job,setJob]=useState<Job|null>(null);
  const [error,setError]=useState('');const [sending,setSending]=useState(false);
  const [searchConfirmed,setSearchConfirmed]=useState(false);
  const [copyFeedback,setCopyFeedback]=useState('');
  const product=products.find(p=>p.id===productId);
  const state=job?.discovery;
  const backgroundInterrupted=isBackgroundInterruptedDiscovery(job);
  // Only a running task blocks a new task; a paused checkpoint remains saved and resumable.
  const blockingStart=isDiscoveryTaskBlockingStart(job);
  useEffect(()=>{void (async()=>{
    const list=await ui.listProducts();setProducts(list);const selected=await getSelectedProductId();
    setProductId(list.find(p=>p.id===selected)?.id??list[0]?.id??'');
    const saved=await browser.storage.local.get(LAST);if(typeof saved[LAST]==='string') {
      const res=await sendRequest<{job:Job|null}>('JOB_GET',{jobId:saved[LAST]});setJob(res.job);
    }
  })().catch(e=>setError(toErrorPayload(e).message));},[]);
  useEffect(()=>{setDirection(product?.profile.searchSuggestions[0]??'');setSearchConfirmed(false);setCopyFeedback('');},[product]);
  useEffect(()=>{
    if(!job || ['completed','stopped'].includes(job.discovery?.status??''))return;const id=job.id;
    const timer=window.setInterval(()=>{void sendRequest<{job:Job|null}>('JOB_GET',{jobId:id}).then(res=>setJob(res.job)).catch(e=>setError(toErrorPayload(e).message));},1000);
    return ()=>window.clearInterval(timer);
  },[job?.id,job?.discovery?.status]);
  const copyCurrentDirection=async()=>{
    setCopyFeedback('');
    setSearchConfirmed(false);
    if(!direction)return;
    try {await copyTextToClipboard(direction);setCopyFeedback(`已复制“${direction}”。请切回小红书搜索框粘贴并点击搜索。`);}
    catch(e){setCopyFeedback(e instanceof Error?e.message:'复制失败，请手动选择关键词复制');}
  };
  const start=async()=>{
    setError('');
    if(!isValidMaxPostsInput(maxPostsInput)){setError('帖子数量上限必须是 1–100 之间的整数。');return;}
    if(!searchConfirmed){setError('请先在小红书搜索框中搜索当前关键词，确认结果页已加载后勾选确认。');return;}
    setSending(true);
    try {
      // 用户点击直接申请小红书具体域权限；不请求Cookie、历史记录或全站权限。
      if(!await requestOriginForUrl('https://www.xiaohongshu.com/'))throw new Error('未授予小红书网页权限');
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});if(tab?.id==null)throw new Error('请先打开小红书搜索结果页');
      const jobId=crypto.randomUUID();
      await sendRequest('DISCOVERY_START',{jobId,productId,tabId:tab.id,direction,maxPosts:Number(maxPostsInput)});
      await browser.storage.local.set({[LAST]:jobId});
      setJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId})).job);
    }catch(e){setError(e instanceof Error?e.message:'任务启动失败');}finally{setSending(false);}
  };
  const control=async(action:'pause'|'stop'|'continue')=>{
    if(!job)return;setSending(true);setError('');
    try {await sendRequest('DISCOVERY_CONTROL',{jobId:job.id,action});setJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId:job.id})).job);}
    catch(e){setError(toErrorPayload(e).message);if(action==='stop')setJob(null);}finally{setSending(false);}
  };
  return <section className="sl-page sl-discovery-page">
    <h2>寻找客户</h2>
    <p className="sl-page-intro">先选择产品和搜索方向，在已登录的小红书网页中手动搜索。插件只处理当前已加载的搜索结果卡片，不会自动搜索或扩展结果；实际处理数量可能少于所选上限。任务运行时请勿手动切换小红书标签页。</p>
    <label className="sl-field">新任务产品：<select value={productId} onChange={e=>{setProductId(e.target.value);setSearchConfirmed(false);setCopyFeedback('');}}>{products.map(p=><option key={p.id} value={p.id}>{p.profile.name.value??'未命名产品'}</option>)}</select></label>
    <div className="sl-notice sl-notice--info sl-step-card" style={{display:'grid',gap:6,marginTop:8}}>
      <b className="sl-step-title"><span className="sl-step-number">1</span>复制并搜索关键词</b>
      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
        <label style={{display:'grid',gap:4,flex:1,minWidth:160}}>本次搜索关键词/分析方向：<select value={direction} onChange={e=>{setDirection(e.target.value);setSearchConfirmed(false);setCopyFeedback('');}}>{product?.profile.searchSuggestions.map(s=><option key={s}>{s}</option>)}</select></label>
        <button type="button" disabled={!direction||sending} onClick={()=>void copyCurrentDirection()}>复制当前关键词</button>
      </div>
      <p style={{margin:0}}>复制后切回已登录的小红书页面，粘贴到顶部搜索框并点击搜索。插件不会自动输入或提交搜索。</p>
      {copyFeedback&&<p role="status" style={{margin:0,color:copyFeedback.startsWith('已复制')?'#067647':'#b42318'}}>{copyFeedback}</p>}
      <label style={{display:'flex',gap:6,alignItems:'flex-start'}}><input type="checkbox" checked={searchConfirmed} disabled={sending||!direction} onChange={e=>setSearchConfirmed(e.target.checked)} />我已在小红书搜索框中搜索该关键词，并确认当前页面已显示搜索结果。</label>
    </div>
    <p className="sl-post-limit"><label htmlFor="discovery-max-posts">新任务帖子数量上限（1–100 篇）</label><input id="discovery-max-posts" type="number" inputMode="numeric" min={1} max={100} step={1} value={maxPostsInput} disabled={sending} aria-invalid={!maxPostsValid} onChange={e=>setMaxPostsInput(e.target.value)} style={{width:88,padding:'4px 6px'}} /></p>
    {!maxPostsValid&&<p role="alert" style={{marginTop:-8,color:'#b42318'}}>请输入 1 到 100 之间的整数。</p>}
    <div className="sl-notice sl-notice--warning sl-rule-note"><b>采集规则与安全边界</b><p>请确认搜索结果与该方向相关。每篇最多 {LIMITS.maxSessionComments} 条评论，按顺序串行执行，不设全任务总时限。单篇主动处理超过 30 分钟会暂停，暂停时间不计入，可检查页面或模型后手动继续。达到评论安全上限或页面显示数高于采集数时，该帖子会标记为部分采集并跳过 AI 分析，不会伪装成完整结果。遇到登录、安全验证或风控提示会暂停；评论与笔记将发送给已配置的 AI 服务分析，结果保存在本机。</p></div>
    {blockingStart&&<div className="sl-notice sl-notice--warning">上次任务还在运行。开始新任务前会先暂停上次任务并保存进度；已保存的评论和线索不会删除。</div>}
    <button className="sl-button--primary" disabled={sending||!productId||!direction||!searchConfirmed||!maxPostsValid} onClick={()=>void start()}>{blockingStart?'开始新任务（自动暂停上次）':state?.status==='paused'?'开始新任务':'开始寻找客户'}</button>
    {state && <div className="sl-card sl-task-card" aria-live="polite">
      <b>{backgroundInterrupted?'上次任务在后台中断':state.status==='running'?'SeekLead 正在寻找客户':state.status==='paused'?'任务已暂停':job?.status==='partial'?'本次任务部分完成（有帖子未采全）':state.status==='completed'?'本次任务已结束':'任务已停止'}</b>
      <p>产品：{products.find(p=>p.id===job?.productId)?.profile.name.value??'—'}</p>
      <p>当前方向：{state.direction}</p>
      <p>已处理帖子：{job?.completedItems??state.index} / {state.total}</p>
      {(state.partialPosts??0)>0 && <p role="status">部分采集帖子：{state.partialPosts} 篇。已保留评论，但因采集不完整而跳过 AI 分析；这些帖子不计为完整成功。</p>}
      <p>当前帖子：第 {Math.min(state.index+1,state.total)} / {state.total}</p>
      <p>评论：累计已读取 {state.comments} 条（当前帖 {state.currentComments} 条）</p>
      {job?.collection && job.collection.discoveredCount===state.currentComments && <div><b>本帖评论采集</b><CollectionProgressView progress={job.collection}/></div>}
      <p>Lead：发现 {state.leads} 条（高意向或有需求，在线索页查看）</p>
      <p>状态：{state.phase}</p>{state.reason && <ErrorNotice message={state.reason} code={job?.errorCode} tone="warning" />}
      {!!state.trace?.length && <details><summary>任务诊断记录（本地，最多200条）</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:260,overflow:'auto'}}>{JSON.stringify(state.trace,null,2)}</pre></details>}
      {state.status==='paused' && state.post?.stage==='completed' && <p>{state.index+1<state.total?'当前帖子已完成，继续将处理下一篇。':'最后一篇已完成，继续将完成任务收尾。'}</p>}
      {state.status==='paused' && state.post?.stage==='captured' && <p>本帖评论已保存，继续将完成分析，不重新采集。</p>}
      {state.status==='paused' && state.post?.stage==='partial' && <p>本帖仅完成部分采集，评论已保留且未进行 AI 分析；继续任务会处理下一篇，不会将本帖伪装成完整采集。</p>}
      {state.status==='paused'&&!backgroundInterrupted&&<p>上次任务已暂停。你可以继续上次任务，也可以直接开始新任务；已保存的评论和线索不会删除。开始新任务前，请先确认小红书页面停在搜索结果页。</p>}
      {backgroundInterrupted&&<p>上次任务因扩展后台重启而停下来了。已经保存的评论和线索还在；你可以直接开始新任务，也可以继续上次任务。开始前请确认小红书页面停在搜索结果页。</p>}
      <p>达到等待停止条件仅表示暂未发现新评论，不代表已采集全部评论；平台限制可能影响结果。</p>
      {(blockingStart || state.status==='paused') && <div style={{display:'flex',gap:8}}>
        {state.status==='running'?<button disabled={sending} onClick={()=>void control('pause')}>暂停</button>:<button disabled={sending} onClick={()=>void control('continue')}>继续上次任务（先检查小红书页面）</button>}
        <button disabled={sending} onClick={()=>void control('stop')}>停止任务</button>
      </div>}
    </div>}
    {error && <ErrorNotice message={error} tone="error" />}
    <p className="sl-page-footnote">遇验证码、登录或风控会暂停，不自动刷新或绕过。采用只读、单页串行、有限任务、人工可暂停设计；这不能保证平台不会采取账号限制措施。</p>
  </section>;
}
