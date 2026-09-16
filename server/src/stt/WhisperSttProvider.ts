import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { pcm16ToWav } from '../audio/wav.js';
import { RmsVad } from '../audio/vad.js';
import { hasSpeech } from '../audio/sileroVad.js';
import { InterimScheduler, stitchText, isLikelyHallucination } from './windowing.js';
import type { SttEvent, SttProvider } from './SttProvider.js';

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
// Небольшой запас тишины после последней речи, чтобы не резать слово по живому,
// но не отправлять в Whisper всю паузу VAD (600-900мс) целиком — это провоцирует галлюцинации.
const SILENCE_TAIL_PAD_MS = 200;

interface SessionState {
  onEvent: (e: SttEvent) => void;
  vad: RmsVad;
  scheduler: InterimScheduler;
  buffer: Buffer;
  utteranceStartMs: number;
  utteranceId: string;
  utteranceOpen: boolean;
  interimText: string;
  lastSpeechAtMs: number;
  /** Мьютекс: не даёт запросам к Whisper для одной сессии идти параллельно/не по порядку. */
  queue: Promise<void>;
}

function msToBytes(ms: number): number {
  return Math.max(0, Math.round((ms / 1000) * SAMPLE_RATE) * BYTES_PER_SAMPLE);
}

function clampByte(byteOffset: number, max: number): number {
  return Math.max(0, Math.min(byteOffset, max));
}

/** Silero VAD как гейт перед Whisper. Если сама VAD сломалась — не блокируем пайплайн. */
async function silenceGateOpen(pcm: Buffer): Promise<boolean> {
  try {
    return await hasSpeech(pcm);
  } catch {
    return true;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractText(json: unknown): string {
  if (typeof json === 'string') return json;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    for (const key of ['text', 'transcription', 'transcript', 'result']) {
      const value = obj[key];
      if (typeof value === 'string') return value;
    }
  }
  return '';
}

/** Некоторые облачные провайдеры (routerai и т.п.) отдают usage.cost в USD прямо в ответе. */
function extractCostUsd(json: unknown): number {
  if (json && typeof json === 'object') {
    const usage = (json as Record<string, unknown>).usage;
    if (usage && typeof usage === 'object') {
      const cost = (usage as Record<string, unknown>).cost;
      if (typeof cost === 'number') return cost;
    }
  }
  return 0;
}

function deriveHealthUrl(base: string): string {
  try {
    const u = new URL(base);
    u.pathname = '/health';
    u.search = '';
    return u.toString();
  } catch {
    return base;
  }
}

export class WhisperSttProvider implements SttProvider {
  private sessions = new Map<string, SessionState>();

  async start(sessionId: string, onEvent: (e: SttEvent) => void): Promise<void> {
    this.sessions.set(sessionId, {
      onEvent,
      vad: new RmsVad(),
      scheduler: new InterimScheduler(),
      buffer: Buffer.alloc(0),
      utteranceStartMs: 0,
      utteranceId: '',
      utteranceOpen: false,
      interimText: '',
      lastSpeechAtMs: 0,
      queue: Promise.resolve(),
    });
  }

  async stop(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    await state.queue.catch(() => {});
    this.sessions.delete(sessionId);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(deriveHealthUrl(config.WHISPER_BASE_URL), { method: 'GET' }, 5000);
      return res.status < 500;
    } catch {
      return false;
    }
  }

  pushAudio(sessionId: string, pcm16kMono: Buffer, timestampMs: number): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const vadEvent = state.vad.feed(pcm16kMono, timestampMs);

    if (vadEvent.speechStarted && !state.utteranceOpen) {
      state.utteranceOpen = true;
      state.buffer = Buffer.alloc(0);
      state.utteranceStartMs = timestampMs;
      state.utteranceId = randomUUID();
      state.scheduler.reset();
      state.interimText = '';
    }

    if (!state.utteranceOpen) return;

    state.buffer = Buffer.concat([state.buffer, pcm16kMono]);
    if (vadEvent.isSpeech) state.lastSpeechAtMs = timestampMs;

    if (vadEvent.utteranceBoundary) {
      this.enqueueFinal(state, timestampMs);
      state.utteranceOpen = false;
      return;
    }

    if (state.scheduler.shouldFire(timestampMs)) {
      const range = state.scheduler.nextWindow(timestampMs, state.utteranceStartMs);
      this.enqueueInterim(state, range);
    }
  }

  private enqueueInterim(state: SessionState, range: { startMs: number; endMs: number }): void {
    state.queue = state.queue.then(async () => {
      const startByte = clampByte(msToBytes(range.startMs - state.utteranceStartMs), state.buffer.length);
      const endByte = clampByte(msToBytes(range.endMs - state.utteranceStartMs), state.buffer.length);
      if (endByte <= startByte) return;
      const windowPcm = state.buffer.subarray(startByte, endByte);
      if (!(await silenceGateOpen(windowPcm))) return;
      try {
        const { text, costUsd } = await this.transcribe(windowPcm);
        state.onEvent({ type: 'health', ok: true });
        if (costUsd > 0) state.onEvent({ type: 'cost', usd: costUsd });
        if (!text || isLikelyHallucination(text)) return;
        state.interimText = stitchText(state.interimText, text);
        state.onEvent({ type: 'interim', utteranceId: state.utteranceId, text: state.interimText });
      } catch {
        // interim — best effort, ошибка отдельного окна не должна ронять сессию
        state.onEvent({ type: 'health', ok: false });
      }
    });
  }

  private enqueueFinal(state: SessionState, boundaryMs: number): void {
    const utteranceId = state.utteranceId;
    const utteranceStartMs = state.utteranceStartMs;
    const trimmedEndMs = Math.min(boundaryMs, state.lastSpeechAtMs + SILENCE_TAIL_PAD_MS) - utteranceStartMs;
    const buffer = state.buffer;

    state.queue = state.queue.then(async () => {
      const endByte = clampByte(msToBytes(trimmedEndMs), buffer.length);
      const finalPcm = buffer.subarray(0, endByte);
      if (finalPcm.length === 0) return;
      if (!(await silenceGateOpen(finalPcm))) return;
      try {
        const { text, costUsd } = await this.transcribe(finalPcm);
        state.onEvent({ type: 'health', ok: true });
        if (costUsd > 0) state.onEvent({ type: 'cost', usd: costUsd });
        if (!text || isLikelyHallucination(text)) return;
        state.onEvent({
          type: 'final',
          utteranceId,
          text,
          tStart: utteranceStartMs,
          tEnd: utteranceStartMs + trimmedEndMs,
        });
      } catch {
        // final не удался (таймаут/ошибка Whisper) — реплика молча теряется,
        // статус-бар получает whisper: down через событие health
        state.onEvent({ type: 'health', ok: false });
      }
    });
  }

  private async transcribe(pcm: Buffer): Promise<{ text: string; costUsd: number }> {
    const wav = pcm16ToWav(pcm, SAMPLE_RATE);
    const form = new FormData();
    const blob = new Blob([wav], { type: 'audio/wav' });

    let url: string;
    if (config.WHISPER_PROTOCOL === 'openai') {
      url = `${config.WHISPER_BASE_URL.replace(/\/$/, '')}/v1/audio/transcriptions`;
      form.set('file', blob, 'audio.wav');
      if (config.WHISPER_MODEL) form.set('model', config.WHISPER_MODEL);
      form.set('language', 'ru');
      form.set('response_format', 'json');
    } else if (config.WHISPER_PROTOCOL === 'asr') {
      url = `${config.WHISPER_BASE_URL.replace(/\/$/, '')}/asr`;
      form.set('audio_file', blob, 'audio.wav');
      form.set('language', 'ru');
      form.set('output', 'json');
    } else {
      // custom: WHISPER_BASE_URL — уже полный адрес эндпоинта (например .../transcribe)
      url = config.WHISPER_BASE_URL;
      form.set(config.WHISPER_FIELD_NAME, blob, 'audio.wav');
      form.set('language', 'ru');
    }

    const headers: Record<string, string> = {};
    if (config.WHISPER_API_KEY) headers.Authorization = `Bearer ${config.WHISPER_API_KEY}`;

    const res = await fetchWithTimeout(url, { method: 'POST', body: form, headers }, config.WHISPER_TIMEOUT_MS);
    if (!res.ok) throw new Error(`Whisper HTTP ${res.status}`);
    const json = await res.json();
    return { text: extractText(json).trim(), costUsd: extractCostUsd(json) };
  }
}
