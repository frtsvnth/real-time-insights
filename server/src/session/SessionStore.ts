import type { Session, Utterance } from '../insights/types.js';

export class SessionStore {
  private sessions = new Map<string, Session>();

  getOrCreate(id: string): Session {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const session: Session = {
      id,
      status: 'idle',
      speakers: [],
      utterances: [],
      insights: [],
      startedAt: null,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  addUtterance(session: Session, utterance: Utterance): void {
    session.utterances.push(utterance);
    if (!session.speakers.includes(utterance.speaker)) {
      session.speakers.push(utterance.speaker);
    }
  }
}

export const sessionStore = new SessionStore();

/**
 * Переименовывает спикера во всей сессии (список спикеров, реплики, карточки).
 * Общий путь и для ручного переименования из UI, и для авто-переименования по LLM
 * (когда кто-то в разговоре называет Speaker N по имени).
 */
export function renameSpeakerInSession(session: Session, from: string, to: string): void {
  session.speakers = session.speakers.map((s) => (s === from ? to : s));
  for (const utterance of session.utterances) {
    if (utterance.speaker === from) utterance.speaker = to;
  }
  for (const insight of session.insights) {
    insight.speakers = insight.speakers.map((s) => (s === from ? to : s));
  }
}
