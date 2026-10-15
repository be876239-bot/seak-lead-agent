import { browser } from 'wxt/browser';
import { AppError } from '../domain/errors';
import type { Comment, Note } from '../domain/schemas';
import {
  buildRequest, ResponseSchema, SnapshotPayload, XhsStatusPayload, type Request,
} from '../messaging/protocol';

export type CapturedNote = {
  noteKey: string;
  parserVersion: string;
  note: Note;
  comments: Comment[];
  truncated: boolean;
  hasMoreLoaded: boolean;
};

async function ask(tabId: number, req: Request): Promise<unknown> {
  let raw: unknown;
  try {
    raw = await browser.tabs.sendMessage(tabId, req);
  } catch {
    throw new AppError('PAGE_UNSUPPORTED', '无法连接笔记页面脚本：请刷新该小红书标签页后重试（扩展重新加载后旧标签页的脚本会失效）', true);
  }
  const res = ResponseSchema.safeParse(raw);
  if (!res.success) throw new AppError('PARSE_FAILED', '页面脚本返回了非法响应');
  if (!res.data.ok) {
    const e = res.data.error;
    throw new AppError(e?.code ?? 'UNKNOWN', e?.message ?? '页面脚本通信失败', e?.retryable ?? false);
  }
  return res.data.data;
}

/** 面板用于显示当前标签页状态的只读查询。 */
export async function getNoteStatus(tabId: number): Promise<XhsStatusPayload> {
  return XhsStatusPayload.parse(await ask(tabId, buildRequest('XHS_GET_STATUS', {})));
}

/** 从指定标签页采集“已加载”的笔记与评论：STATUS → START → 按 cursor 翻页 → STOP。绝不自动滚动。 */
export async function captureNote(tabId: number): Promise<CapturedNote> {
  const status = await getNoteStatus(tabId);
  if (status.blocked) throw new AppError('PAGE_BLOCKED', '页面当前被限流或验证码拦截，请稍后手动处理后再试');
  if (!status.supported || !status.noteKey) {
    throw new AppError('PAGE_UNSUPPORTED', '当前标签页不是受支持的小红书笔记页');
  }
  const expectedNoteKey = status.noteKey;

  const first = SnapshotPayload.parse(await ask(tabId, buildRequest('XHS_START_SESSION', { expectedNoteKey })));
  const comments: Comment[] = [...first.comments];
  let note: Note | null = first.note;
  let truncated = first.truncated;
  let hasMoreLoaded = first.hasMoreLoaded;
  let cursor = first.nextCursor;

  try {
    while (cursor) {
      const page = SnapshotPayload.parse(await ask(tabId, buildRequest('XHS_GET_SNAPSHOT', {
        sessionId: first.sessionId, expectedNoteKey, cursor,
      })));
      comments.push(...page.comments);
      note ??= page.note;
      truncated ||= page.truncated;
      hasMoreLoaded ||= page.hasMoreLoaded;
      cursor = page.nextCursor;
    }
  } finally {
    await ask(tabId, buildRequest('XHS_STOP_SESSION', { sessionId: first.sessionId })).catch(() => {});
  }

  if (!note) throw new AppError('PARSE_FAILED', '未能从页面解析出笔记内容');
  return { noteKey: expectedNoteKey, parserVersion: status.parserVersion, note, comments, truncated, hasMoreLoaded };
}
