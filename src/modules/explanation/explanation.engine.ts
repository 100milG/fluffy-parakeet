// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — Explanation Engine
//
// CONCEPT: Why do we need an explanation engine?
//
// The recommendation scorer (Module 3) already computes a "breakdown" for each
// property — it knows exactly why each property scored what it did:
//   { budget: 30, beds: 20, locality: 20, furnished: 5, readyToMove: 5, listingType: 5 }
//
// Without this module, that breakdown is invisible to the user.
//
// The explanation engine takes that numeric breakdown and asks Gemini to turn
// it into a friendly, human-readable explanation. This is a good example of
// "LLM as a formatter" — using the LLM only to present data, not to generate
// or invent it.
//
// CONCEPT: What the LLM does vs. what the code does
//   Code  → computes exact scores (deterministic, free, testable)
//   LLM   → narrates the scores (natural language, contextual)
//
// We NEVER ask Gemini "why is this a good property?" — that would let it
// hallucinate. We only ask it to narrate facts we already computed.
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from '@google/generative-ai';
import { ScoredProperty, UserPreferences } from '../../shared/types/session.types';
import { formatIndianAmount } from '../../shared/utils/currency';


// Lazy Gemini client
let _genAI: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection
// ─────────────────────────────────────────────────────────────────────────────

const EXPLAIN_PATTERNS = [
  /why\s+(is\s+)?(listing|flat|property|option|number|#)?\s*(\d+)/i,
  /tell\s+me\s+more\s+about\s+(listing|flat|option|number|#)?\s*(\d+)/i,
  /explain\s+(listing|flat|property|option|number|#)?\s*(\d+)/i,
  /more\s+(details?|info)\s+(on|about)\s+(listing|flat|option|number|#)?\s*(\d+)/i,
  /why\s+(this|that)\s+(flat|property|option)/i,
  /why\s+did\s+you\s+(recommend|suggest|show)/i,
  /what\s+makes\s+(listing|flat|option|number|#)?\s*(\d+)/i,
];

export function isExplainIntent(message: string): boolean {
  return EXPLAIN_PATTERNS.some(re => re.test(message));
}

export function extractListingIndex(message: string): number | null {
  const match = message.match(/(?:listing|flat|property|option|number|#)\s*(\d+)/i)
    ?? message.match(/\b(\d+)(?:st|nd|rd|th)?\s*(?:listing|flat|option|one)?\b/i);
  if (match) {
    const n = parseInt(match[1]!, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Explanation generator
// ─────────────────────────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  budget:      'Budget fit',
  beds:        'Bedroom match',
  locality:    'Location match',
  furnished:   'Furnishing preference',
  readyToMove: 'Ready to move in',
  listingType: 'Sale/Rent type',
};

const MAX_SCORE: Record<string, number> = {
  budget: 30, beds: 20, locality: 20, furnished: 10, readyToMove: 10, listingType: 10,
};

export async function generateExplanation(
  property: ScoredProperty,
  prefs: Partial<UserPreferences>,
  listingNum: number,
): Promise<string> {
  const factLines: string[] = [];

  for (const [signal, points] of Object.entries(property.breakdown)) {
    const label = SIGNAL_LABELS[signal] ?? signal;
    const max   = MAX_SCORE[signal] ?? 10;
    const pct   = Math.round((points / max) * 100);

    let detail = '';
    if (signal === 'budget' && property.price != null) {
      detail = `property price ${formatIndianAmount(property.price)} vs. user budget ${prefs.budgetMax ? formatIndianAmount(prefs.budgetMax) : '?'}`;
    } else if (signal === 'beds') {
      detail = `${property.beds ?? '?'} beds, user wants ${prefs.bedroomsMin ?? '?'}`;
    } else if (signal === 'locality') {
      detail = `${property.localityName ?? 'unknown'} vs. ${(prefs.localities ?? []).join(', ')}`;
    } else if (signal === 'furnished') {
      detail = `${property.furnishedStatus ?? 'unknown'}`;
    } else if (signal === 'readyToMove') {
      detail = property.isResale ? 'resale / ready to move' : 'new / not yet ready';
    }

    factLines.push(`- ${label}: ${points}/${max} pts (${pct}%)${detail ? ' — ' + detail : ''}`);
  }

  const price    = property.price   != null ? formatIndianAmount(property.price) : 'Price on request';
  const sqft     = property.sqft    != null ? `${property.sqft} sq ft` : 'Size not listed';
  const locality = property.localityName ?? 'Mumbai';


  const prompt = `You are Reeva, a friendly Mumbai real estate consultant.

The user asked why Listing ${listingNum} was recommended. Here is the factual data:

Property: ${property.title}
Location: ${locality}
Price: ${price}
Size: ${sqft}
Bedrooms: ${property.beds ?? '?'} BHK
Furnished: ${property.furnishedStatus ?? 'Not specified'}
Total match score: ${property.score}/100

Score breakdown (how well each signal matched the user's needs):
${factLines.join('\n')}

Write a short, friendly explanation (3-5 sentences) for why this property was recommended.
Rules:
- Only mention facts from the data above, do not invent anything
- Use Indian English naturally (say "flat" not "apartment", use Rs. for prices)
- Be warm but concise
- End by asking if they want to schedule a visit or see more options`;

  try {
    const model = getClient().getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('[ExplanationEngine] Gemini error:', err);
    return buildFallbackExplanation(property, prefs, listingNum);
  }
}

function buildFallbackExplanation(
  property: ScoredProperty,
  prefs: Partial<UserPreferences>,
  listingNum: number,
): string {
  const price    = property.price != null ? formatIndianAmount(property.price) : 'competitive price';
  const locality = property.localityName ?? 'your preferred area';
  const reasons: string[] = [];
  const b = property.breakdown;

  if ((b['budget'] ?? 0) >= 25) reasons.push(`priced at ${price}, within your budget`);
  if ((b['beds'] ?? 0) >= 20)   reasons.push(`exactly ${property.beds} BHK as requested`);
  if ((b['locality'] ?? 0) >= 20) reasons.push(`located in ${locality}`);
  if ((b['furnished'] ?? 0) >= 10) reasons.push(`${property.furnishedStatus} as preferred`);

  const reasonText = reasons.length > 0
    ? reasons.join(', ')
    : 'it matches several of your key requirements';

  return `Listing ${listingNum} scored ${property.score}/100 because ${reasonText}. Would you like to schedule a visit or see more options?`;
}

