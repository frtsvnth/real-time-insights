import { SYSTEM_PROMPT } from './systemPrompt.js';
import { applyOps, type AppliedEvent } from './applyOps.js';
import type { Session } from './types.js';
import { callLlmForOps, type ChatMessage } from '../llm/openaiCompatible.js';

const DEFAULT_DEBOUNCE_MS = 2000;
const CONTEXT_WINDOW_SIZE = 8;

function buildUserMessage(session: Session): string {
  const lastFinalUtterances = session.utterances
    .filter((u) => u.isFinal)
    .slice(-CONTEXT_WINDOW_SIZE)
    .map((u) => ({ id: u.id, t: u.tStart, speaker: u.speaker, text: u.text }));

  const currentInsights = session.insights.map((i) => ({
    id: i.id,
    type: i.type,
    title: i.title,
    body: i.body,
    status: i.status,
    speakers: i.speakers,
    openSlots: i.openSlots,
  }));

  return JSON.stringify({ lastFinalUtterances, currentInsights });
}

/**
 * Дебаунсит финальные реплики и вызывает LLM не чаще одного запроса "в полёте" на сессию.
 * Если новый final пришёл, пока ждём ответ — он подхватится следующим тиком (склейка в пачку).
 */
export class InsightEngine {
  private static readonly MAX_CONSECUTIVE_RETRIES = 1;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private queuedWhileInFlight = false;
  private lastProcessedUtteranceId: string | null = null;
  private consecutiveFailures = 0;

  constructor(
    private readonly session: Session,
    private readonly onEvent: (event: AppliedEvent) => void,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
    private readonly onLlmStatus?: (ok: boolean) => void,
    private readonly onCost?: (usd: number) => void,
  ) {}

  notifyFinalUtterance(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.tick();
    }, this.debounceMs);
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.inFlight) {
      this.queuedWhileInFlight = true;
      return;
    }

    const finals = this.session.utterances.filter((u) => u.isFinal);
    if (finals.length === 0) return;
    const latest = finals[finals.length - 1];
    if (latest.id === this.lastProcessedUtteranceId) return;

    this.inFlight = true;
    try {
      const userContent = buildUserMessage(this.session);
      if (process.env.DEBUG_INSIGHTS) console.error('[DEBUG_INSIGHTS] tick start, user message:', userContent);
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ];
      const t0 = Date.now();
      const response = await callLlmForOps(messages);
      if (process.env.DEBUG_INSIGHTS) console.error(`[DEBUG_INSIGHTS] tick done in ${Date.now() - t0}ms, raw ops:`, JSON.stringify(response.ops));
      this.onLlmStatus?.(true);
      if (response.costUsd > 0) this.onCost?.(response.costUsd);
      const events = applyOps(this.session, response.ops, latest.id);
      this.lastProcessedUtteranceId = latest.id;
      this.consecutiveFailures = 0;
      for (const event of events) this.onEvent(event);
    } catch (err) {
      if (process.env.DEBUG_INSIGHTS) console.error('[DEBUG_INSIGHTS] tick failed:', err);
      this.onLlmStatus?.(false);
      // Транзиентный сбой/таймаут не должен навсегда терять последнюю реплику: один повтор
      // через обычный debounce. Если и он не удался — сдаёмся до следующей новой реплики,
      // чтобы не долбить упавший LLM бесконечно и не плодить лишние платные запросы.
      if (this.consecutiveFailures < InsightEngine.MAX_CONSECUTIVE_RETRIES) {
        this.consecutiveFailures++;
        this.notifyFinalUtterance();
      } else {
        this.consecutiveFailures = 0;
      }
    } finally {
      this.inFlight = false;
      if (this.queuedWhileInFlight) {
        this.queuedWhileInFlight = false;
        void this.tick();
      }
    }
  }
}
