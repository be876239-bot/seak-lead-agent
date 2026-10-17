import type { CaptureProgress } from '../domain/schemas';

export const CAPTURE_STOP_LABELS: Record<NonNullable<CaptureProgress['stopReason']>, string> = {
  no_new: '连续多轮未发现新增评论，已停止；无法确认是否全部',
  no_more: '页面明确显示暂无评论',
  limit: '已达到500条安全上限；未采集部分不在结果内',
  time_limit: '已达到本轮采集时间上限，未确认全部',
  round_limit: '已达到本轮滚动次数上限，未确认全部',
  cancelled: '用户已取消；此前保存的评论保留',
  error: '采集失败或受到平台限制；此前保存的评论保留，请查看错误信息',
};

export default function CollectionProgressView({ progress }: { progress: CaptureProgress }) {
  return (
    <div role="status" style={{ fontSize: 12, padding: 8, background: '#f0f7ff', overflowWrap: 'anywhere' }}>
      <div>已发现 {progress.discoveredCount} 条 · 本轮新增 {progress.addedCount} 条</div>
      {progress.topLevelCount!==undefined && progress.replyCount!==undefined && <div>一级评论：{progress.topLevelCount} · 回复：{progress.replyCount}</div>}
      <div>页面显示评论数：{progress.displayedCommentCount===undefined||progress.displayedCommentCount===null?'暂不可读取':`${progress.displayedCommentCount} 条`}</div>
      <div>{progress.countStatus==='below_displayed_total'?'完整性提示：已采集数量少于页面显示数，可能仍有评论未读取。':progress.countStatus==='meets_or_exceeds_displayed_total'?'数量提示：已采集数达到页面显示数；回复、隐藏评论及平台统计口径仍可能影响完整性。':'完整性提示：页面总数不可用，无法按数量核对。'}</div>
      <div>{progress.loadingReplies && progress.loading ? '正在加载回复…' : progress.loading ? '正在滚动/等待网页加载更多评论…' : '当前未在加载'}</div>
      <div>{progress.stopReason ? CAPTURE_STOP_LABELS[progress.stopReason] : '是否还有更多评论：尚未确认'}</div>
    </div>
  );
}
