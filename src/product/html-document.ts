import { DOMParser as WorkerDOMParser } from 'linkedom/worker';

/** Background 无原生 DOMParser；worker 解析器只构造离线 DOM，不执行页面脚本。 */
export function parseHtmlDocument(html: string): Document {
  if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(html, 'text/html');
  // LinkeDOM 的 Document 类型未实现浏览器全部 API；调用方仅使用抽取所需 DOM 子集。
  return new WorkerDOMParser().parseFromString(html, 'text/html') as unknown as Document;
}
