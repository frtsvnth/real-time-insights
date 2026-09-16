import { useSessionStore } from '../store/session';
import { TYPE_LABELS } from './insightLabels';

/**
 * Скрытый на экране блок, который становится видимым только в @media print
 * (styles.css) — это и есть источник PDF: браузерный "Печать → Сохранить как PDF"
 * не требует никаких доп. библиотек и работает одинаково на десктопе и мобиле.
 */
export function PrintExport() {
  const insights = useSessionStore((s) => s.insights);
  const insightOrder = useSessionStore((s) => s.insightOrder);

  const cards = insightOrder.map((id) => insights[id]).filter((insight): insight is NonNullable<typeof insight> => Boolean(insight));

  return (
    <div className="print-view">
      <div className="print-view__header">
        <div className="print-view__title">Real-time Insights</div>
        <div className="print-view__meta">{new Date().toLocaleString('ru-RU')}</div>
      </div>
      {cards.length === 0 ? (
        <div className="print-view__empty">Инсайтов пока нет.</div>
      ) : (
        <div className="print-view__grid">
          {cards.map((insight) => (
            <div key={insight.id} className="print-card">
              <div className="print-card__type">{TYPE_LABELS[insight.type] ?? insight.type}</div>
              <div className="print-card__title">{insight.title}</div>
              <div className="print-card__body">{insight.body}</div>
              {insight.openSlots.length > 0 && (
                <div className="print-card__slots">Не хватает: {insight.openSlots.join(', ')}</div>
              )}
              {insight.speakers.length > 0 && <div className="print-card__speaker">{insight.speakers.join(', ')}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
