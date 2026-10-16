import CollectionProgressView from '../../src/ui/CollectionProgress';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Job, Product } from '../../src/domain/schemas';
import { sendRequest } from '../../src/messaging/client';
import { requestOriginForUrl } from '../../src/messaging/handlers';
import { toErrorPayload } from '../../src/domain/errors';
import { getSelectedProductId, ui } from '../../src/ui/store';

const LAST='discovery.lastJobId';
export default function Discovery() {
  const [products,setProducts]=useState<Product[]>([]);
  const [productId,setProductId]=useState('');
  const [direction,setDirection]=useState('');
  const [job,setJob]=useState<Job|null>(null);
  const [error,setError]=useState('');const [sending,setSending]=useState(false);
  const product=products.find(p=>p.id===productId);
  const state=job?.discovery;
  const active=state && ['running','paused'].includes(state.status) && job?.status!=='cancelled';
  useEffect(()=>{void (async()=>{
    const list=await ui.listProducts();setProducts(list);const selected=await getSelectedProductId();
    setProductId(list.find(p=>p.id===selected)?.id??list[0]?.id??'');
    const saved=await browser.storage.local.get(LAST);if(typeof saved[LAST]==='string') {
      const res=await sendRequest<{job:Job|null}>('JOB_GET',{jobId:saved[LAST]});setJob(res.job);
    }
  })().catch(e=>setError(toErrorPayload(e).message));},[]);
  useEffect(()=>{setDirection(product?.profile.searchSuggestions[0]??'');},[product]);
  useEffect(()=>{
    if(!job || ['completed','stopped'].includes(job.discovery?.status??''))return;const id=job.id;
    const timer=window.setInterval(()=>{void sendRequest<{job:Job|null}>('JOB_GET',{jobId:id}).then(res=>setJob(res.job)).catch(e=>setError(toErrorPayload(e).message));},1000);
    return ()=>window.clearInterval(timer);
  },[job?.id,job?.discovery?.status]);
  const start=async()=>{
    setSending(true);setError('');
    try {
      // 用户点击直接申请小红书具体域权限；不请求Cookie、历史记录或全站权限。
      if(!await requestOriginForUrl('https://www.xiaohongshu.com/'))throw new Error('未授予小红书网页权限');
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});if(tab?.id==null)throw new Error('请先打开小红书搜索结果页');
      const jobId=crypto.randomUUID();
      await sendRequest('DISCOVERY_START',{jobId,productId,tabId:tab.id,direction});
      await browser.storage.local.set({[LAST]:jobId});
      setJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId})).job);
    }catch(e){setError(e instanceof Error?e.message:'任务启动失败');}finally{setSending(false);}
  };
  const control=async(action:'pause'|'stop'|'continue')=>{
    if(!job)return;setSending(true);setError('');
    try {await sendRequest('DISCOVERY_CONTROL',{jobId:job.id,action});setJob((await sendRequest<{job:Job|null}>('JOB_GET',{jobId:job.id})).job);}
    catch(e){setError(toErrorPayload(e).message);if(action==='stop')setJob(null);}finally{setSending(false);}
  };
  return <section>
    <h2 style={{fontSize:16}}>寻找客户</h2>
    <p>先选择产品和搜索方向，在已登录的小红书网页中手动完成搜索并保留结果页，再开始任务。只处理当前已加载结果中的前 5 篇，不自动扩展搜索。</p>
    <label>产品：<select value={productId} disabled={!!active} onChange={e=>setProductId(e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.profile.name.value??'未命名产品'}</option>)}</select></label>
    <p><label>当前方向：<select value={direction} disabled={!!active} onChange={e=>setDirection(e.target.value)}>{product?.profile.searchSuggestions.map(s=><option key={s}>{s}</option>)}</select></label></p>
    <p>请自行确认搜索结果与该方向相关。本次最多 5 篇、每篇 500 条、总计 10 分钟（含暂停），单页串行。评论与笔记将发送给已配置的 AI 服务分析，结果保存在本机。</p>
    {!active && <button disabled={sending||!productId||!direction} onClick={()=>void start()}>开始寻找客户</button>}
    {state && <div aria-live="polite" style={{border:'1px solid #ddd',padding:10,marginTop:12}}>
      <b>{state.status==='running'?'SeekLead 正在寻找客户':state.status==='paused'?'任务已暂停':state.status==='completed'?'本次任务已结束':'任务已停止'}</b>
      <p>产品：{products.find(p=>p.id===job?.productId)?.profile.name.value??'—'}</p>
      <p>当前方向：{state.direction}</p>
      <p>当前帖子：第 {Math.min(state.index+1,state.total)} / {state.total}</p>
      <p>评论：累计已读取 {state.comments} 条（当前帖 {state.currentComments} 条）</p>
      {job?.collection && job.collection.discoveredCount===state.currentComments && <div><b>本帖评论采集</b><CollectionProgressView progress={job.collection}/></div>}
      <p>Lead：发现 {state.leads} 条（高意向或有需求，在线索页查看）</p>
      <p>状态：{state.phase}</p>{state.reason && <p>{state.reason}</p>}
      {job?.status==='interrupted'&&state.status==='running'&&<p>后台已中断，未自动恢复。请停止旧任务后重新启动；本地结果保留。</p>}
      <p>达到等待停止条件仅表示暂未发现新评论，不代表已采集全部评论；平台限制可能影响结果。</p>
      {active && <div style={{display:'flex',gap:8}}>
        {state.status==='running'?<button disabled={sending} onClick={()=>void control('pause')}>暂停</button>:<button disabled={sending} onClick={()=>void control('continue')}>继续（已手动处理页面）</button>}
        <button disabled={sending} onClick={()=>void control('stop')}>停止任务</button>
      </div>}
    </div>}
    {error && <p role="alert" style={{color:'#b00'}}>{error}</p>}
    <p style={{fontSize:12,color:'#777'}}>遇验证码、登录或风控会暂停，不自动刷新或绕过。采用保守的只读、单页串行、有限任务、人工可暂停设计；尚未证明平台不会采取任何账号限制措施。</p>
  </section>;
}
