import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { SessionStore } from '../session/SessionStore.js';
import { renameSpeakerInSession } from '../session/SessionStore.js';
import type { SttProvider, SttEvent } from '../stt/SttProvider.js';
import { InsightEngine } from '../insights/InsightEngine.js';
import { ClientMessageSchema, type ServerMessage, type Utterance } from '../insights/types.js';
import { config } from '../config.js';

const STATUS_POLL_MS = 20000;
// Пауза длиннее этой — повод предположить смену говорящего (грубая эвристика, не диаризация).
const SPEAKER_SWITCH_PAUSE_MS = 4000;

interface SpeakerHeuristicState {
  lastEndMs: number | null;
  currentSpeaker: string;
}

function nextSpeaker(state: SpeakerHeuristicState, tStart: number): string {
  if (state.lastEndMs !== null && tStart - state.lastEndMs > SPEAKER_SWITCH_PAUSE_MS) {
    state.currentSpeaker = state.currentSpeaker === 'Speaker 1' ? 'Speaker 2' : 'Speaker 1';
  }
  return state.currentSpeaker;
}

export function registerSessionSocket(app: FastifyInstance, sessionStore: SessionStore, sttProvider: SttProvider): void {
  app.get<{ Params: { id: string } }>('/ws/session/:id', { websocket: true }, (socket: WebSocket, request) => {
    const sessionId = request.params.id;
    const session = sessionStore.getOrCreate(sessionId);

    let recording = false;
    let whisperStatus: 'ok' | 'down' | 'unknown' = 'unknown';
    let llmStatus: 'ok' | 'down' | 'unknown' = 'unknown';
    let totalCostUsd = 0;
    const speakerState: SpeakerHeuristicState = { lastEndMs: null, currentSpeaker: 'Speaker 1' };

    const send = (message: ServerMessage): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    const broadcastStatus = (): void => {
      send({ type: 'status', whisper: whisperStatus, llm: llmStatus, recording });
    };

    const addCost = (usd: number): void => {
      totalCostUsd += usd;
      send({ type: 'cost_update', totalRub: totalCostUsd * config.USD_TO_RUB_RATE });
    };

    const insightEngine = new InsightEngine(
      session,
      (event) => {
        if (event.op === 'rename_speaker') {
          if (speakerState.currentSpeaker === event.from) speakerState.currentSpeaker = event.to;
          send({ type: 'speaker_renamed', from: event.from, to: event.to });
          return;
        }
        send({ type: 'insight_event', op: event.op, insight: event.insight, previousInsight: event.previousInsight });
      },
      undefined,
      (ok) => {
        llmStatus = ok ? 'ok' : 'down';
        broadcastStatus();
      },
      addCost,
    );

    const onSttEvent = (event: SttEvent): void => {
      if (event.type === 'health') {
        const next = event.ok ? 'ok' : 'down';
        if (next !== whisperStatus) {
          whisperStatus = next;
          broadcastStatus();
        }
        return;
      }

      if (event.type === 'cost') {
        addCost(event.usd);
        return;
      }

      if (event.type === 'interim') {
        send({ type: 'stt_interim', text: event.text, utteranceId: event.utteranceId });
        return;
      }

      const speaker = nextSpeaker(speakerState, event.tStart);
      speakerState.lastEndMs = event.tEnd;

      const utterance: Utterance = {
        id: event.utteranceId,
        tStart: event.tStart,
        tEnd: event.tEnd,
        speaker,
        text: event.text,
        isFinal: true,
      };
      sessionStore.addUtterance(session, utterance);
      send({ type: 'stt_final', utterance });
      insightEngine.notifyFinalUtterance();
    };

    addCost(0); // сразу показать ₽0.00 на счётчике, не дожидаясь первого реального вызова

    // Пока идёт запись, статус Whisper точнее берётся из реальных вызовов transcribe
    // (событие 'health' от провайдера) — отдельный /health на занятом однопоточном
    // self-hosted Whisper часто просто не отвечает, пока тот занят распознаванием,
    // и полинг даёт ложное "down". В простое /health бьём как обычно.
    const statusPoll = setInterval(() => {
      if (recording) return;
      sttProvider
        .healthCheck()
        .then((ok) => {
          whisperStatus = ok ? 'ok' : 'down';
          broadcastStatus();
        })
        .catch(() => undefined);
    }, STATUS_POLL_MS);

    sttProvider
      .healthCheck()
      .then((ok) => {
        whisperStatus = ok ? 'ok' : 'down';
        broadcastStatus();
      })
      .catch(() => undefined);

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (recording) sttProvider.pushAudio(sessionId, raw, Date.now());
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf-8'));
      } catch {
        send({ type: 'error', message: 'Некорректный JSON' });
        return;
      }

      const result = ClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        send({ type: 'error', message: 'Неизвестное сообщение' });
        return;
      }

      const message = result.data;
      switch (message.type) {
        case 'session_start': {
          sttProvider
            .healthCheck()
            .then(async (ok) => {
              whisperStatus = ok ? 'ok' : 'down';
              if (!ok) {
                send({ type: 'error', message: 'Whisper недоступен, запись не запущена' });
                broadcastStatus();
                return;
              }
              await sttProvider.start(sessionId, onSttEvent);
              recording = true;
              session.status = 'recording';
              session.startedAt = Date.now();
              broadcastStatus();
            })
            .catch(() => {
              whisperStatus = 'down';
              send({ type: 'error', message: 'Whisper недоступен, запись не запущена' });
              broadcastStatus();
            });
          break;
        }
        case 'session_stop': {
          recording = false;
          session.status = 'idle';
          void sttProvider.stop(sessionId);
          broadcastStatus();
          break;
        }
        case 'rename_speaker': {
          const { from, to } = message;
          renameSpeakerInSession(session, from, to);
          if (speakerState.currentSpeaker === from) speakerState.currentSpeaker = to;
          send({ type: 'speaker_renamed', from, to });
          break;
        }
        case 'hide_insight': {
          session.insights = session.insights.filter((i) => i.id !== message.insightId);
          break;
        }
        case 'pin_insight': {
          // Позиция и закрепление карточек — состояние фронта; сервер только валидирует id.
          break;
        }
        case 'simulate_utterance': {
          // Dev-режим: подать реплику текстом в обход микрофона/Whisper.
          const now = Date.now();
          const speaker = message.speaker ?? nextSpeaker(speakerState, now);
          speakerState.lastEndMs = now;
          const utterance: Utterance = {
            id: randomUUID(),
            tStart: now,
            tEnd: now,
            speaker,
            text: message.text,
            isFinal: true,
          };
          sessionStore.addUtterance(session, utterance);
          send({ type: 'stt_final', utterance });
          insightEngine.notifyFinalUtterance();
          break;
        }
      }
    });

    socket.on('close', () => {
      clearInterval(statusPoll);
      insightEngine.dispose();
      if (recording) void sttProvider.stop(sessionId);
    });
  });
}
