import { config } from '../config.js';
import { LlmOpsResponseSchema, type LlmOpsResponse } from '../insights/types.js';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
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

export interface LlmCallResult extends LlmOpsResponse {
  /** USD, если провайдер отдаёт usage.cost в ответе (routerai и т.п.); иначе 0. */
  costUsd: number;
}

/** Вызывает OpenAI-совместимый Chat Completions и возвращает провалидированный {ops:[...]} + стоимость. */
export async function callLlmForOps(messages: ChatMessage[]): Promise<LlmCallResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.LLM_API_KEY) headers.Authorization = `Bearer ${config.LLM_API_KEY}`;

  const res = await fetchWithTimeout(
    `${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.LLM_MODEL,
        temperature: 0.2,
        messages,
        response_format: { type: 'json_object' },
      }),
    },
    config.LLM_TIMEOUT_MS,
  );

  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const costUsd = typeof json.usage?.cost === 'number' ? json.usage.cost : 0;
  const content = json.choices?.[0]?.message?.content;
  if (!content) return { ops: [], costUsd };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ops: [], costUsd };
  }

  const result = LlmOpsResponseSchema.safeParse(parsed);
  return result.success ? { ...result.data, costUsd } : { ops: [], costUsd };
}

export async function checkLlmHealth(): Promise<boolean> {
  try {
    const res = await callLlmForOps([
      { role: 'system', content: 'Ответь только {"ops":[]}' },
      { role: 'user', content: 'ping' },
    ]);
    return Array.isArray(res.ops);
  } catch {
    return false;
  }
}
