export type SttEvent =
  | { type: 'interim'; utteranceId: string; text: string }
  | { type: 'final'; utteranceId: string; text: string; tStart: number; tEnd: number }
  // Сигнал живости, выведенный из реальных вызовов Whisper, а не из отдельного /health.
  // Однопоточные self-hosted инстансы часто не отвечают на /health, пока заняты
  // транскрипцией — поэтому во время записи статус берём отсюда, а не из healthCheck().
  | { type: 'health'; ok: boolean }
  // Стоимость одного вызова Whisper в USD (0, если провайдер не отдаёт usage.cost —
  // так и есть для self-hosted). Считается за каждый вызов, даже если результат
  // потом отбросили как галлюцинацию — деньги за сам запрос уже потрачены.
  | { type: 'cost'; usd: number };

export interface SttProvider {
  start(sessionId: string, onEvent: (e: SttEvent) => void): Promise<void>;
  pushAudio(sessionId: string, pcm16kMono: Buffer, timestampMs: number): void;
  stop(sessionId: string): Promise<void>;
  /** Мягкая проверка доступности STT-бэкенда (используется для статус-бара). */
  healthCheck(): Promise<boolean>;
}
