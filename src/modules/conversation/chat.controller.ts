import { Request, Response } from 'express';
import {
  createSession,
  getSession,
  addTurn,
  updatePreferences,
  saveRecommendations,
  getStoreStats,
} from './session.service';
import { ChatRequest, ChatResponse, ScoredProperty } from '../../shared/types/session.types';
import { extractPreferences, mergePreferences, getMissingFields, generateFollowUp } from '../extraction/preference.extractor';
import { generateReply } from '../extraction/gemini.service';
import { getRateLimitStats } from '../../middleware/rate.limiter';
import { getRecommendations } from '../recommendation/recommendation.service';
import { isExplainIntent, extractListingIndex, generateExplanation } from '../explanation/explanation.engine';



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

  // ── Store user's message ───────────────────────────────────────────────────
  addTurn(session.sessionId, 'user', trimmedMessage);

  // ── Step 3: Detect "explain listing N" intent (Module 4) ──────────────────
  //
  // CONCEPT: We check for explain intent BEFORE running preference extraction.
  // If the user is asking "why listing 2?", we don't need to re-extract prefs.
  // We just look up the stored recommendations from the session and explain them.
  // This short-circuits the rest of the pipeline and returns immediately.
  //
  if (isExplainIntent(trimmedMessage)) {
    const currentSession = getSession(session.sessionId)!;
    const stored = currentSession.lastRecommendations;

    if (stored && stored.length > 0) {
      // Which listing is the user asking about? Default to #1.
      const rawIdx = extractListingIndex(trimmedMessage);
      const listingNum = rawIdx != null ? rawIdx : 1;
      const property   = stored[listingNum - 1] ?? stored[0]!;

      console.log(`[ExplanationEngine] Explaining listing #${listingNum}: ${property.title}`);

      const explanation = await generateExplanation(property, currentSession.preferences, listingNum);
      addTurn(session.sessionId, 'model', explanation);

      res.status(200).json({
        sessionId: session.sessionId,
        reply: explanation,
        preferences: currentSession.preferences,
        turnCount: currentSession.turns.length,
      } as ChatResponse);
      return;
    }
    // If no stored recommendations yet, fall through to normal flow
  }

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

  // ── Step 8: Detect "show me listings" intent ─────────────────────────
  //
  // CONCEPT: Intent detection (rule-based, not LLM)
  //
  // We detect user intent to see listings with a simple regex.
  // We only call the recommendation engine when:
  //   a) All critical fields (locality, budget, bedrooms) are collected, AND
  //   b) The user has signalled they want to see results
  //      ("yes", "show me", "find properties", etc.)
  //
  // This avoids querying the DB on every message and saves Prisma calls.
  //
  const SHOW_LISTING_PATTERNS = [
    /\byes\b/i,
    /show\s*(me)?\s*(the\s*)?(listings?|properties|flats?|results?)/i,
    /find\s*(me\s*)?(properties|flats?|listings?)/i,
    /\bsearch\b/i,
    /\blet'?s\s+see\b/i,
    /\bgo\s+ahead\b/i,
    /\bsure\b/i,
    /\bplease\b.*\bshow\b/i,
  ];

  const freshSession = getSession(session.sessionId)!;

  const wantsListings = missingFields.length === 0 &&
    SHOW_LISTING_PATTERNS.some(re => re.test(trimmedMessage));

  // Also auto-show if all fields collected AND this is the first complete message
  // (e.g. user gave everything in one shot)
  const isCompleteFirstTime = missingFields.length === 0 && freshSession.turns.length <= 2;

  let listings: ScoredProperty[] = [];

  if (wantsListings || isCompleteFirstTime) {
    try {
      listings = await getRecommendations(updatedPrefs);
      console.log(`[ChatController] Recommendation engine returned ${listings.length} results`);

      // ── Save to session so the explanation engine can reference them ──────
      if (listings.length > 0) {
        saveRecommendations(session.sessionId, listings);
      }
    } catch (err) {
      // Non-fatal: if DB is down, still reply conversationally without listings
      console.error('[ChatController] Recommendation engine error:', err);
    }
  }


  // ── Step 9: Call Gemini ───────────────────────────────────────────────
  //
  // We fetch the FRESH session (post preference update) to get the latest turns.
  //
  const freshSession2 = getSession(session.sessionId)!;

  const reply = await generateReply(freshSession2.turns, {
    preferences: updatedPrefs,
    missingFields,
    followUpQuestion,
    listings: listings.length > 0 ? listings : undefined,
  });

  // ── Step 10: Store AI reply ────────────────────────────────────────────
  addTurn(session.sessionId, 'model', reply);

  // ── Step 11: Send response ────────────────────────────────────────────
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
    module: 'Module 4 — Explanation Engine',
    ...getStoreStats(),
    ...getRateLimitStats(),
  });
}
