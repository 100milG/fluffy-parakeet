import { randomUUID } from 'crypto';
import { Session, Turn, UserPreferences, ScoredProperty } from '../../shared/types/session.types';

const sessionStore = new Map<string, Session>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function createSession(): Session {
  const session: Session = {
    sessionId: randomUUID(),
    turns: [],
    preferences: {},
    lastRecommendations: [],
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };

  sessionStore.set(session.sessionId, session);
  return session;
}

export function getSession(sessionId: string): Session | null {
  const session = sessionStore.get(sessionId);
  if (!session) return null;

  const now = Date.now();
  const age = now - session.lastActiveAt.getTime();

  if (age > SESSION_TTL_MS) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

export function addTurn(sessionId: string, role: 'user' | 'model', content: string): Turn {
  const session = sessionStore.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const turn: Turn = {
    role,
    content,
    timestamp: new Date(),
  };

  session.turns.push(turn);
  session.lastActiveAt = new Date();

  return turn;
}

export function updatePreferences(
  sessionId: string,
  partial: Partial<UserPreferences>
): void {
  const session = sessionStore.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  session.preferences = { ...session.preferences, ...partial };
  session.lastActiveAt = new Date();
}

export function saveRecommendations(sessionId: string, listings: ScoredProperty[]): void {
  const session = sessionStore.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.lastRecommendations = listings;
  session.lastActiveAt = new Date();
}

export function updateInteractionId(sessionId: string, interactionId: string): void {
  const session = sessionStore.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.lastInteractionId = interactionId;
  session.lastActiveAt = new Date();
}

export function getStoreStats(): { activeSessions: number } {
  return { activeSessions: sessionStore.size };
}
