import { z } from 'zod';

const InsightSchema = z.object({
  id: z.string(),
  type: z.enum(['fact', 'question', 'qa', 'preference', 'decision']),
  title: z.string(),
  body: z.string(),
  status: z.enum(['candidate', 'confirmed', 'updated']),
  speakers: z.array(z.string()),
  openSlots: z.array(z.string()),
  evidence: z.array(z.object({ quote: z.string(), utteranceId: z.string(), t: z.number() })),
  confidence: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  position: z.object({ x: z.number(), y: z.number() }),
});
export type Insight = z.infer<typeof InsightSchema>;

const UtteranceSchema = z.object({
  id: z.string(),
  tStart: z.number(),
  tEnd: z.number(),
  speaker: z.string(),
  text: z.string(),
  isFinal: z.boolean(),
});
export type Utterance = z.infer<typeof UtteranceSchema>;

const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stt_interim'), text: z.string(), utteranceId: z.string() }),
  z.object({ type: z.literal('stt_final'), utterance: UtteranceSchema }),
  z.object({
    type: z.literal('insight_event'),
    op: z.enum(['create', 'update', 'answer', 'merge', 'discard']),
    insight: InsightSchema,
    previousInsight: InsightSchema.optional(),
  }),
  z.object({
    type: z.literal('status'),
    whisper: z.enum(['ok', 'down', 'unknown']),
    llm: z.enum(['ok', 'down', 'unknown']),
    recording: z.boolean(),
  }),
  z.object({ type: z.literal('cost_update'), totalRub: z.number() }),
  z.object({ type: z.literal('speaker_renamed'), from: z.string(), to: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// В dev-режиме Vite проксирует /ws на сервер — origin можно не задавать.
// В Docker-сборке фронт раздаётся отдельным статик-сервером без прокси,
// поэтому там нужен явный VITE_API_BASE_URL (см. .env.example / docker-compose.yml).
function getWsOrigin(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const origin = configured || location.origin;
  return origin.replace(/^http/, 'ws');
}

export class SessionSocket {
  private ws: WebSocket | null = null;

  connect(sessionId: string, onMessage: (msg: ServerMessage) => void, onOpen?: () => void, onClose?: () => void): void {
    const ws = new WebSocket(`${getWsOrigin()}/ws/session/${sessionId}`);
    ws.onopen = () => onOpen?.();
    ws.onclose = () => onClose?.();
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let json: unknown;
      try {
        json = JSON.parse(event.data);
      } catch {
        console.error('Сервер прислал не-JSON текстовое сообщение');
        return;
      }
      const result = ServerMessageSchema.safeParse(json);
      if (!result.success) {
        console.error('Сообщение сервера не прошло валидацию', result.error);
        return;
      }
      onMessage(result.data);
    };
    this.ws = ws;
  }

  private sendJson(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk);
  }

  startSession(): void {
    this.sendJson({ type: 'session_start' });
  }

  stopSession(): void {
    this.sendJson({ type: 'session_stop' });
  }

  renameSpeaker(from: string, to: string): void {
    this.sendJson({ type: 'rename_speaker', from, to });
  }

  pinInsight(insightId: string): void {
    this.sendJson({ type: 'pin_insight', insightId });
  }

  hideInsight(insightId: string): void {
    this.sendJson({ type: 'hide_insight', insightId });
  }

  simulateUtterance(text: string, speaker?: string): void {
    this.sendJson({ type: 'simulate_utterance', text, speaker });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
