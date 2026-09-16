import { z } from 'zod';

export const InsightType = z.enum(['fact', 'question', 'qa', 'preference', 'decision']);
export type InsightType = z.infer<typeof InsightType>;

export const InsightStatus = z.enum(['candidate', 'confirmed', 'updated']);
export type InsightStatus = z.infer<typeof InsightStatus>;

export const EvidenceSchema = z.object({
  quote: z.string(),
  utteranceId: z.string(),
  t: z.number(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const InsightSchema = z.object({
  id: z.string(),
  type: InsightType,
  title: z.string(),
  body: z.string(),
  status: InsightStatus,
  speakers: z.array(z.string()),
  openSlots: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  confidence: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  position: z.object({ x: z.number(), y: z.number() }),
});
export type Insight = z.infer<typeof InsightSchema>;

export const UtteranceSchema = z.object({
  id: z.string(),
  tStart: z.number(),
  tEnd: z.number(),
  speaker: z.string(),
  text: z.string(),
  isFinal: z.boolean(),
});
export type Utterance = z.infer<typeof UtteranceSchema>;

export const SessionStatus = z.enum(['idle', 'recording', 'error']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export interface Session {
  id: string;
  status: SessionStatus;
  speakers: string[];
  utterances: Utterance[];
  insights: Insight[];
  startedAt: number | null;
}

// --- Операции, которые может вернуть LLM ---

export const InsightOpSchema = z.object({
  op: z.enum(['create', 'update', 'answer', 'merge', 'discard', 'rename_speaker']),
  insightId: z.string().optional(),
  targetId: z.string().optional(),
  type: InsightType.optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  speaker: z.string().nullable().optional(),
  openSlots: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
  // только для op=rename_speaker: узнали настоящее имя ранее безымянного спикера
  fromSpeaker: z.string().optional(),
  toSpeaker: z.string().optional(),
});
export type InsightOp = z.infer<typeof InsightOpSchema>;

export const LlmOpsResponseSchema = z.object({
  ops: z.array(InsightOpSchema).max(10), // мягкий предел, applyOps дополнительно режет до 3
});
export type LlmOpsResponse = z.infer<typeof LlmOpsResponseSchema>;

// --- WebSocket протокол ---

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_start') }),
  z.object({ type: z.literal('session_stop') }),
  z.object({ type: z.literal('rename_speaker'), from: z.string(), to: z.string() }),
  z.object({ type: z.literal('pin_insight'), insightId: z.string() }),
  z.object({ type: z.literal('hide_insight'), insightId: z.string() }),
  // dev-режим: симуляция реплик текстом вместо микрофона
  z.object({ type: z.literal('simulate_utterance'), text: z.string(), speaker: z.string().optional() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'stt_interim'; text: string; utteranceId: string }
  | { type: 'stt_final'; utterance: Utterance }
  | { type: 'insight_event'; op: InsightOp['op']; insight: Insight; previousInsight?: Insight }
  | { type: 'status'; whisper: 'ok' | 'down' | 'unknown'; llm: 'ok' | 'down' | 'unknown'; recording: boolean }
  | { type: 'cost_update'; totalRub: number }
  | { type: 'speaker_renamed'; from: string; to: string }
  | { type: 'error'; message: string };
