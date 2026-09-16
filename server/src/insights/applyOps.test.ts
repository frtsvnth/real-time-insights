import { describe, expect, it } from 'vitest';
import { applyOps } from './applyOps.js';
import type { Session } from './types.js';

function emptySession(): Session {
  return { id: 's1', status: 'recording', speakers: [], utterances: [], insights: [], startedAt: Date.now() };
}

describe('applyOps', () => {
  it('создаёт карточку при confidence >= 0.55', () => {
    const session = emptySession();
    const events = applyOps(
      session,
      [{ op: 'create', type: 'fact', title: 'Любит собак', body: 'Человек любит собак', confidence: 0.7 }],
      'u1',
    );
    expect(events).toHaveLength(1);
    expect(session.insights).toHaveLength(1);
    expect(session.insights[0].status).toBe('candidate');
  });

  it('игнорирует create с confidence < 0.55', () => {
    const session = emptySession();
    const events = applyOps(
      session,
      [{ op: 'create', type: 'fact', title: 'Слабый факт', body: 'Что-то неуверенное', confidence: 0.3 }],
      'u1',
    );
    expect(events).toHaveLength(0);
    expect(session.insights).toHaveLength(0);
  });

  it('два подряд одинаковых факта не создают два облака (create-дубль -> update)', () => {
    const session = emptySession();
    applyOps(session, [{ op: 'create', type: 'preference', title: 'Любит собак', body: 'Человек любит собак', confidence: 0.8 }], 'u1');
    const events = applyOps(
      session,
      [{ op: 'create', type: 'preference', title: 'Любит собак', body: 'Человек любит собак, особенно доберманов', confidence: 0.75 }],
      'u2',
    );
    expect(session.insights).toHaveLength(1);
    expect(events[0].op).toBe('update');
    expect(session.insights[0].body).toContain('доберманов');
  });

  it('update с неизвестным insightId игнорируется', () => {
    const session = emptySession();
    const events = applyOps(session, [{ op: 'update', insightId: 'nope', body: 'что-то' }], 'u1');
    expect(events).toHaveLength(0);
  });

  it('answer превращает карточку в qa и сохраняет ответ', () => {
    const session = emptySession();
    applyOps(session, [{ op: 'create', type: 'question', title: 'Погода завтра', body: 'Какая погода завтра?', confidence: 0.9 }], 'u1');
    const questionId = session.insights[0].id;
    const events = applyOps(
      session,
      [{ op: 'answer', insightId: questionId, body: 'Завтра будет 17 градусов', confidence: 0.9 }],
      'u2',
    );
    expect(events[0].op).toBe('answer');
    expect(session.insights[0].type).toBe('qa');
    expect(session.insights[0].body).toContain('17');
  });

  it('merge переносит evidence и спикеров в target и удаляет source', () => {
    const session = emptySession();
    applyOps(session, [{ op: 'create', type: 'fact', title: 'A', body: 'Факт A', confidence: 0.9, speaker: 'Speaker 1' }], 'u1');
    applyOps(session, [{ op: 'create', type: 'fact', title: 'B', body: 'Факт B про другое', confidence: 0.9, speaker: 'Speaker 2' }], 'u2');
    const [a, b] = session.insights;
    const events = applyOps(session, [{ op: 'merge', insightId: b.id, targetId: a.id }], 'u3');
    expect(session.insights).toHaveLength(1);
    expect(events[0].op).toBe('merge');
    expect(session.insights[0].speakers).toContain('Speaker 2');
  });

  it('пустой ops — норма, ничего не падает', () => {
    const session = emptySession();
    const events = applyOps(session, [], 'u1');
    expect(events).toHaveLength(0);
  });

  it('rename_speaker переименовывает спикера во всех карточках сессии', () => {
    const session = emptySession();
    session.speakers.push('Speaker 2');
    applyOps(session, [{ op: 'create', type: 'fact', title: 'A', body: 'Факт A', confidence: 0.9, speaker: 'Speaker 2' }], 'u1');
    const events = applyOps(session, [{ op: 'rename_speaker', fromSpeaker: 'Speaker 2', toSpeaker: 'Дима' }], 'u2');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ op: 'rename_speaker', from: 'Speaker 2', to: 'Дима' });
    expect(session.insights[0].speakers).toEqual(['Дима']);
  });

  it('rename_speaker игнорируется, если fromSpeaker не встречался в сессии', () => {
    const session = emptySession();
    session.speakers.push('Speaker 1');
    applyOps(session, [{ op: 'create', type: 'fact', title: 'A', body: 'Факт A', confidence: 0.9, speaker: 'Speaker 1' }], 'u1');
    const events = applyOps(session, [{ op: 'rename_speaker', fromSpeaker: 'Speaker 9', toSpeaker: 'Дима' }], 'u2');
    expect(events).toHaveLength(0);
    expect(session.insights[0].speakers).toEqual(['Speaker 1']);
  });
});
