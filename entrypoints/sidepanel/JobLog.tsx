import { useEffect, useRef, useState } from 'react';
import {
  isLogPanelEnabled, subscribeJobLog, watchLogPanelEnabled, type JobLogEvent,
} from '../../src/ui/joblog';

const MAX_LINES = 200;

export default function JobLogPanel({ jobId }: { jobId: string | null }) {
  const [enabled, setEnabled] = useState(false);
  const [lines, setLines] = useState<JobLogEvent[]>([]);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void isLogPanelEnabled().then(setEnabled);
    return watchLogPanelEnabled(setEnabled);
  }, []);

  useEffect(() => {
    if (!enabled) { setLines([]); return undefined; }
    return subscribeJobLog((e) => {
      if (jobId && e.jobId !== jobId) return;
      setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), e]);
    });
  }, [enabled, jobId]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!enabled) return null;
  return (
    <details open style={{ fontSize: 12 }}>
      <summary>任务日志（在设置页可关闭；只记录步骤与错误码，不含评论正文和 Key）</summary>
      <pre
        ref={boxRef}
        style={{
          maxHeight: 180, overflow: 'auto', margin: 0, padding: 8,
          background: '#1e1e1e', color: '#ddd', fontSize: 11, whiteSpace: 'pre-wrap',
        }}
      >
        {lines.length === 0
          ? '等待后台事件…'
          : lines.map((e, i) => (
            <div key={i} style={{ color: e.level === 'error' ? '#ff7a70' : '#ddd' }}>
              {e.at.slice(11, 19)} {e.message}
            </div>
          ))}
      </pre>
    </details>
  );
}
