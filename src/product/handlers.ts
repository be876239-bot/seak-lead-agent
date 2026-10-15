import { registerSensitiveHandler } from '../messaging/handlers';
import { readRenderedProduct, cancelRenderedRead } from './render-reader';

export function registerProductHandlers(): void {
  registerSensitiveHandler('PRODUCT_READ_RENDERED', async (req) => {
    if (req.type !== 'PRODUCT_READ_RENDERED') throw new Error('类型错误');
    return readRenderedProduct(req.payload.jobId, req.payload.url);
  });
  registerSensitiveHandler('PRODUCT_CANCEL_READ', async (req) => {
    if (req.type !== 'PRODUCT_CANCEL_READ') throw new Error('类型错误');
    return { cancelled: cancelRenderedRead(req.payload.jobId) };
  });
}
