import { create } from 'zustand';
import { SessionSocket, type Insight, type ServerMessage } from '../ws/client';
import { startMicCapture, type MicCapture } from '../audio/capture';

export interface ClientInsight extends Insight {
  /** true, если пользователь сам перетащил карточку — авторазмещение больше не трогает позицию */
  userMoved?: boolean;
  /** карточка уходит с экрана (discard/merge) — рендерится с анимацией схлопывания перед удалением */
  removing?: boolean;
}

const REMOVE_ANIMATION_MS = 260;

export interface TranscriptLine {
  id: string;
  text: string;
  isFinal: boolean;
}

const MAX_TRANSCRIPT_LINES = 5;

// Примерное "личное пространство" карточки (ширина ~220px + запас), чтобы новые карточки
// не наезжали на уже стоящие — иначе перекрывшиеся карточки становится невозможно
// ни прочитать, ни кликнуть (клик по нижней всегда попадает в верхнюю).
const CARD_MIN_DISTANCE = 320;

function computeSpiralPosition(index: number, existing: { x: number; y: number }[] = []): { x: number; y: number } {
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2 - 40;
  const jitter = () => (Math.random() - 0.5) * 24;

  for (let attempt = index; attempt < index + 200; attempt++) {
    if (attempt === 0 && existing.length === 0) return { x: centerX, y: centerY };
    const angle = attempt * 2.399963; // золотой угол — карточки не выстраиваются в лучи
    const radius = 70 + attempt * 34;
    const candidate = { x: centerX + Math.cos(angle) * radius + jitter(), y: centerY + Math.sin(angle) * radius + jitter() };
    const overlaps = existing.some((p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < CARD_MIN_DISTANCE);
    if (!overlaps) return candidate;
  }
  // Не нашли свободное место за 200 попыток (очень много карточек) — отдаём последний вариант,
  // лучше немного наложится, чем зациклиться.
  const angle = (index + 199) * 2.399963;
  const radius = 70 + (index + 199) * 34;
  return { x: centerX + Math.cos(angle) * radius + jitter(), y: centerY + Math.sin(angle) * radius + jitter() };
}

interface SessionState {
  sessionId: string;
  connected: boolean;
  whisperStatus: 'ok' | 'down' | 'unknown';
  llmStatus: 'ok' | 'down' | 'unknown';
  costRub: number;
  recording: boolean;
  paused: boolean;
  micLevel: number;
  startedAt: number | null;
  transcript: TranscriptLine[];
  insights: Record<string, ClientInsight>;
  insightOrder: string[];
  error: string | null;
  devMode: boolean;

  connect: () => void;
  toggleRecording: () => Promise<void>;
  togglePause: () => void;
  renameSpeaker: (from: string, to: string) => void;
  hideInsight: (insightId: string) => void;
  moveInsight: (insightId: string, x: number, y: number) => void;
  simulateUtterance: (text: string, speaker?: string) => void;
  toggleDevMode: () => void;
  dismissError: () => void;
}

const socket = new SessionSocket();
let micCapture: MicCapture | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: crypto.randomUUID(),
  connected: false,
  whisperStatus: 'unknown',
  llmStatus: 'unknown',
  costRub: 0,
  recording: false,
  paused: false,
  micLevel: 0,
  startedAt: null,
  transcript: [],
  insights: {},
  insightOrder: [],
  error: null,
  devMode: false,

  connect: () => {
    const { sessionId } = get();
    socket.connect(
      sessionId,
      (msg) => handleServerMessage(msg, set, get),
      () => set({ connected: true }),
      () => set({ connected: false }),
    );
  },

  toggleRecording: async () => {
    const { recording, whisperStatus } = get();
    if (recording) {
      micCapture?.stop();
      micCapture = null;
      socket.stopSession();
      set({ recording: false, paused: false, micLevel: 0 });
      return;
    }

    if (whisperStatus === 'down') {
      set({ error: 'Whisper недоступен — запись не запущена' });
      return;
    }

    try {
      micCapture = await startMicCapture(
        (chunk) => socket.sendAudio(chunk),
        (level) => set({ micLevel: level }),
      );
      socket.startSession();
      set({ recording: true, paused: false, startedAt: Date.now(), error: null });
    } catch {
      set({ error: 'Не удалось получить доступ к микрофону' });
    }
  },

  togglePause: () => {
    const { paused, recording } = get();
    if (!recording || !micCapture) return;
    if (paused) {
      micCapture.resume();
      set({ paused: false });
    } else {
      micCapture.pause();
      set({ paused: true, micLevel: 0 });
    }
  },

  renameSpeaker: (from, to) => socket.renameSpeaker(from, to),

  hideInsight: (insightId) => {
    socket.hideInsight(insightId);
    set((state) => {
      const insights = { ...state.insights };
      delete insights[insightId];
      return { insights, insightOrder: state.insightOrder.filter((id) => id !== insightId) };
    });
  },

  moveInsight: (insightId, x, y) => {
    set((state) => {
      const existing = state.insights[insightId];
      if (!existing) return state;
      return {
        insights: { ...state.insights, [insightId]: { ...existing, position: { x, y }, userMoved: true } },
      };
    });
  },

  simulateUtterance: (text, speaker) => socket.simulateUtterance(text, speaker),

  toggleDevMode: () => set((state) => ({ devMode: !state.devMode })),

  dismissError: () => set({ error: null }),
}));

function handleServerMessage(
  msg: ServerMessage,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
): void {
  switch (msg.type) {
    case 'status': {
      set({ whisperStatus: msg.whisper, llmStatus: msg.llm, recording: msg.recording });
      break;
    }
    case 'stt_interim': {
      set((state) => ({
        transcript: appendTranscriptLine(state.transcript, { id: msg.utteranceId, text: msg.text, isFinal: false }),
      }));
      break;
    }
    case 'stt_final': {
      set((state) => ({
        transcript: appendTranscriptLine(state.transcript, {
          id: msg.utterance.id,
          text: msg.utterance.text,
          isFinal: true,
        }),
      }));
      break;
    }
    case 'insight_event': {
      applyInsightEvent(msg, set, get);
      break;
    }
    case 'cost_update': {
      set({ costRub: msg.totalRub });
      break;
    }
    case 'speaker_renamed': {
      set((state) => {
        const insights = { ...state.insights };
        for (const id of Object.keys(insights)) {
          const insight = insights[id];
          if (insight.speakers.includes(msg.from)) {
            insights[id] = { ...insight, speakers: insight.speakers.map((s) => (s === msg.from ? msg.to : s)) };
          }
        }
        return { insights };
      });
      break;
    }
    case 'error': {
      set({ error: msg.message });
      break;
    }
  }
}

function scheduleRemoval(
  insightId: string,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void,
): void {
  setTimeout(() => {
    set((s) => {
      const insights = { ...s.insights };
      delete insights[insightId];
      return { insights, insightOrder: s.insightOrder.filter((id) => id !== insightId) };
    });
  }, REMOVE_ANIMATION_MS);
}

function appendTranscriptLine(lines: TranscriptLine[], next: TranscriptLine): TranscriptLine[] {
  const withoutSameId = lines.filter((l) => l.id !== next.id);
  const updated = [...withoutSameId, next];
  return updated.slice(-MAX_TRANSCRIPT_LINES);
}

function existingPositions(state: SessionState): { x: number; y: number }[] {
  return state.insightOrder.map((id) => state.insights[id]?.position).filter((p): p is { x: number; y: number } => Boolean(p));
}

function applyInsightEvent(
  msg: Extract<ServerMessage, { type: 'insight_event' }>,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
): void {
  const { insight, previousInsight, op } = msg;
  const state = get();

  if (op === 'discard') {
    const existing = state.insights[insight.id];
    if (!existing) return;
    set({ insights: { ...state.insights, [insight.id]: { ...existing, removing: true } } });
    scheduleRemoval(insight.id, set);
    return;
  }

  if (op === 'merge' && previousInsight) {
    const existingTarget = state.insights[insight.id];
    const existingSource = state.insights[previousInsight.id];
    const insights = { ...state.insights };
    insights[insight.id] = {
      ...insight,
      position: existingTarget?.position ?? computeSpiralPosition(state.insightOrder.length, existingPositions(state)),
    };
    if (existingSource) insights[previousInsight.id] = { ...existingSource, removing: true };
    set({ insights });
    scheduleRemoval(previousInsight.id, set);
    return;
  }

  const existing = state.insights[insight.id];
  if (existing) {
    set({
      insights: {
        ...state.insights,
        [insight.id]: { ...insight, position: existing.position, userMoved: existing.userMoved },
      },
    });
    return;
  }

  // Новая карточка (create, либо update/answer на неизвестный клиенту id) — назначаем позицию.
  const position = computeSpiralPosition(state.insightOrder.length, existingPositions(state));
  set({
    insights: { ...state.insights, [insight.id]: { ...insight, position } },
    insightOrder: [...state.insightOrder, insight.id],
  });
}
