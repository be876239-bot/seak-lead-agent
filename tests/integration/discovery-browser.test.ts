import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {buildError,buildOk} from '../../src/messaging/protocol';
import {AppError,toErrorPayload} from '../../src/domain/errors';
const api=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),update:vi.fn(),sendMessage:vi.fn()}));
vi.mock('wxt/browser',()=>({browser:{tabs:api}}));
const {DiscoveryBrowser}=await import('../../src/discovery/browser');
const url='https://www.xiaohongshu.com/explore/'+ 'a'.repeat(24);
beforeEach(()=>{
  vi.useFakeTimers();Object.values(api).forEach(fn=>fn.mockReset());
  api.create.mockResolvedValue({id:8});api.update.mockResolvedValue({id:8});api.get.mockResolvedValue({id:8,url,status:'complete'});
  api.sendMessage.mockImplementation(async(_id,req)=>buildOk(req.requestId,req.type==='XHS_GET_STATUS'?{noteKey:'xhs:'+'a'.repeat(24),parserVersion:'test',supported:true,blocked:false}:{ok:true}));
});
afterEach(()=>vi.useRealTimers());
it('uses a single task tab for all navigation, never social write APIs',async()=>{
 const page=new DiscoveryBrowser(7);const signal=new AbortController().signal;
 await page.navigate(url,signal);await page.ready(url,signal);await page.navigate(url,signal);await page.ready(url,signal);
 expect(api.create).toHaveBeenCalledTimes(1);expect(api.create).toHaveBeenCalledWith({url:'about:blank',active:true});
 expect(api.update).toHaveBeenCalledTimes(2);expect(api.sendMessage.mock.calls.every(([,r])=>['XHS_GUARD','XHS_GET_STATUS'].includes(r.type))).toBe(true);
});
it('cancellation while creating tab does not navigate after the pending API resolves',async()=>{
 const ac=new AbortController();api.create.mockImplementation(async()=>{ac.abort();return{id:8};});
 const page=new DiscoveryBrowser(7);await expect(page.navigate(url,ac.signal)).rejects.toMatchObject({code:'CANCELLED'});expect(api.update).not.toHaveBeenCalled();
});
it('waits for complete loading before checking note status',async()=>{
 api.get.mockResolvedValueOnce({url,status:'loading'});const page=new DiscoveryBrowser(7);const signal=new AbortController().signal;await page.navigate(url,signal);
 const pending=page.ready(url,signal);await Promise.resolve();expect(api.sendMessage).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1000);await pending;
 expect(api.sendMessage).toHaveBeenCalled();
});
it('CAPTCHA interrupts immediately without more navigation or refresh',async()=>{
 api.sendMessage.mockImplementation(async(_id,req)=>buildError(req.requestId,toErrorPayload(new AppError('PAGE_BLOCKED','平台限制：安全验证'))));
 const page=new DiscoveryBrowser(7);const signal=new AbortController().signal;await page.navigate(url,signal);
 await expect(page.ready(url,signal)).rejects.toMatchObject({code:'PAGE_BLOCKED'});expect(api.sendMessage).toHaveBeenCalledTimes(1);expect(api.update).toHaveBeenCalledTimes(1);
});
it('login redirection is reported as platform restriction first',async()=>{
 api.get.mockResolvedValue({url:'https://www.xiaohongshu.com/login',status:'complete'});
 api.sendMessage.mockImplementation(async(_id,req)=>buildError(req.requestId,toErrorPayload(new AppError('PAGE_BLOCKED','请登录'))));
 const page=new DiscoveryBrowser(7);const signal=new AbortController().signal;await page.navigate(url,signal);await expect(page.ready(url,signal)).rejects.toMatchObject({code:'PAGE_BLOCKED'});
});
it('three successive script readiness failures stop, never refresh or infinite retry',async()=>{
 api.sendMessage.mockRejectedValue(new Error('no content script'));const page=new DiscoveryBrowser(7);const signal=new AbortController().signal;await page.navigate(url,signal);
 const pending=expect(page.ready(url,signal)).rejects.toMatchObject({code:'PARSE_FAILED'});await vi.advanceTimersByTimeAsync(3000);await pending;expect(api.sendMessage).toHaveBeenCalledTimes(3);expect(api.update).toHaveBeenCalledTimes(1);
});
it('loading has a finite 30 second budget',async()=>{
 api.get.mockResolvedValue({url,status:'loading'});const page=new DiscoveryBrowser(7);const signal=new AbortController().signal;await page.navigate(url,signal);
 const pending=expect(page.ready(url,signal)).rejects.toMatchObject({code:'PAGE_UNREACHABLE'});await vi.advanceTimersByTimeAsync(30000);await pending;expect(api.get).toHaveBeenCalledTimes(30);
});
it('manual navigation to another note pauses before capture',async()=>{
 api.get.mockResolvedValue({url:url.replace(/a{24}/,'b'.repeat(24)),status:'complete'});const page=new DiscoveryBrowser(7);const signal=new AbortController().signal;await page.navigate(url,signal);
 await expect(page.ready(url,signal)).rejects.toMatchObject({code:'PAGE_CHANGED'});
});
it('closed tab or missing browser permission is an explicit error',async()=>{
 api.get.mockRejectedValue(new Error('No tab'));const page=new DiscoveryBrowser(7);await expect(page.guard()).rejects.toThrow('No tab');
 api.get.mockResolvedValue({status:'complete'});await expect(page.guard()).rejects.toMatchObject({code:'PAGE_CHANGED'});
});
