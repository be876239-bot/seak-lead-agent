/**
 * 小红书页面选择器。全部来自 2026-10-15 真实已登录页面采集的脱敏 fixture
 * （tests/fixtures/xhs/，依据见 meta.json 与 docs/evidence/README.md）。
 * 禁止在此添加未经 fixture 或真实页面验证的选择器。
 */
export const PARSER_VERSION = 'xhs-dom-v1';

export const SEL = {
  /** 详情弹层/独立详情页根容器 */
  noteRoot: '#noteContainer',
  noteTitle: '#detail-title',
  noteBody: '#detail-desc .note-text',
  /** 评论区域：解析必须限定在此容器内（X01） */
  commentsArea: '#noteContainer .comments-el',
  commentTotal: '#noteContainer .comments-el .total',
  listContainer: '#noteContainer .comments-el .list-container',
  parentWrapper: '.parent-comment',
  commentItem: '.comment-item:not(.comment-item-sub)',
  subCommentItem: '.comment-item.comment-item-sub',
  replyContainer: '.reply-container',
  /** 评论字段（相对 commentItem） */
  commentIdAttrPrefix: 'comment-',
  authorLink: '.author a.name',
  authorTag: '.author .tag',
  content: '.content .note-text',
  date: '.info .date > span:not(.location)',
  location: '.info .date .location',
  likeCount: '.interactions .like .count',
  replyCount: '.interactions .reply .count',
  showMore: '.show-more',
  noComments: '.no-comments',
  /** 遮挡检测：登录弹窗为已验证特征；验证码特征待真实环境补证 */
  loginOverlay: '.login-container',
} as const;
