import { ERROR_CODES, type ErrorCode } from '../domain/errors';

export interface ErrorExplanation {
  code: ErrorCode | null;
  title: string;
  whatHappened: string;
  impact: string;
  nextStep: string;
  technicalDetails: string;
}

type Copy = Omit<ErrorExplanation, 'code' | 'technicalDetails'>;

const COPY: Record<ErrorCode, Copy> = {
  PERMISSION_DENIED: {
    title: '还没有获得网页读取权限',
    whatHappened: '插件暂时无法读取这个网站的页面内容。',
    impact: '本次操作没有完成；此前保存的评论和线索不会因此被删除。',
    nextStep: '重新触发网站授权，在浏览器弹窗中选择允许，然后重试。',
  },
  URL_INVALID: {
    title: '链接格式不正确',
    whatHappened: '输入的地址不是可识别的完整网页链接。',
    impact: '任务尚未正常开始，已有历史数据不受影响。',
    nextStep: '复制公开商品页或笔记页的完整 http:// 或 https:// 地址，再试一次。',
  },
  URL_PRIVATE_BLOCKED: {
    title: '这个地址不能读取',
    whatHappened: '出于安全考虑，插件不会读取本机、内网或其他受限地址。',
    impact: '本次读取没有开始，历史线索不受影响。',
    nextStep: '改用可公开访问的商品网页链接。',
  },
  PAGE_UNSUPPORTED: {
    title: '当前页面暂时无法读取',
    whatHappened: '当前打开的页面不是插件能识别的页面，或者页面脚本尚未正常加载。',
    impact: '当前步骤已停止，已经保存的评论和线索会保留。',
    nextStep: '确认打开的是正确的小红书搜索结果页或笔记页；必要时刷新页面后再试。',
  },
  PAGE_CHANGED: {
    title: '网页和任务记录对不上了',
    whatHappened: '插件发现当前页面与任务中记录的搜索结果或目标笔记不一致，为避免读错内容而停止。',
    impact: '当前步骤没有继续；已经保存的评论、检查点和历史线索会保留。',
    nextStep: '回到任务对应的小红书搜索结果页，确认页面已正常加载，再点击“继续上次任务”。',
  },
  PAGE_BLOCKED: {
    title: '小红书需要你先处理页面提示',
    whatHappened: '页面出现登录、安全验证或平台限制，插件无法安全地继续。',
    impact: '任务已暂停，已保存的评论和线索会保留；插件不会自动绕过验证。',
    nextStep: '请在小红书页面手动完成登录或验证，确认页面恢复正常后再继续。',
  },
  PAGE_UNREACHABLE: {
    title: '网页暂时没有响应',
    whatHappened: '插件在等待页面或读取内容时没有及时得到回应。',
    impact: '当前步骤没有完成；此前已保存的数据仍然保留。',
    nextStep: '检查网络，等待页面加载稳定；如果需要读取正文，请把相关标签页切到前台后重试。',
  },
  PARSE_FAILED: {
    title: '没能完整读取页面内容',
    whatHappened: '评论列表或笔记结构没有按预期加载，插件无法确认本次读取是否完整。',
    impact: '本次采集或分析可能未完成；已经保存的评论和线索会保留，未确认完整的内容不会被当作完整结果。',
    nextStep: '等待页面内容加载后继续。如果反复出现，请展开下方“技术详情”并把信息发来。',
  },
  SNAPSHOT_EXPIRED: {
    title: '评论列表刚刚发生了变化',
    whatHappened: '页面刷新或更新后，上一份临时读取记录已不能安全复用。',
    impact: '插件会停止使用过期记录；已经写入本地的评论和线索仍然保留。',
    nextStep: '保持目标笔记打开，重新继续采集；插件会重新读取当前页面。',
  },
  LOCK_HELD: {
    title: '另一个任务还在处理',
    whatHappened: '为了避免两个任务同时操作同一个页面或覆盖结果，插件暂时拒绝了这次操作。',
    impact: '这次新操作尚未开始，已有任务进度和历史线索不会被删除。',
    nextStep: '等几秒后重试；如果旧任务已暂停，可以选择继续旧任务或开始新任务。',
  },
  AI_AUTH: {
    title: 'AI 服务授权失败',
    whatHappened: 'AI 服务没有接受当前密钥或模型权限。',
    impact: '本次 AI 分析没有完成；已采集的评论和之前保存的分析结果会保留。',
    nextStep: '打开设置，检查 API Key 是否正确、是否仍有效，以及当前模型是否有调用权限。',
  },
  AI_RATE_LIMIT: {
    title: 'AI 服务暂时繁忙或达到调用限制',
    whatHappened: '服务商暂时限制了请求频率或可用额度。',
    impact: '本次分析可能未完成；已采集评论和已有结果会保留。',
    nextStep: '稍等一会儿再重试，避免连续重复点击。',
  },
  AI_TIMEOUT: {
    title: 'AI 服务连接失败或响应超时',
    whatHappened: '插件没有及时收到 AI 服务的有效回复。',
    impact: '本次分析没有确认完成；已采集评论和已保存结果会保留。',
    nextStep: '检查网络、服务商状态和模型设置，稍后再重试。',
  },
  AI_INVALID_OUTPUT: {
    title: 'AI 返回的内容无法使用',
    whatHappened: '模型返回了空内容，或返回格式不符合插件要求。',
    impact: '相关批次的分析可能未完成；已采集评论和其他已保存结果会保留。',
    nextStep: '重试失败的分析；若持续发生，请检查模型配置并提供下方技术详情。',
  },
  AI_PAYLOAD_TOO_LARGE: {
    title: '发给 AI 的内容太多了',
    whatHappened: '当前分析批次超过了模型服务允许的输入大小。',
    impact: '当前批次没有完成分析；已采集的评论不会因此被删除。',
    nextStep: '缩小分析批次后重试，避免重复采集已经保存的评论。',
  },
  CANCELLED: {
    title: '任务已暂停或取消',
    whatHappened: '当前操作被手动停止，或因为任务取消而中断。',
    impact: '已经保存的数据会保留；尚未完成的步骤不会被当作成功。',
    nextStep: '如果想继续，请确认页面正常后点击“继续上次任务”；不需要继续时可以直接开始新任务。',
  },
  STORAGE_ERROR: {
    title: '本地保存遇到问题',
    whatHappened: '插件没有成功保存本次最新进度。',
    impact: '此前已保存的历史线索不会被主动删除，但最后一步可能没有写入成功。',
    nextStep: '不要清除扩展数据。先重试；如果再次发生，请保留技术详情并联系维护者排查。',
  },
  UNKNOWN: {
    title: '这一步没有完成',
    whatHappened: '插件遇到了暂时无法自动判断原因的问题。',
    impact: '这条提示本身不会删除历史线索；当前未完成的步骤可能需要重试。',
    nextStep: '先确认页面和网络正常，再试一次。如果再次发生，请展开“技术详情”并把内容发来。',
  },
};

function knownCode(value: string | null | undefined): value is ErrorCode {
  return !!value && (ERROR_CODES as readonly string[]).includes(value);
}

function inferCode(message: string): ErrorCode | null {
  const text = message.toLowerCase();
  const explicit = ERROR_CODES.find((code) => new RegExp(`(^|[^a-z_])${code.toLowerCase()}([^a-z_]|$)`).test(text));
  if (explicit) return explicit;
  if (/api.?key|鉴权|认证失败|http\s*(401|403)|模型权限/.test(text)) return 'AI_AUTH';
  if (/429|限流|调用频率|额度/.test(text)) return 'AI_RATE_LIMIT';
  if (/413|输入大小|请求体.*过大|内容太多/.test(text)) return 'AI_PAYLOAD_TOO_LARGE';
  if (/模型|ai.?服务|ai请求|ai.*超时/.test(text)) return 'AI_TIMEOUT';
  if (/安全验证|风控|登录或验证|平台限制|验证码/.test(text)) return 'PAGE_BLOCKED';
  if (/权限|未授权|授予.*网站/.test(text)) return 'PERMISSION_DENIED';
  if (/链接格式|有效的 http|不支持的链接|请先粘贴.*链接|链接.*为空|完整.*地址/.test(text)) return 'URL_INVALID';
  if (/本机地址|内网|私有地址|回环地址/.test(text)) return 'URL_PRIVATE_BLOCKED';
  if (/无法获取页面状态|页面脚本.*失效|无法连接.*页面|receiving end does not exist/.test(text)) return 'PAGE_UNREACHABLE';
  if (/请先打开.*搜索结果|当前标签页不是|未找到评论容器|页面结构/.test(text)) return 'PAGE_UNSUPPORTED';
  if (/另一个任务|正在启动|安全收尾|已有其他.*任务|持锁/.test(text)) return 'LOCK_HELD';
  if (/页面.*对不上|搜索结果.*dom|原搜索结果|目标笔记|页面.*不一致|上下文已变化|候选帖子/.test(text)) return 'PAGE_CHANGED';
  if (/页面.*响应|页面.*超时|无法连接.*页面|未能及时/.test(text)) return 'PAGE_UNREACHABLE';
  if (/failed to fetch|networkerror|连接失败|请求超时|网络错误/.test(text)) return 'PAGE_UNREACHABLE';
  if (/存储|保存.*失败|本地.*写入/.test(text)) return 'STORAGE_ERROR';
  if (/取消|停止|暂停/.test(text)) return 'CANCELLED';
  if (/评论|采集|解析|页面结构|列表.*加载/.test(text)) return 'PARSE_FAILED';
  if (/http\s*\d{3}|failed|exception|undefined|null reference/.test(text)) return 'UNKNOWN';
  return null;
}

function redactDetails(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[已隐藏的密钥]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[已隐藏]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*)[^\s,;&]+/gi, '$1[已隐藏]')
    .replace(/(cookie\s*[:=]\s*)[^\r\n]+/gi, '$1[已隐藏]')
    .slice(0, 600);
}

export function explainError(message: string, code?: string | null): ErrorExplanation {
  const resolvedCode = knownCode(code) ? code : inferCode(message);
  const copy = resolvedCode ? COPY[resolvedCode] : COPY.UNKNOWN;
  return {
    code: resolvedCode,
    ...copy,
    technicalDetails: redactDetails(message.trim()),
  };
}
