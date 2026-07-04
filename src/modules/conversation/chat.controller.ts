import { Request, Response } from 'express';
import {
  createSession,
  getSession,
  addTurn,
  getStoreStats,
} from './session.service';
import { ChatRequest, ChatResponse } from '../../shared/types/session.types';

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT: Controllers vs Services
//
// A controller handles the HTTP layer:
//   - reads the request body
//   - validates inputs
//   - calls the service (business logic)
//   - formats and sends the response
//
// A service contains the business logic:
//   - knows nothing about HTTP
//   - just operates on data
//
// This separation makes testing much easier — you can test the service
// without needing to simulate an HTTP request.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 *
 * Handles an incoming chat message.
 *
 * Flow:
 * 1. If no sessionId in body → create a new session
 * 2. If sessionId provided → look it up (error if not found / expired)
 * 3. Store the user's message as a turn
 * 4. Generate a placeholder reply (Module 2 will replace this with real AI)
 * 5. Store the reply as a turn
 * 6. Return the sessionId + reply + current preferences
 */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const { sessionId, message } = req.body as ChatRequest;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required and must be a non-empty string' });
    return;
  }

  // ── Session resolution ────────────────────────────────────────────────────
  let session;

  if (!sessionId) {
    // First message — create a fresh session
    session = createSession();
  } else {
    // Continuing conversation — look up existing session
    session = getSession(sessionId);
    if (!session) {
      res.status(404).json({
        error: 'Session not found or expired. Start a new conversation by omitting sessionId.',
      });
      return;
    }
  }

  // ── Store user's message ──────────────────────────────────────────────────
  addTurn(session.sessionId, 'user', message.trim());

  // ── Generate reply ────────────────────────────────────────────────────────
  //
  // CONCEPT: This is a placeholder reply.
  //
  // In Module 2, we will replace this with real logic:
  //   1. Run the preference extractor (rule-based, free)
  //   2. Check completeness (what's still missing?)
  //   3. Either ask a follow-up question OR call the LLM
  //
  // For now, we just acknowledge receipt so we can verify the session
  // infrastructure works correctly before adding any AI logic on top.
  //
  const reply = generatePlaceholderReply(message.trim(), session.turns.length);

  // ── Store model's reply ───────────────────────────────────────────────────
  addTurn(session.sessionId, 'model', reply);

  // ── Refresh session reference after mutations ─────────────────────────────
  const updatedSession = getSession(session.sessionId)!;

  // ── Send response ─────────────────────────────────────────────────────────
  const response: ChatResponse = {
    sessionId: updatedSession.sessionId,
    reply,
    preferences: updatedSession.preferences,
    turnCount: updatedSession.turns.length,
  };

  res.status(200).json(response);
}

/**
 * GET /api/chat/:sessionId
 *
 * Returns the full session state for debugging and inspection.
 * Very useful during development to verify what the server has stored.
 */
export function getSessionState(req: Request, res: Response): void {
  const sessionId = req.params['sessionId'] as string;

  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired.' });
    return;
  }

  res.status(200).json({
    sessionId: session.sessionId,
    turnCount: session.turns.length,
    turns: session.turns,
    preferences: session.preferences,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
  });
}

/**
 * GET /api/health
 *
 * Simple health check — confirms the server is running and shows
 * how many active sessions are in memory.
 */
export function healthCheck(req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    module: 'Module 1 — Conversation & Session Layer',
    ...getStoreStats(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder reply generator
// This will be completely replaced in Module 2.
// For now it just varies the response slightly based on turn count.
// ─────────────────────────────────────────────────────────────────────────────
function generatePlaceholderReply(message: string, turnCount: number): string {
  if (turnCount === 1) {
    return `Hello! I'm your AI real estate consultant. I received your message: "${message}". I'm setting up your session and will start helping you find properties shortly. (Module 1 placeholder — LLM coming in Module 2)`;
  }
  return `Got it! This is turn #${turnCount} in your conversation. You said: "${message}". Preference extraction and real responses are coming in Module 2.`;
}
