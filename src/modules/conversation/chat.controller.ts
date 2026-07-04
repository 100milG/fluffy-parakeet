import { Request, Response } from 'express';
import {
  createSession,
  getSession,
  addTurn,
  updatePreferences,
  getStoreStats,
} from './session.service';
import { ChatRequest, ChatResponse } from '../../shared/types/session.types';
import { extractPreferences, mergePreferences, getMissingFields, generateFollowUp } from '../extraction/preference.extractor';
import { generateReply } from '../extraction/gemini.service';
import { getRateLimitStats } from '../../middleware/rate.limiter';

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT: The Module 2 chat pipeline
//
// Every incoming message now goes through these steps:
//
//  1. Resolve session (create or look up)
//  2. Store user message as a turn
//  3. EXTRACT preferences from the message (rule-based, free, instant)
//  4. MERGE extracted preferences with session's accumulated preferences
//  5. PERSIST the updated preferences back to the session
//  6. CHECK completeness (what's still missing?)
//  7. Generate a FOLLOW-UP question if something critical is missing
//  8. Call GEMINI to produce a natural conversational reply
//     (Gemini knows the preferences + what's missing + the follow-up question)
//  9. Store the AI reply as a turn
// 10. Return the response
//
// Notice that step 8 (LLM) happens AFTER step 3-7 (rules).
// The LLM gets the full context so it can write an appropriate response.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 *
 * Main chat handler — now wired to Module 2 preference extraction + Gemini.
 */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const { sessionId, message } = req.body as ChatRequest;

  // ── Input validation ────────────────────────────────────────────────────
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required and must be a non-empty string' });
    return;
  }

  // ── Session resolution ──────────────────────────────────────────────────
  let session;

  if (!sessionId) {
    session = createSession();
  } else {
    session = getSession(sessionId);
    if (!session) {
      res.status(404).json({
        error: 'Session not found or expired. Start a new conversation by omitting sessionId.',
      });
      return;
    }
  }

  const trimmedMessage = message.trim();

  // ── Store user's message ────────────────────────────────────────────────
  addTurn(session.sessionId, 'user', trimmedMessage);

  // ── Step 3: Extract preferences from this message ───────────────────────
  //
  // CONCEPT: We only extract from the LATEST message, not the full history.
  // The mergePreferences() call below accumulates results across all turns.
  //
  const newPrefs = extractPreferences(trimmedMessage);

  // ── Step 4: Merge with existing preferences ─────────────────────────────
  const updatedPrefs = mergePreferences(session.preferences, newPrefs);

  // ── Step 5: Persist back to session ────────────────────────────────────
  updatePreferences(session.sessionId, updatedPrefs);

  // ── Step 6-7: Completeness check + follow-up question ──────────────────
  const missingFields = getMissingFields(updatedPrefs);
  const followUpQuestion = generateFollowUp(missingFields);

  // ── Step 8: Call Gemini ─────────────────────────────────────────────────
  //
  // We fetch the FRESH session (post preference update) to get the latest turns.
  //
  const freshSession = getSession(session.sessionId)!;

  const reply = await generateReply(freshSession.turns, {
    preferences: updatedPrefs,
    missingFields,
    followUpQuestion,
  });

  // ── Step 9: Store AI reply ──────────────────────────────────────────────
  addTurn(session.sessionId, 'model', reply);

  // ── Step 10: Send response ──────────────────────────────────────────────
  const finalSession = getSession(session.sessionId)!;

  const response: ChatResponse = {
    sessionId: finalSession.sessionId,
    reply,
    preferences: finalSession.preferences,
    turnCount: finalSession.turns.length,
  };

  res.status(200).json(response);
}

/**
 * GET /api/chat/:sessionId
 *
 * Returns the full session state for debugging.
 * Shows extracted preferences in real-time — very useful during development.
 */
export function getSessionState(req: Request, res: Response): void {
  const sessionId = req.params['sessionId'] as string;

  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired.' });
    return;
  }

  const missingFields = getMissingFields(session.preferences);

  res.status(200).json({
    sessionId: session.sessionId,
    turnCount: session.turns.length,
    turns: session.turns,
    preferences: session.preferences,
    missingFields,
    isComplete: missingFields.length === 0,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
  });
}

/**
 * GET /api/health
 */
export function healthCheck(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    module: 'Module 2 — Preference Extraction + Gemini',
    ...getStoreStats(),
    ...getRateLimitStats(),
  });
}
