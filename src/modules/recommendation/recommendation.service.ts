// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Recommendation Service (Orchestrator)
//
// CONCEPT: This is the public API for the recommendation engine.
// The chat controller only imports THIS file — it never touches the DB layer
// or scorer directly. This keeps coupling minimal and makes each layer
// independently testable.
//
// Flow:
//   1. Fetch candidate pool from DB  (property.service.ts)
//   2. Score + rank all candidates   (scorer.ts)
//   3. Return top N results
// ─────────────────────────────────────────────────────────────────────────────

import { UserPreferences, ScoredProperty } from './types';
import { fetchCandidates } from './property.service';
import { rankProperties } from './scorer';

const TOP_N = 5;            // Return at most top 5 results to Gemini
const SCORE_THRESHOLD = 50;  // Minimum relevance score (out of 100) to qualify as a match

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point for the recommendation engine.
 *
 * Given the user's accumulated preferences, queries the database,
 * scores all candidates, and returns the top-N qualified properties.
 *
 * @param prefs - The accumulated UserPreferences from the session
 * @returns Top-N ScoredProperty objects sorted by score descending (score >= 50)
 */
export async function getRecommendations(
  prefs: Partial<UserPreferences>,
): Promise<ScoredProperty[]> {
  console.log('[RecommendationEngine] Fetching candidates for prefs:', JSON.stringify(prefs));

  // Step 1: Fetch candidate pool from database
  const candidates = await fetchCandidates(prefs);
  console.log(`[RecommendationEngine] Fetched ${candidates.length} candidates`);

  if (candidates.length === 0) {
    console.log('[RecommendationEngine] No candidates found — returning empty array');
    return [];
  }

  // Step 2: Score + rank all candidates
  const ranked = rankProperties(candidates, prefs);

  // Step 3: Filter by minimum quality threshold
  const qualified = ranked.filter(p => p.score >= SCORE_THRESHOLD);
  console.log(`[RecommendationEngine] ${qualified.length} / ${ranked.length} candidates met score threshold of ${SCORE_THRESHOLD}`);

  // Step 4: Return top N
  const topN = qualified.slice(0, TOP_N);
  console.log(
    '[RecommendationEngine] Top results:',
    topN.map(p => `${p.title} (score=${p.score})`).join(', '),
  );

  return topN;
}
