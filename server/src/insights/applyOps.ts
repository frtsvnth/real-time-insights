import { randomUUID } from 'node:crypto';
import type { Insight, InsightOp, Session } from './types.js';
import { renameSpeakerInSession } from '../session/SessionStore.js';

type InsightAppliedEvent = { op: 'create' | 'update' | 'answer' | 'merge' | 'discard'; insight: Insight; previousInsight?: Insight };
type RenameSpeakerAppliedEvent = { op: 'rename_speaker'; from: string; to: string };
export type AppliedEvent = InsightAppliedEvent | RenameSpeakerAppliedEvent;

const MAX_OPS_PER_TICK = 3;
const MAX_INSIGHTS_PER_SESSION = 40;
const MIN_CREATE_CONFIDENCE = 0.55;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

function findDuplicate(session: Session, title: string, body: string): Insight | undefined {
  const normalizedTitle = normalize(title);
  const normalizedBody = normalize(body);
  return session.insights.find((insight) => {
    if (normalize(insight.title) === normalizedTitle) return true;
    return normalizedBody.length > 0 && normalize(insight.body) === normalizedBody;
  });
}

/**
 * Применяет операции LLM к карточкам сессии. Валидирует и отфильтровывает всё небезопасное:
 * неизвестные id, create с низкой уверенностью, дубли, превышение лимитов.
 * Возвращает события для рассылки insight_event на фронт (уже только успешно применённые).
 */
export function applyOps(session: Session, ops: InsightOp[], evidenceUtteranceId: string, nowMs = Date.now()): AppliedEvent[] {
  const events: AppliedEvent[] = [];
  for (const op of ops.slice(0, MAX_OPS_PER_TICK)) {
    const event = applyOne(session, op, evidenceUtteranceId, nowMs);
    if (event) events.push(event);
  }
  return events;
}

function applyOne(session: Session, op: InsightOp, utteranceId: string, nowMs: number): AppliedEvent | undefined {
  switch (op.op) {
    case 'create':
      return applyCreate(session, op, utteranceId, nowMs);
    case 'update':
      return applyUpdate(session, op, utteranceId, nowMs);
    case 'answer':
      return applyAnswer(session, op, utteranceId, nowMs);
    case 'merge':
      return applyMerge(session, op, nowMs);
    case 'discard':
      return applyDiscard(session, op);
    case 'rename_speaker':
      return applyRenameSpeaker(session, op);
    default:
      return undefined;
  }
}

function applyRenameSpeaker(session: Session, op: InsightOp): AppliedEvent | undefined {
  const from = op.fromSpeaker;
  const to = op.toSpeaker?.trim();
  // from должен быть реально известным спикером сессии — иначе LLM просто выдумала переименование.
  // to не должен совпадать с именем уже другого существующего спикера — иначе модель может
  // по ошибке (обращение к собеседнику спутала с самопредставлением) слить двух разных людей
  // в одно имя. Легитимное повторное переименование того же спикера тоже отсеется этой же
  // проверкой ниже (from уже не входит в session.speakers после первого переименования).
  if (!from || !to || from === to || !session.speakers.includes(from)) return undefined;
  if (session.speakers.includes(to)) return undefined;
  renameSpeakerInSession(session, from, to);
  return { op: 'rename_speaker', from, to };
}

function applyCreate(session: Session, op: InsightOp, utteranceId: string, nowMs: number): InsightAppliedEvent | undefined {
  if (!op.title || !op.body || !op.type) return undefined;
  const confidence = op.confidence ?? 0;
  if (confidence < MIN_CREATE_CONFIDENCE) return undefined;

  const duplicate = findDuplicate(session, op.title, op.body);
  if (duplicate) {
    return applyUpdate(session, { ...op, op: 'update', insightId: duplicate.id }, utteranceId, nowMs);
  }

  if (session.insights.length >= MAX_INSIGHTS_PER_SESSION) return undefined;

  const insight: Insight = {
    id: randomUUID(),
    type: op.type,
    title: op.title,
    body: op.body,
    status: 'candidate',
    speakers: op.speaker ? [op.speaker] : [],
    openSlots: op.openSlots ?? [],
    evidence: (op.evidence ?? []).map((quote) => ({ quote, utteranceId, t: nowMs })),
    confidence,
    createdAt: nowMs,
    updatedAt: nowMs,
    position: { x: 0, y: 0 },
  };
  session.insights.push(insight);
  return { op: 'create', insight };
}

function applyUpdate(session: Session, op: InsightOp, utteranceId: string, nowMs: number): InsightAppliedEvent | undefined {
  if (!op.insightId) return undefined;
  const insight = session.insights.find((i) => i.id === op.insightId);
  if (!insight) return undefined;

  if (op.title) insight.title = op.title;
  if (op.body) insight.body = op.body;
  if (op.openSlots) insight.openSlots = op.openSlots;
  if (op.speaker && !insight.speakers.includes(op.speaker)) insight.speakers.push(op.speaker);
  if (op.evidence) {
    for (const quote of op.evidence) insight.evidence.push({ quote, utteranceId, t: nowMs });
  }
  if (typeof op.confidence === 'number') insight.confidence = Math.max(insight.confidence, op.confidence);
  insight.status = 'updated';
  insight.updatedAt = nowMs;
  return { op: 'update', insight };
}

function applyAnswer(session: Session, op: InsightOp, utteranceId: string, nowMs: number): InsightAppliedEvent | undefined {
  const result = applyUpdate(session, op, utteranceId, nowMs);
  if (!result) return undefined;
  result.insight.type = 'qa';
  return { op: 'answer', insight: result.insight };
}

function applyMerge(session: Session, op: InsightOp, nowMs: number): InsightAppliedEvent | undefined {
  const sourceId = op.insightId;
  const targetId = op.targetId;
  if (!sourceId || !targetId || sourceId === targetId) return undefined;

  const source = session.insights.find((i) => i.id === sourceId);
  const target = session.insights.find((i) => i.id === targetId);
  if (!source || !target) return undefined;

  target.evidence.push(...source.evidence);
  for (const speaker of source.speakers) {
    if (!target.speakers.includes(speaker)) target.speakers.push(speaker);
  }
  target.confidence = Math.max(target.confidence, source.confidence);
  target.updatedAt = nowMs;

  session.insights = session.insights.filter((i) => i.id !== sourceId);
  return { op: 'merge', insight: target, previousInsight: source };
}

function applyDiscard(session: Session, op: InsightOp): InsightAppliedEvent | undefined {
  if (!op.insightId) return undefined;
  const idx = session.insights.findIndex((i) => i.id === op.insightId);
  if (idx === -1) return undefined;
  const [removed] = session.insights.splice(idx, 1);
  return { op: 'discard', insight: removed };
}
