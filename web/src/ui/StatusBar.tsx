import { useEffect, useState } from 'react';
import { useSessionStore } from '../store/session';

function formatTimer(startedAt: number | null): string {
  if (!startedAt) return '00:00';
  const elapsed = Math.max(0, Date.now() - startedAt);
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function StatusBar() {
  const whisperStatus = useSessionStore((s) => s.whisperStatus);
  const llmStatus = useSessionStore((s) => s.llmStatus);
  const recording = useSessionStore((s) => s.recording);
  const startedAt = useSessionStore((s) => s.startedAt);
  const devMode = useSessionStore((s) => s.devMode);
  const toggleDevMode = useSessionStore((s) => s.toggleDevMode);
  const hasInsights = useSessionStore((s) => s.insightOrder.length > 0);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [recording]);

  return (
    <div className="status-bar">
      <span className="status-bar__title">Real-time Insights</span>
      <span className="status-dot-group">
        <span className={`status-dot status-dot--${whisperStatus === 'unknown' ? '' : whisperStatus}`} />
        Whisper
      </span>
      <span className="status-dot-group">
        <span className={`status-dot status-dot--${llmStatus === 'unknown' ? '' : llmStatus}`} />
        LLM
      </span>
      {recording && <span className="status-bar__timer">{formatTimer(startedAt)}</span>}
      <button
        className="dev-toggle"
        onClick={() => window.print()}
        disabled={!hasInsights}
        title={hasInsights ? 'Экспортировать инсайты в PDF' : 'Пока нет инсайтов'}
      >
        Экспорт PDF
      </button>
      <button className="dev-toggle" onClick={toggleDevMode}>
        {devMode ? 'dev: вкл' : 'dev'}
      </button>
    </div>
  );
}
