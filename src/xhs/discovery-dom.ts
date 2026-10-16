import { AppError } from '../domain/errors';

export function visible(el: Element): boolean {
  for(let node: Element | null=el;node;node=node.parentElement) {
    const style=node.ownerDocument.defaultView?.getComputedStyle(node);
    if(node.hasAttribute('hidden') || node.getAttribute('aria-hidden')==='true' || style?.display==='none' || style?.visibility==='hidden') return false;
  }
  return true;
}
/** 只检查可见的页面级提示，避免把评论正文中的“验证码”误判为平台验证。 */
export function platformBlock(doc: Document): string | null {
  if([...doc.querySelectorAll('.login-container')].some(visible)) return '平台限制：登录已失效或需要登录，请手动处理';
  // 用户实际报告的页面级错误文案；避开正文/评论，既有DOM仍在也必须暂停。
  const errors=[...doc.querySelectorAll('body *')].filter(el=>!el.children.length && !el.closest('#detail-title,#detail-desc,.comments-el,section.note-item,script,style,noscript') && visible(el));
  if(errors.some(el=>/当前笔记暂时无法浏览|笔记暂时无法(?:浏览|查看)|请打开小红书\s*App\s*扫码查看|非法消息|你访问的页面不见了|笔记不存在/i.test(el.textContent??'')))return '平台限制或页面异常：当前笔记无法浏览、扫码查看或非法消息，请人工检查；任务已暂停';
  const indicators=doc.querySelectorAll('[role="dialog"], [role="alert"], iframe[title], iframe[src*="captcha"], [id*="captcha"], [class*="captcha"], [class*="verify"], [class*="security"], .error-page, .error-container');
  for(const el of indicators) {
    if(!visible(el))continue;
    const label=(el.textContent ?? '')+' '+(el.getAttribute('title') ?? '');
    if(/captcha|安全验证|滑块|拖动|验证后|完成验证|访问异常|操作频繁|访问频繁|异常访问|账号异常|风险|风控|登录后|重新登录|登录失效/i.test(label) || /captcha/i.test(el.id+' '+el.className+' '+(el.getAttribute('src')??'')))
      return '平台限制：检测到登录、安全验证或风控提示。请手动处理后点击继续';
  }
  const prompts=[...doc.querySelectorAll('body *')].filter(el=>!el.children.length && !el.closest('#noteContainer,section.note-item,script,style,noscript') && visible(el));
  if(prompts.slice(0,2000).some(el=>/^(?:请.*(?:登录|安全验证|完成验证|拖动滑块)|访问异常|操作频繁|访问频繁|账号异常|网络异常|加载失败)/.test((el.textContent??'').trim()))) return '平台限制或页面异常：请手动检查后继续';
  // 单独的登录/验证页面（无正常笔记/卡片），仅用有限文本判断，绝不读取表单值。
  if(!doc.querySelector('#noteContainer, section.note-item')) {
    const text=[...doc.querySelectorAll('body *')].filter(el=>!el.children.length && visible(el)).map(el=>el.textContent??'').join(' ').slice(0,2000);
    if(/安全验证|请完成验证|请登录|扫码登录|滑块|访问异常|操作频繁|访问频繁|异常访问|账号异常/.test(text)) return '平台限制：页面需要人工验证或登录';
  }
  return null;
}
export function noteUrl(value: string, base='https://www.xiaohongshu.com'): string | null {
  try {
    const url=new URL(value,base);
    if(url.origin!=='https://www.xiaohongshu.com' || url.username || url.password || !/^\/(?:explore|search_result|discovery\/item)\/[0-9a-z]{24}\/?$/.test(url.pathname)) return null;
    return url.href;
  }catch{return null;}
}
export function noteKeyFromUrl(value: string): string {
  const url=noteUrl(value);if(!url)throw new AppError('URL_INVALID','不支持的笔记链接');
  return 'xhs:'+new URL(url).pathname.split('/').filter(Boolean).at(-1)!;
}
/** 使用历史fixture证实的卡片/链接；只读取当前已加载搜索结果，既不搜索接口也不滚动搜索页。 */
export function readSearchNotes(doc: Document, location: string): string[] {
  const url=new URL(location);
  const block=platformBlock(doc);if(block)throw new AppError('PAGE_BLOCKED',block);
  if(url.origin!=='https://www.xiaohongshu.com'||url.pathname!=='/search_result') throw new AppError('PAGE_UNSUPPORTED','请先在小红书正常搜索并保留搜索结果页');
  if([...doc.querySelectorAll('#noteContainer')].some(visible)) throw new AppError('PAGE_UNSUPPORTED','请先关闭笔记详情，回到搜索结果页');
  const seen=new Set<string>();const found:string[]=[];
  for(const a of doc.querySelectorAll('section.note-item a[href]')) {
    const href=noteUrl(a.getAttribute('href')??'',url.origin);if(!href)continue;
    const key=noteKeyFromUrl(href);if(seen.has(key))continue;seen.add(key);found.push(href);if(found.length===5)break;
  }
  if(!found.length)throw new AppError('PARSE_FAILED','当前搜索结果没有可识别的公开笔记链接；不会调用私有接口');
  return found;
}
