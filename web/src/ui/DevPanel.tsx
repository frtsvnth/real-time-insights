import { useState } from 'react';
import { useSessionStore } from '../store/session';

const SCENARIO_A = ['А какая погода будет завтра на улице?', 'Ну короче, не знаю, подожди', 'Завтра на улице будет 17 градусов'];
const SCENARIO_B = ['Я очень люблю собак', 'Лучшие собаки — это доберманы', 'У меня, кстати, есть доберман'];
const SCENARIO_C = ['ну', 'короче', 'подожди', 'ха-ха-ха'];

async function playScenario(lines: string[], speaker: string, send: (text: string, speaker?: string) => void) {
  for (const line of lines) {
    send(line, speaker);
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
}

export function DevPanel() {
  const devMode = useSessionStore((s) => s.devMode);
  const simulateUtterance = useSessionStore((s) => s.simulateUtterance);
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState('Speaker 1');

  if (!devMode) return null;

  return (
    <div className="dev-panel">
      <div className="dev-panel__title">Симулятор реплик (без микрофона)</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Текст реплики..." />
      <select value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
        <option>Speaker 1</option>
        <option>Speaker 2</option>
      </select>
      <button
        onClick={() => {
          if (!text.trim()) return;
          simulateUtterance(text.trim(), speaker);
          setText('');
        }}
      >
        Отправить как final
      </button>
      <div className="dev-panel__title">Фикстуры для приёмки</div>
      <button onClick={() => void playScenario(SCENARIO_A, 'Speaker 1', simulateUtterance)}>Сценарий A — погода</button>
      <button onClick={() => void playScenario(SCENARIO_B, 'Speaker 1', simulateUtterance)}>Сценарий B — собаки</button>
      <button onClick={() => void playScenario(SCENARIO_C, 'Speaker 1', simulateUtterance)}>Сценарий C — шум</button>
    </div>
  );
}
