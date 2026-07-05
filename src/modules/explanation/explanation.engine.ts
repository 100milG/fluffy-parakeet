// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — Explanation Engine
//
// DESIGN DECISION (quota optimisation):
// The explanation engine uses ONLY local, deterministic templates to generate
// "why listing X?" responses. No LLM call is made here.
//
// Rationale: the score breakdown is already a list of facts computed by the
// recommendation scorer. Narrating those facts does not require an LLM —
// a template produces an equivalent result at zero API cost.
// ─────────────────────────────────────────────────────────────────────────────

import { ScoredProperty, UserPreferences } from '../../shared/types/session.types';
import { formatIndianAmount } from '../../shared/utils/currency';



// ─────────────────────────────────────────────────────────────────────────────
// Intent detection
// ─────────────────────────────────────────────────────────────────────────────

const EXPLAIN_PATTERNS = [
  /why\\s+(is\\s+)?(listing|flat|property|option|number|#)?\\s*(\\d+)/i,
  /tell\\s+me\\s+more\\s+about\\s+(listing|flat|option|number|#)?\\s*(\\d+)/i,
  /explain\\s+(listing|flat|property|option|number|#)?\\s*(\\d+)/i,
  /more\\s+(details?|info)\\s+(on|about)\\s+(listing|flat|option|number|#)?\\s*(\\d+)/i,
  /why\\s+(this|that)\\s+(flat|property|option)/i,
];

/**
 * Checks if the user is asking "why listing 2?" or "tell me about flat 1".
 */
export function isExplainIntent(message: string): boolean {
  return EXPLAIN_PATTERNS.some(re => re.test(message));
}

/**
 * Extracts which index listing number the user requested details on.
 * e.g. "tell me more about #2" -> 2
 */
export function extractListingIndex(message: string): number | null {
  for (const re of EXPLAIN_PATTERNS) {
    const match = message.match(re);
    // Find the capture group that contains a number
    if (match) {
      for (let i = 1; i < match.length; i++) {
        if (match[i] && /^\\d+$/.test(match[i])) {
          return parseInt(match[i], 10);
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrative generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a deterministic, template-based explanation for why a property
 * was recommended. No LLM call is made — this is a quota-free operation.
 */
export async function generateExplanation(
  property: ScoredProperty,
  prefs: Partial<UserPreferences>,
  listingNum: number
): Promise<string> {
  console.log(`[ExplanationEngine] Building local explanation for listing #${listingNum} (no API call).`);
  return buildLocalExplanation(property, prefs, listingNum);
}

function buildLocalExplanation(
  property: ScoredProperty,
  prefs: Partial<UserPreferences>,
  listingNum: number
): string {
  const price    = property.price != null ? formatIndianAmount(property.price) : 'competitive price';
  const locality = property.localityName ?? 'your preferred area';
  const b        = property.breakdown;
  const reasons: string[] = [];

  if ((b['budget'] ?? 0) === 30) reasons.push(`priced at ${price}, well within your budget`);
  else if ((b['budget'] ?? 0) > 0) reasons.push(`priced at ${price}, slightly over budget but negotiable`);

  if ((b['beds'] ?? 0) >= 20)     reasons.push(`exactly ${property.beds} BHK as requested`);
  else if ((b['beds'] ?? 0) > 0)  reasons.push(`${property.beds} BHK, close to your bedroom requirement`);

  if ((b['locality'] ?? 0) >= 20) reasons.push(`located in ${locality}, your preferred area`);
  if ((b['furnished'] ?? 0) >= 10) reasons.push(`${property.furnishedStatus?.toLowerCase()} as preferred`);
  if ((b['readyToMove'] ?? 0) > 0) reasons.push(`ready to move in`);
  if ((b['listingType'] ?? 0) > 0) reasons.push(`listed for ${prefs.listingType === 'RENT' ? 'rent' : 'sale'} as requested`);

  const reasonText = reasons.length > 0
    ? reasons.join(', ')
    : 'it broadly matches your stated requirements';

  const sqftNote = property.sqft ? ` The flat is ${property.sqft} sq ft.` : '';

  let marketNote = '';
  if (property.localityIntelligence) {
    const intel = property.localityIntelligence as any;
    const avg = intel.average_price_sqft;
    const listPriceSqft = property.priceSqft || (property.price && property.sqft ? property.price / property.sqft : null);
    if (avg && listPriceSqft) {
      const diff = ((listPriceSqft - avg) / avg) * 100;
      if (diff < -2) {
        marketNote = ` It is priced at ₹${formatIndianAmount(Math.round(listPriceSqft))}/sqft, which is a great deal at **${Math.abs(Math.round(diff))}% below the area average** (₹${formatIndianAmount(avg)}/sqft).`;
      } else if (diff > 2) {
        marketNote = ` It is priced at ₹${formatIndianAmount(Math.round(listPriceSqft))}/sqft, which is slightly above the area average of ₹${formatIndianAmount(avg)}/sqft.`;
      } else {
        marketNote = ` It is priced at a standard ₹${formatIndianAmount(Math.round(listPriceSqft))}/sqft, in line with the area average.`;
      }
    }
  }

  let attractionsNote = '';
  if (property.localityPoi) {
    const poi = property.localityPoi as any;
    const categories: string[] = [];
    if (poi.parks?.length) categories.push(`parks like ${poi.parks.join(', ')}`);
    if (poi.shopping?.length) categories.push(`shopping at ${poi.shopping.join(', ')}`);
    if (poi.schools?.length) categories.push(`schools such as ${poi.schools.join(', ')}`);
    if (poi.dining?.length) categories.push(`dining hot-spots like ${poi.dining.join(', ')}`);
    if (poi.transport?.length) categories.push(`convenient transport links (${poi.transport.join(', ')})`);

    if (categories.length > 0) {
      attractionsNote = ` The neighborhood offers great attractions: ${categories.slice(0, 3).join(', ')}.`;
    }
  }

  return `Listing ${listingNum} — **${property.title}** — scored ${property.score}/100 because ${reasonText}.${sqftNote}${marketNote}${attractionsNote} Would you like to schedule a visit or see more options?`;
}
