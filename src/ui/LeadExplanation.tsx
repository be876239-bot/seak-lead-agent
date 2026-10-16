import type { Decision } from '../domain/schemas';
import { safeExternalUrl } from './logic';

/** 只展示模型依据与人工跳转链接，不触发平台互动。 */
export default function LeadExplanation({ decision, profileUrl }: {
  decision: Decision; profileUrl?: string | null;
}) {
  const url = safeExternalUrl(profileUrl);
  return (
    <div style={{ display: 'grid', gap: 4, fontSize: 12, overflowWrap: 'anywhere' }}>
      <div><b>判断理由：</b>{decision.reason}</div>
      {decision.uncertainty && <div style={{ color: '#b60' }}>不确定：{decision.uncertainty}</div>}
      {url && <a href={url} target="_blank" rel="noreferrer">查看该评论者主页</a>}
    </div>
  );
}
