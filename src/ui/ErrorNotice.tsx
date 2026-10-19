import { explainError } from './error-copy';

export default function ErrorNotice({ message, code, tone = 'error' }: {
  message: string | null | undefined;
  code?: string | null;
  tone?: 'error' | 'warning';
}) {
  if (!message?.trim()) return null;
  const info = explainError(message, code);
  const accent = tone === 'warning' ? '#8a5a00' : '#a12622';
  const border = tone === 'warning' ? '#e6c77a' : '#e5a5a2';
  const background = tone === 'warning' ? '#fff9e8' : '#fff5f4';

  return (
    <div role={tone === 'warning' ? 'status' : 'alert'} aria-live="polite" style={{
      border: `1px solid ${border}`, borderRadius: 6, padding: 10,
      background, color: '#242424', fontSize: 12, lineHeight: 1.5,
    }}>
      <strong style={{ color: accent, fontSize: 13 }}>{info.title}</strong>
      <p style={{ margin: '5px 0' }}>{info.whatHappened}</p>
      <p style={{ margin: '5px 0' }}><b>当前影响：</b>{info.impact}</p>
      <p style={{ margin: '5px 0' }}><b>建议操作：</b>{info.nextStep}</p>
      <details style={{ marginTop: 6, color: '#666' }}>
        <summary style={{ cursor: 'pointer' }}>技术详情（排查时再展开）</summary>
        {info.code && <p style={{ margin: '4px 0' }}>错误代码：{info.code}</p>}
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '4px 0', maxHeight: 180, overflow: 'auto' }}>
          {info.technicalDetails || '没有额外技术信息。'}
        </pre>
      </details>
    </div>
  );
}
