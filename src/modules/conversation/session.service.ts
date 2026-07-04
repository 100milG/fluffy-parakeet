import { randomUUID } from 'crypto';
import { Session, Turn, UserPreferences, ScoredProperty } from '../../shared/types/session.types';


// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT: The Session Store
//
// A Map is JavaScript's built-in key-value data structure.
// Map<string, Session> means: keys are strings (sessionIds), values are Sessions.
//
// Why Map instead of a plain object {}?
// - Map preserves insertion order
// - Map has built-in methods: .set(), .get(), .has(), .delete()
// - Map is slightly faster for frequent add/delete operations
//
// This Map lives in memory. It's shared across all requests because Node.js
// runs as a single long-lived process — the Map persists as long as the server
// is running. This is why it's called "in-memory" storage.
// ─────────────────────────────────────────────────────────────────────────────
const sessionStore = new Map<string, Session>();

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT: Session Expiry
//
// If a user walks away and never comes back, their session stays in memory
// forever — a memory leak. We evict sessions after 30 minutes of inactivity.
// In production, Redis handles this automatically with TTL (Time-To-Live).
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Creates a brand new session and stores it in memory.
 * Returns the full session object (including the new sessionId).
 */
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


/**
 * Retrieves a session by its ID.
 * Returns null if not found or if it has expired.
 *
 * CONCEPT: Why do we check expiry here, not somewhere else?
 * We check on every read. Lazy expiry — we don't run a background timer
 * to clean up. Instead, we clean up when someone tries to access a stale session.
 * This is a common pattern for simple in-memory stores.
 */
export function getSession(sessionId: string): Session | null {
  const session = sessionStore.get(sessionId);
  if (!session) return null;

  const now = Date.now();
  const age = now - session.lastActiveAt.getTime();

  if (age > SESSION_TTL_MS) {
    sessionStore.delete(sessionId); // clean up expired session
    return null;
  }

  return session;
}

/**
 * Appends a new turn to the session's conversation history.
 * Also updates lastActiveAt to reset the expiry timer.
 */
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

/**
 * Updates the extracted preferences for a session.
 * Uses spread to merge — only overrides fields that are provided.
 *
 * Example:
 *   preferences currently: { budgetMax: 5000000 }
 *   update with:           { localities: ["Andheri"] }
 *   result:                { budgetMax: 5000000, localities: ["Andheri"] }
 */
export function updatePreferences(
  sessionId: string,
  partial: Partial<UserPreferences>
): void {
  const session = sessionStore.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  session.preferences = { ...session.preferences, ...partial };
  session.lastActiveAt = new Date();
}

/**
 * Persists the most recent recommendation results in the session.
 * The explanation engine uses these to answer "why listing 2?" questions.
 */
export function saveRecommendations(sessionId: string, listings: ScoredProperty[]): void {
  const session = sessionStore.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.lastRecommendations = listings;
  session.lastActiveAt = new Date();
}

/**
 * Returns a summary of how many sessions are currently in memory.
 * Useful for health checks and debugging.
 */
export function getStoreStats(): { activeSessions: number } {
  return { activeSessions: sessionStore.size };
}
