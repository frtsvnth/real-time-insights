import { useSessionStore } from '../store/session';

const formatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function CostMeter() {
  const costRub = useSessionStore((s) => s.costRub);

  return (
    <div className="cost-meter" title="Стоимость Whisper + LLM за сессию (по курсу из конфига сервера)">
      {formatter.format(costRub)}
    </div>
  );
}
