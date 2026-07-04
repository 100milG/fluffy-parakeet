// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Scorer
//
// CONCEPT: Deterministic scoring (no LLM)
//
// This function awards points based on how well a property matches the user's
// preferences. It is:
//   - Free (no API calls)
//   - Instant (pure computation)
//   - Testable (given same input, always same output)
//
// Scoring is ADDITIVE. Each signal contributes up to its max points.
// Total possible score = 100.
//
// The LLM never scores — it only PRESENTS the scored results.
// ─────────────────────────────────────────────────────────────────────────────

import { UserPreferences, RawProperty, ScoredProperty } from './types';

// ─── Score weights ────────────────────────────────────────────────────────────
const WEIGHTS = {
  budget:      30,   // Most important
  beds:        20,   // Must match intent
  locality:    20,   // Location is key in Mumbai
  furnished:   10,   // Furnished preference
  readyToMove: 10,   // Must-have for many buyers
  listingType: 10,   // SALE vs RENT must match
} as const;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a single property against the user's accumulated preferences.
 * Returns a ScoredProperty with a numeric score (0–100) and breakdown.
 */
export function scoreProperty(
  property: RawProperty,
  prefs: Partial<UserPreferences>,
): ScoredProperty {
  let score = 0;
  const breakdown: Record<string, number> = {};

  // ── 1. Budget (0–30) ─────────────────────────────────────────────────────
  if (prefs.budgetMax != null && property.price != null) {
    const max = prefs.budgetMax;
    const price = property.price;
    if (price <= max) {
      breakdown['budget'] = WEIGHTS.budget;
    } else if (price <= max * 1.1) {
      const overBy = (price - max) / (max * 0.1);
      breakdown['budget'] = Math.round(WEIGHTS.budget * (1 - overBy));
    } else {
      breakdown['budget'] = 0;
    }
  } else {
    breakdown['budget'] = Math.round(WEIGHTS.budget / 2);
  }

  // ── 2. Bedrooms (0–20) ───────────────────────────────────────────────────
  if (prefs.bedroomsMin != null && property.beds != null) {
    const diff = Math.abs(property.beds - prefs.bedroomsMin);
    if (diff === 0) {
      breakdown['beds'] = WEIGHTS.beds;
    } else if (diff === 1) {
      breakdown['beds'] = Math.round(WEIGHTS.beds / 2);
    } else {
      breakdown['beds'] = 0;
    }
  } else {
    breakdown['beds'] = Math.round(WEIGHTS.beds / 2);
  }

  // ── 3. Locality (0–20) ───────────────────────────────────────────────────
  if (prefs.localities && prefs.localities.length > 0 && property.localityName) {
    const propLocLower = property.localityName.toLowerCase();
    const matched = prefs.localities.some(loc =>
      propLocLower.includes(loc.toLowerCase()) ||
      loc.toLowerCase().includes(propLocLower),
    );
    breakdown['locality'] = matched ? WEIGHTS.locality : 0;
  } else {
    breakdown['locality'] = Math.round(WEIGHTS.locality / 2);
  }

  // ── 4. Furnished status (0–10) ───────────────────────────────────────────
  if (prefs.furnishedStatus && property.furnishedStatus) {
    const match =
      property.furnishedStatus.toLowerCase() === prefs.furnishedStatus.toLowerCase();
    breakdown['furnished'] = match ? WEIGHTS.furnished : 0;
  } else {
    breakdown['furnished'] = Math.round(WEIGHTS.furnished / 2);
  }

  // ── 5. Ready to move (0–10) ──────────────────────────────────────────────
  if (prefs.mustHaves?.includes('ready_to_move')) {
    const isReady =
      property.isResale === true ||
      (property.furnishedStatus != null && property.furnishedStatus !== 'Unfurnished');
    breakdown['readyToMove'] = isReady ? WEIGHTS.readyToMove : 0;
  } else {
    breakdown['readyToMove'] = Math.round(WEIGHTS.readyToMove / 2);
  }

  // ── 6. Listing type (0–10) ───────────────────────────────────────────────
  if (prefs.listingType && property.listingType) {
    breakdown['listingType'] =
      property.listingType === prefs.listingType ? WEIGHTS.listingType : 0;
  } else {
    breakdown['listingType'] = Math.round(WEIGHTS.listingType / 2);
  }

  // ── Total ─────────────────────────────────────────────────────────────────
  score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return { ...property, score, breakdown };
}

/**
 * Score and rank an array of properties. Returns sorted highest-score first.
 */
export function rankProperties(
  properties: RawProperty[],
  prefs: Partial<UserPreferences>,
): ScoredProperty[] {
  return properties
    .map(p => scoreProperty(p, prefs))
    .sort((a, b) => b.score - a.score);
}
