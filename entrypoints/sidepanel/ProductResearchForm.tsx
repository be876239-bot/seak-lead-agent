import { useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { buildRequest, ResponseSchema } from '../../src/messaging/protocol';
import { sendRequest } from '../../src/messaging/client';
import { readProductDocument } from '../../src/product/research';
import { copyTextToClipboard } from '../../src/ui/clipboard';
import type { ProductSource } from '../../src/domain/schemas';

type ResearchMode = 'document' | 'xhs_product' | 'xhs_account';
type ResearchNote = { url: string; title: string; excerpt: string };
type Props = { onCreated: (productId: string) => Promise<void> };

function candidateKeywords(mode: ResearchMode, name: string, account: string, category: string, target: string, description: string): string[] {
  const clean = (v: string) => v.trim();
  const n = clean(name);
  const a = clean(account);
  const c = clean(category);
  const t = clean(target);
  const d = clean(description);
  const accountTerm = a && !/^https?:\/\//i.test(a) ? a : '';
  const terms = mode === 'xhs_product'
    ? [n, c && n ? `${n} ${c}` : '', n ? `${n} 测评` : '', n ? `${n} 使用体验` : '', c ? `${c} 推荐` : '']
    : [accountTerm, t, accountTerm && t ? `${accountTerm} ${t}` : '', c ? `${c} 产品` : '', d.split(/[，。；;\n]/).map(clean).find(x => x.length >= 2 && x.length <= 24) ?? ''];
  return [...new Set(terms.map(clean).filter(Boolean))].slice(0, 5);
}

async function readCurrentXhsNote(): Promise<ResearchNote> {
  const granted = await browser.permissions.request({ origins: ['https://www.xiaohongshu.com/*'] });
  if (!granted) throw new Error('需要授权读取当前小红书页面；插件只读取当前笔记公开可见的标题和正文摘录。');
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null || !tab.url || !/^https:\/\/www\.xiaohongshu\.com\//i.test(tab.url)) {
    throw new Error('请先切换到小红书，并打开一篇相关笔记详情页。');
  }
  let raw: unknown;
  try {
    raw = await browser.tabs.sendMessage(tab.id, buildRequest('XHS_RESEARCH_READ_NOTE', {}));
  } catch {
    throw new Error('暂时无法读取当前页面。请刷新小红书页面后重试；不会自动翻页或绕过验证。');
  }
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('小红书页面返回的数据格式不正确，请刷新页面后重试。');
  if (!parsed.data.ok) throw new Error(parsed.data.error?.message ?? '读取笔记失败');
  const data = parsed.data.data as Partial<ResearchNote>;
  if (typeof data.url !== 'string' || typeof data.title !== 'string' || typeof data.excerpt !== 'string' || !data.title.trim() || !data.excerpt.trim()) {
    throw new Error('当前笔记没有可用的标题或正文；请打开一篇内容完整的公开笔记。');
  }
  return { url: data.url, title: data.title, excerpt: data.excerpt };
}

export default function ProductResearchForm({ onCreated }: Props) {
  const [mode, setMode] = useState<ResearchMode>('document');
  const [description, setDescription] = useState('');
  const [productName, setProductName] = useState('');
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [targetProduct, setTargetProduct] = useState('');
  const [fileName, setFileName] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [documentTruncated, setDocumentTruncated] = useState(false);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [searchConfirmed, setSearchConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const keywords = useMemo(() => candidateKeywords(mode, productName, account, category, targetProduct, description),
    [mode, productName, account, category, targetProduct, description]);

  const changeMode = (next: ResearchMode) => {
    setMode(next);
    setError('');
    setInfo('');
    setNotes([]);
    setSearchConfirmed(false);
  };

  const selectDocument = async (file?: File) => {
    setError('');
    setInfo('');
    setDocumentText('');
    setFileName('');
    setDocumentTruncated(false);
    if (!file) return;
    try {
      const result = await readProductDocument(file);
      setFileName(file.name);
      setDocumentText(result.text);
      setDocumentTruncated(result.truncated);
      setInfo(result.truncated ? '文档超过画像输入长度，已截取前 30,000 个字符。' : `已读取文档：${file.name}（${result.text.length.toLocaleString()} 字符）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取文档');
    }
  };

  const captureNote = async () => {
    setError('');
    setInfo('');
    if (notes.length >= 2) { setError('首版最多添加 2 篇研究笔记，请先移除一篇再添加。'); return; }
    try {
      const note = await readCurrentXhsNote();
      if (notes.some(n => n.url === note.url)) { setInfo('这篇笔记已经添加，不会重复保存。'); return; }
      setNotes(current => [...current, note]);
      setInfo(`已读取笔记「${note.title}」。这是当前页面可见内容，不代表已经研究完整个搜索结果。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取当前笔记失败');
    }
  };

  const submit = async () => {
    setError('');
    setInfo('');
    if (!description.trim()) { setError('请用一句话描述产品或账号主营内容，帮助缩小研究范围。'); return; }
    let source: ProductSource;
    let input: Record<string, unknown>;
    if (mode === 'document') {
      if (!fileName || !documentText.trim()) { setError('请先选择并成功读取一份 TXT/Markdown 产品文档。'); return; }
      source = { kind: 'document', description: description.trim(), fileName, truncated: documentTruncated };
      input = { source, documentText };
    } else if (mode === 'xhs_product') {
      if (!productName.trim()) { setError('请输入产品名或品牌名；不要把商家账号填在这里。'); return; }
      if (!searchConfirmed || notes.length === 0) { setError('请复制候选关键词，在小红书手动搜索并读取至少一篇相关笔记，然后勾选确认。'); return; }
      source = { kind: 'xhs_product', description: description.trim(), productName: productName.trim(),
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(account.trim() ? { account: account.trim() } : {}) };
      input = { source, notes, searchConfirmed };
    } else {
      if (!account.trim()) { setError('请输入商家账号昵称或主页链接；不要把产品名填在账号栏。'); return; }
      if (!searchConfirmed || notes.length === 0) { setError('请复制候选关键词，在小红书手动搜索或打开商家主页，读取至少一篇相关笔记，然后勾选确认。'); return; }
      source = { kind: 'xhs_account', description: description.trim(), account: account.trim(),
        ...(targetProduct.trim() ? { targetProduct: targetProduct.trim() } : {}),
        ...(category.trim() ? { category: category.trim() } : {}) };
      input = { source, notes, searchConfirmed };
    }

    setBusy(true);
    try {
      const jobId = crypto.randomUUID();
      const result = await sendRequest<{ productId: string; confirmation: 'draft' }>('PRODUCT_RESEARCH_CREATE', { jobId, input });
      await onCreated(result.productId);
      setInfo('产品画像草稿已生成。请核对来源证据，必要时修正名称、类别、概述和搜索词，再确认后才能进入寻客。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成产品画像草稿失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="sl-card sl-product-research">
      <summary>没有官网？用其他资料创建画像</summary>
      <p className="sl-page-footnote">可上传商家文档，或先在小红书研究产品/账号。新画像需要检查并确认后才能寻客。</p>
      <label className="sl-field">
        研究方式
        <select value={mode} disabled={busy} onChange={e => changeMode(e.target.value as ResearchMode)}>
          <option value="document">商家提供的产品文档</option>
          <option value="xhs_product">小红书搜索产品名 / 品牌名</option>
          <option value="xhs_account">小红书搜索商家账号</option>
        </select>
      </label>

      {mode === 'document' ? (
        <div className="sl-stack">
          <label className="sl-field">产品文档（TXT / Markdown，UTF-8，最大 512 KiB）
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" disabled={busy} onChange={e => void selectDocument(e.target.files?.[0])} />
          </label>
          {fileName && <p className="sl-page-footnote">已选：{fileName} · {documentText.length.toLocaleString()} 字符{documentTruncated ? '（已截断）' : ''}</p>}
        </div>
      ) : (
        <div className="sl-stack">
          {mode === 'xhs_product' ? (
            <>
              <label className="sl-field">产品名 / 品牌名（必填，不是账号）<input value={productName} disabled={busy} onChange={e => setProductName(e.target.value)} placeholder="例如：Massing" /></label>
              <label className="sl-field">商家账号（选填，用于核对身份）<input value={account} disabled={busy} onChange={e => setAccount(e.target.value)} placeholder="小红书昵称或主页链接" /></label>
            </>
          ) : (
            <>
              <label className="sl-field">商家账号昵称或主页链接（必填，不是产品名）<input value={account} disabled={busy} onChange={e => setAccount(e.target.value)} placeholder="输入昵称或粘贴账号主页链接" /></label>
              <label className="sl-field">目标产品名（选填）<input value={targetProduct} disabled={busy} onChange={e => setTargetProduct(e.target.value)} placeholder="例如：某系列镜框" /></label>
            </>
          )}
          <label className="sl-field">产品品类（选填）<input value={category} disabled={busy} onChange={e => setCategory(e.target.value)} placeholder="例如：眼镜、护肤品、AI 软件" /></label>
          <div className="sl-stack">
            <b>候选研究关键词</b>
            <p className="sl-page-footnote">由你的输入初步生成，仅用于开始搜索，不代表已核实的产品卖点。</p>
            {keywords.length ? keywords.map((word, i) => (
              <div className="sl-keyword" key={`${i}:${word}`}>
                <span className="sl-keyword-text">{word}</span>
                <button type="button" onClick={() => void copyTextToClipboard(word).then(() => setInfo(`已复制「${word}」，请切回小红书手动搜索。`)).catch(() => setError('复制失败，请手动选择关键词复制。'))}>复制</button>
              </div>
            )) : <p className="sl-page-footnote">先填写产品名或账号。</p>}
          </div>
          <button type="button" disabled={busy || notes.length >= 2} onClick={() => void captureNote()}>读取当前小红书笔记信息（最多 2 篇）</button>
          <p className="sl-page-footnote">使用前请在小红书手动搜索或打开目标账号的相关笔记，再点击读取。只读取当前打开笔记的公开可见标题和正文摘录，不自动翻页、不采集评论。</p>
          {notes.map((note, i) => (
            <div className="sl-card sl-research-note" key={note.url}>
              <div className="sl-product-heading"><b>来源笔记 {i + 1}</b><button type="button" onClick={() => setNotes(current => current.filter(n => n.url !== note.url))}>移除</button></div>
              <b>{note.title}</b>
              <a href={note.url} target="_blank" rel="noreferrer">查看原笔记</a>
              <p>{note.excerpt.slice(0, 500)}{note.excerpt.length > 500 ? '…' : ''}</p>
            </div>
          ))}
          <label className="sl-field">
            <span><input type="checkbox" checked={searchConfirmed} disabled={busy || notes.length === 0} onChange={e => setSearchConfirmed(e.target.checked)} /> 我已手动搜索并检查这些笔记与研究对象相关</span>
          </label>
        </div>
      )}

      <label className="sl-field">初步简单描述（必填）
        <textarea value={description} disabled={busy} onChange={e => setDescription(e.target.value)} rows={3}
          placeholder="用大白话写一句：是什么产品、卖给谁、有什么特点或解决什么问题。没有把握的内容也可以写“暂时不清楚”。" />
      </label>
      <button className="sl-button--primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? '正在生成画像草稿…' : '生成待确认的产品画像'}</button>
      {error && <p role="alert" className="sl-notice sl-notice--warning">{error}</p>}
      {info && <p role="status" className="sl-notice sl-notice--info">{info}</p>}
      <p className="sl-page-footnote">来源说明：商家文档和你的描述均未经过独立核实。小红书研究只基于你手动打开并添加的最多 2 篇笔记；不代表完整搜索结果。当前版本暂不支持 PDF/DOCX 原文件。</p>
    </details>
  );
}
