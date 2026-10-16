import type { Comment, Decision } from '../domain/schemas';
import { safeExternalUrl } from './logic';

/** 只展示模型依据与人工跳转链接，不触发平台互动。 */
export default function LeadExplanation({ decision, profileUrl, comment, parentComment }: {
  decision: Decision; profileUrl?: string | null; comment?: Comment; parentComment?: Comment | null;
}) {
  const url = safeExternalUrl(profileUrl);
  return (
    <div style={{ display: 'grid', gap: 4, fontSize: 12, overflowWrap: 'anywhere' }}>
      {comment && <div>来源类型：{comment.parentKey ? '回复' : '一级评论'}</div>}
      {comment?.parentKey && <>
        <div><b>父评论：</b>{parentComment?.text ?? '父评论文字未采集或已过期，无法展示'}</div>
        <div><b>用户回复：</b>{comment.text}</div>
      </>}
      <div><b>判断理由：</b>{decision.reason}</div>
      {decision.uncertainty && <div style={{ color: '#b60' }}>不确定：{decision.uncertainty}</div>}
      {url && <a href={url} target="_blank" rel="noreferrer">查看该评论者主页</a>}
    </div>
  );
}
