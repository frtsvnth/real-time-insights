import { useEffect, useRef, useState } from 'react';
import { useSessionStore, type ClientInsight } from '../store/session';
import { TYPE_LABELS } from './insightLabels';

interface DragState {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

export function InsightCloud({ insight }: { insight: ClientInsight }) {
  const moveInsight = useSessionStore((s) => s.moveInsight);
  const hideInsight = useSessionStore((s) => s.hideInsight);
  const renameSpeaker = useSessionStore((s) => s.renameSpeaker);

  const [expanded, setExpanded] = useState(false);
  const [settled, setSettled] = useState(insight.status !== 'candidate');
  const [pulsing, setPulsing] = useState(false);
  const prevUpdatedAt = useRef(insight.updatedAt);
  const dragRef = useRef<DragState | null>(null);

  // Кандидат становится визуально "подтверждённым" через 4-6с, если его не discard-нули.
  useEffect(() => {
    if (insight.status !== 'candidate') {
      setSettled(true);
      return;
    }
    const timer = setTimeout(() => setSettled(true), 5000);
    return () => clearTimeout(timer);
  }, [insight.status]);

  useEffect(() => {
    if (insight.updatedAt !== prevUpdatedAt.current) {
      prevUpdatedAt.current = insight.updatedAt;
      setPulsing(true);
      const timer = setTimeout(() => setPulsing(false), 500);
      return () => clearTimeout(timer);
    }
  }, [insight.updatedAt]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Не перехватываем указатель, если жмут по своей интерактивной зоне (имя спикера,
    // кнопка скрытия) — иначе setPointerCapture на карточке ворует у них клик, и их
    // собственный onClick никогда не срабатывает (в реальном браузере, не только в тестах).
    const target = e.target as HTMLElement;
    if (target.closest('.insight-cloud__hide, .insight-cloud__speaker span')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: insight.position.x, originY: insight.position.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    moveInsight(insight.id, drag.originX + dx, drag.originY + dy);
  };

  const onPointerUp = () => {
    if (dragRef.current && !dragRef.current.moved) setExpanded((v) => !v);
    dragRef.current = null;
  };

  const classNames = [
    'insight-cloud',
    `insight-cloud--${insight.type}`,
    !settled ? 'insight-cloud--candidate' : '',
    pulsing ? 'insight-cloud--pulse' : '',
    insight.removing ? 'insight-cloud--removing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classNames}
      style={{ left: insight.position.x, top: insight.position.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <button
        className="insight-cloud__hide"
        onClick={(e) => {
          e.stopPropagation();
          hideInsight(insight.id);
        }}
        title="Скрыть"
      >
        ×
      </button>
      <div className="insight-cloud__type">{TYPE_LABELS[insight.type] ?? insight.type}</div>
      <div className="insight-cloud__title">{insight.title}</div>
      <div className="insight-cloud__body">{insight.body}</div>
      {insight.openSlots.length > 0 && <div className="insight-cloud__slots">Не хватает: {insight.openSlots.join(', ')}</div>}
      {insight.speakers.length > 0 && (
        <div className="insight-cloud__speaker">
          {insight.speakers.map((speaker) => (
            <span
              key={speaker}
              onClick={(e) => {
                e.stopPropagation();
                const next = window.prompt('Новое имя спикера', speaker);
                if (next && next.trim() && next !== speaker) renameSpeaker(speaker, next.trim());
              }}
              style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
            >
              {speaker}
            </span>
          ))}
        </div>
      )}
      {expanded && insight.evidence.length > 0 && (
        <div className="insight-cloud__evidence">
          {insight.evidence.slice(-3).map((ev, i) => (
            <div key={`${ev.utteranceId}-${i}`}>«{ev.quote}»</div>
          ))}
        </div>
      )}
    </div>
  );
}
