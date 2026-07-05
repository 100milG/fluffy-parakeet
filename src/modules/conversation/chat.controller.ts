import { Request, Response } from 'express';
import {
  createSession,
  getSession,
  addTurn,
  updatePreferences,
  saveRecommendations,
  updateInteractionId,
  getStoreStats,
} from './session.service';
import { ChatRequest, ChatResponse, ScoredProperty } from '../../shared/types/session.types';
import { extractPreferences, mergePreferences, getMissingFields, generateFollowUp } from '../extraction/preference.extractor';
import { generateReply } from '../extraction/gemini.service';
import { getRateLimitStats } from '../../middleware/rate.limiter';
import { getRecommendations } from '../recommendation/recommendation.service';
import { isExplainIntent, extractListingIndex, generateExplanation } from '../explanation/explanation.engine';

/**
 * POST /api/chat
 *
 * Main chat handler — now wired with Structured Outputs and Function Calling (Module 5).
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

  // ── Static Greeting Guard (Method 1 — quota optimisation) ──────────────────
  // Short/social messages that carry no real estate intent get an instant local
  // reply. This saves one full Gemini call per greeting/thank-you/filler message.
  const GREETING_PATTERNS = [
    /^(hi|hello|hey|hiya|howdy|namaste|good\s+(morning|afternoon|evening|day))[\s!?.]*$/i,
    /^(thanks?|thank\s+you|thx|ty|cheers|great|awesome|nice|ok|okay|cool|got\s+it|sounds\s+good)[\s!?.]*$/i,
    /^(start\s+over|restart|reset|begin\s+again|new\s+chat)[\s!?.]*$/i,
    /^(bye|goodbye|see\s+ya|later|cya)[\s!?.]*$/i,
  ];

  const GREETING_REPLIES = [
    "Hi there! I'm Reeva, your Mumbai property guide. What kind of flat or property are you looking for?",
    "Hello! Great to have you here. Tell me — are you looking to buy or rent in Mumbai?",
    "Hey! I'm Reeva. Looking for a flat in Mumbai? Tell me your preferred area, budget, and how many bedrooms you need!",
  ];

  const isGreeting = GREETING_PATTERNS.some(re => re.test(trimmedMessage))
    || trimmedMessage.split(/\s+/).length <= 2; // ≤2 words and not a real query

  if (isGreeting) {
    const reply = GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)]!;
    console.log(`[ChatController] Static greeting reply sent (no API call). Message: "${trimmedMessage}"`);
    addTurn(session.sessionId, 'user', trimmedMessage);
    addTurn(session.sessionId, 'model', reply);
    const freshSess = getSession(session.sessionId)!;
    res.status(200).json({
      sessionId: freshSess.sessionId,
      reply,
      preferences: freshSess.preferences,
      turnCount: freshSess.turns.length,
    } as ChatResponse);
    return;
  }

  // ── Store user's message ───────────────────────────────────────────────────

  addTurn(session.sessionId, 'user', trimmedMessage);

  // ── Step 3: Detect "explain listing N" intent (Module 4) ──────────────────
  if (isExplainIntent(trimmedMessage)) {
    const currentSession = getSession(session.sessionId)!;
    const stored = currentSession.lastRecommendations;

    if (stored && stored.length > 0) {
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
  }

  // ── Step 4: Rule-based fast preference extraction (Layer 1) ───────────────
  const rulePrefs = extractPreferences(trimmedMessage);
  let updatedPrefs = mergePreferences(session.preferences, rulePrefs);
  updatePreferences(session.sessionId, updatedPrefs);

  // ── Step 5: Completeness check + follow-up question ──────────────────────
  let freshSession = getSession(session.sessionId)!;
  let missingFields = getMissingFields(freshSession.preferences);
  let followUpQuestion = generateFollowUp(missingFields);

  // ── Step 6: Call Gemini (Structured JSON reply + Function Calling) ─────────
  try {
    const responseObj = await generateReply(
      freshSession.turns,
      {
        preferences: freshSession.preferences,
        missingFields,
        followUpQuestion,
        lastInteractionId: freshSession.lastInteractionId,
      },
      async (searchParams) => {
        console.log('[ChatController] Tool execution triggered with params:', searchParams);
        
        // Match schemas to preferences (localities list, budget, beds)
        const partialPrefs: any = {
          localities: searchParams.localities,
          budgetMax: searchParams.budgetMax,
          bedroomsMin: searchParams.bedroomsMin,
          bedroomsMax: searchParams.bedroomsMin
        };

        // Persist tool arguments back to session preferences
        const merged = mergePreferences(freshSession.preferences, partialPrefs);
        updatePreferences(session.sessionId, merged);

        // Run PostgreSQL Prisma query
        const listings = await getRecommendations(merged);
        if (listings.length > 0) {
          saveRecommendations(session.sessionId, listings);
        }
        return listings;
      }
    );

    // Persist session-interaction tokens
    updateInteractionId(session.sessionId, responseObj.interactionId);

    // Persist Gemini structured preference extraction results (Layer 2)
    if (responseObj.extractedPreferences) {
      console.log('[ChatController] Extracted preferences from Gemini responseSchema:', responseObj.extractedPreferences);
      const mergedPrefs = mergePreferences(freshSession.preferences, responseObj.extractedPreferences);
      updatePreferences(session.sessionId, mergedPrefs);
    }

    // Save Reeva reply turn
    addTurn(session.sessionId, 'model', responseObj.reply);

    const finalSession = getSession(session.sessionId)!;
    res.status(200).json({
      sessionId: finalSession.sessionId,
      reply: responseObj.reply,
      preferences: finalSession.preferences,
      turnCount: finalSession.turns.length,
    } as ChatResponse);

  } catch (err) {
    console.error('[ChatController] Error processing Gemini response:', err);
    res.status(500).json({ error: 'Internal server error processing response.' });
  }
}

/**
 * GET /api/chat/:sessionId
 *
 * Returns the full session state for debugging.
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
    module: 'Module 5 — Structured Outputs & Function Calling',
    ...getStoreStats(),
    ...getRateLimitStats(),
  });
}

/**
 * GET /api/health Check Server details
 */
export function healthCheckDetails(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    module: 'Module 5 — Structured Outputs & Function Calling',
  });
}
