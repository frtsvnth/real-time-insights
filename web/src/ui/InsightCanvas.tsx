import { useSessionStore } from '../store/session';
import { InsightCloud } from './InsightCloud';

export function InsightCanvas() {
  const insights = useSessionStore((s) => s.insights);
  const insightOrder = useSessionStore((s) => s.insightOrder);
  const recording = useSessionStore((s) => s.recording);

  const hasInsights = insightOrder.length > 0;

  return (
    <div className="insight-canvas">
      {!recording && !hasInsights && (
        <div className="empty-state">Нажми запись и говори. Мы соберём мысли в облака.</div>
      )}
      {insightOrder.map((id) => {
        const insight = insights[id];
        if (!insight) return null;
        return <InsightCloud key={id} insight={insight} />;
      })}
    </div>
  );
}
