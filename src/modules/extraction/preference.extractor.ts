// ─────────────────────────────────────────────────────────────────────────────
// Module 2 — Preference Extractor (Rule-Based / Deterministic)
//
// CONCEPT: Why rule-based first?
//
// LLMs (like Gemini) cost money per call and add ~1-2 seconds of latency.
// But many user phrases follow VERY predictable patterns:
//   "2 BHK" → beds = 2
//   "under 80 lakhs" → budgetMax = 8_000_000
//   "Andheri" → locality = "Andheri"
//
// We can extract these with zero cost, zero latency using regex.
// Only when the message is ambiguous do we fall back to Gemini.
//
// CONCEPT: Cumulative extraction
//
// We don't re-extract from scratch every turn.
// We merge each new extraction ON TOP of the existing session preferences.
// So if the user says "Andheri" on turn 1 and "2 BHK" on turn 2, by turn 2
// we know both locality AND bedrooms — even though neither message said both.
// ─────────────────────────────────────────────────────────────────────────────

import { UserPreferences } from '../../shared/types/session.types';

// ─── Budget helpers ──────────────────────────────────────────────────────────
//
// CONCEPT: Indian number system
// "1 lakh" = 100,000 INR
// "1 crore" = 10,000,000 INR
// We store everything in INR integers so comparison is trivial.
//
const LAKH = 100_000;
const CRORE = 10_000_000;

/**
 * Parse an Indian currency string into INR.
 * Examples:
 *   "80 lakhs"   → 8_000_000
 *   "1.5 crore"  → 15_000_000
 *   "50L"        → 5_000_000
 *   "2cr"        → 20_000_000
 */
function parseIndianAmount(value: string, unit: string): number {
  const num = parseFloat(value.replace(/,/g, ''));
  const u = unit.toLowerCase();
  if (u.startsWith('cr')) return Math.round(num * CRORE);
  if (u.startsWith('l')) return Math.round(num * LAKH);
  return Math.round(num);           // assume raw INR if no unit matched
}

// ─── Locality database ────────────────────────────────────────────────────────
//
// CONCEPT: Fuzzy locality matching
//
// The user might type "andheri", "Andheri West", "andheri w" etc.
// Instead of exact matching we check if any known locality keyword appears
// anywhere in the lowercased message.
//
// This list covers the most common Mumbai areas found in our dataset.
// The extractor will grow this list over time.
//
const KNOWN_LOCALITIES: string[] = [
  // Western suburbs
  'Andheri', 'Bandra', 'Juhu', 'Versova', 'Santacruz', 'Khar', 'Vile Parle',
  'Goregaon', 'Malad', 'Kandivali', 'Borivali', 'Dahisar',
  // Eastern suburbs
  'Kurla', 'Ghatkopar', 'Vikhroli', 'Powai', 'Chembur', 'Govandi', 'Mulund',
  'Bhandup', 'Nahur', 'Kanjurmarg',
  // Central / South
  'Dadar', 'Parel', 'Worli', 'Lower Parel', 'Matunga', 'Sion', 'Wadala',
  'Mahim', 'Dharavi', 'Chunabhatti',
  // South Mumbai
  'Colaba', 'Cuffe Parade', 'Nariman Point', 'Fort', 'Marine Lines',
  'Malabar Hill', 'Walkeshwar', 'Breach Candy', 'Kemp\'s Corner',
  // Thane / Navi Mumbai
  'Thane', 'Navi Mumbai', 'Vashi', 'Kharghar', 'Panvel', 'Nerul',
  'Belapur', 'Airoli', 'Ghansoli', 'Turbhe', 'Rabale', 'Kopar Khairane',
  // Misc
  'Mira Road', 'Bhayander', 'Vasai', 'Nalasopara', 'Virar', 'Vasai Road',
  'Dombivli', 'Kalyan', 'Ambernath', 'Badlapur',
];

// Pre-lowercase for comparison
const LOCALITY_LOWER = KNOWN_LOCALITIES.map(l => l.toLowerCase());

// ─── Property type mapping ────────────────────────────────────────────────────
const PROPERTY_TYPE_MAP: Record<string, UserPreferences['propertyType']> = {
  'flat': 'APARTMENT',
  'apartment': 'APARTMENT',
  'bhk': 'APARTMENT',      // "2 BHK" almost always means apartment
  'villa': 'VILLA',
  'bungalow': 'VILLA',
  'house': 'VILLA',
  'independent house': 'VILLA',
  'plot': 'PLOT',
  'land': 'PLOT',
  'office': 'OFFICE',
  'shop': 'SHOP',
  'commercial': 'COMMERCIAL',
};

// ─── Furnished status mapping ─────────────────────────────────────────────────
const FURNISHED_MAP: Record<string, string> = {
  'fully furnished': 'Furnished',
  'fully-furnished': 'Furnished',
  'semi furnished': 'Semi-Furnished',
  'semi-furnished': 'Semi-Furnished',
  'unfurnished': 'Unfurnished',
  'bare shell': 'Unfurnished',
};

// ─────────────────────────────────────────────────────────────────────────────
// Main extractor function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts structured preferences from a single user message using
 * deterministic regex rules.
 *
 * Returns a PARTIAL preference object — only the fields we successfully
 * extracted. The caller merges this with the existing session preferences.
 *
 * @param message - The raw user message text
 * @returns Partial<UserPreferences> containing whatever we found
 */
export function extractPreferences(message: string): Partial<UserPreferences> {
  const msg = message.toLowerCase().trim();
  const extracted: Partial<UserPreferences> = {};

  // ── 1. Budget ────────────────────────────────────────────────────────────
  //
  // Handles patterns like:
  //   "under 80 lakhs", "below 1.5 crores", "max 50L"
  //   "around 2 cr", "budget 80 lakh"
  //   "between 50 and 80 lakhs", "50 to 80 lakhs"
  //

  // Range: "50 to 80 lakhs" / "between 50 and 80 lakhs"
  const rangeMatch = msg.match(
    /(?:between\s+)?(\d+(?:\.\d+)?)\s*(?:to|-|and)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
  );
  if (rangeMatch) {
    extracted.budgetMin = parseIndianAmount(rangeMatch[1]!, rangeMatch[3]!);
    extracted.budgetMax = parseIndianAmount(rangeMatch[2]!, rangeMatch[3]!);
  } else {
    // Single bound with qualifier: "under", "below", "max", "upto", "up to"
    const maxMatch = msg.match(
      /(?:under|below|max|maximum|upto|up to|within|budget\s+of?)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
    );
    if (maxMatch) {
      extracted.budgetMax = parseIndianAmount(maxMatch[1]!, maxMatch[2]!);
    }

    // "around", "approximately", "about", "atleast", "minimum", "starting from"
    const minMatch = msg.match(
      /(?:atleast|at least|minimum|min|starting from|above|more than)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
    );
    if (minMatch) {
      extracted.budgetMin = parseIndianAmount(minMatch[1]!, minMatch[2]!);
    }

    // "around X lakhs" with no qualifier
    const aroundMatch = msg.match(
      /(?:around|approximately|about|~)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
    );
    if (aroundMatch && !extracted.budgetMin && !extracted.budgetMax) {
      const amount = parseIndianAmount(aroundMatch[1]!, aroundMatch[2]!);
      extracted.budgetMin = Math.round(amount * 0.85);  // ±15% band
      extracted.budgetMax = Math.round(amount * 1.15);
    }
  }

  // ── 2. Bedrooms ──────────────────────────────────────────────────────────
  //
  // Handles: "2 BHK", "3 bhk", "2 bedroom", "2-bedroom",
  //          "two bedrooms", "studio", "1rk"

  const bedroomMatch = msg.match(/(\d)\s*(?:bhk|bed|bedroom|bedrooms|br|-bed)/i);
  if (bedroomMatch) {
    extracted.bedroomsMin = parseInt(bedroomMatch[1]!);
    extracted.bedroomsMax = parseInt(bedroomMatch[1]!);
  } else if (/\bstudio\b/.test(msg) || /\b1\s*rk\b/i.test(msg)) {
    extracted.bedroomsMin = 0;
    extracted.bedroomsMax = 0;
  }

  // ── 3. Property type ─────────────────────────────────────────────────────
  for (const [keyword, type] of Object.entries(PROPERTY_TYPE_MAP)) {
    if (msg.includes(keyword)) {
      extracted.propertyType = type;
      break;
    }
  }

  // ── 4. Localities ────────────────────────────────────────────────────────
  //
  // CONCEPT: We allow MULTIPLE localities.
  // User might say "Andheri or Powai" — we capture both.
  //
  const foundLocalities: string[] = [];
  LOCALITY_LOWER.forEach((localityLower, i) => {
    if (msg.includes(localityLower)) {
      foundLocalities.push(KNOWN_LOCALITIES[i]!);
    }
  });
  if (foundLocalities.length > 0) {
    extracted.localities = foundLocalities;
  }

  // ── 5. Listing type ──────────────────────────────────────────────────────
  if (/\brent\b|\brenting\b|\bon rent\b|\bfor rent\b|\blease\b/.test(msg)) {
    extracted.listingType = 'RENT';
  } else if (/\bbuy\b|\bpurchase\b|\bfor sale\b|\bsale\b|\bbuying\b/.test(msg)) {
    extracted.listingType = 'SALE';
  }

  // ── 6. Ready to move / Under construction ────────────────────────────────
  if (/ready\s*to\s*move|ready\s*possession|immediate\s*possession/.test(msg)) {
    extracted.mustHaves = [...(extracted.mustHaves ?? []), 'ready_to_move'];
  } else if (/under\s*construction|uc\s+project|new\s*launch/.test(msg)) {
    extracted.mustHaves = [...(extracted.mustHaves ?? []), 'under_construction'];
  }

  // ── 7. Furnished status ──────────────────────────────────────────────────
  for (const [keyword, status] of Object.entries(FURNISHED_MAP)) {
    if (msg.includes(keyword)) {
      extracted.furnishedStatus = status;
      break;
    }
  }

  // ── 8. Lifestyle / keywords ──────────────────────────────────────────────
  const lifestyleKeywords: Record<string, string> = {
    'near metro': 'near_metro',
    'metro connectivity': 'near_metro',
    'near school': 'near_school',
    'near hospital': 'near_hospital',
    'it park': 'near_it_park',
    'it hub': 'near_it_park',
    'tech park': 'near_it_park',
    'quiet': 'quiet_area',
    'peaceful': 'quiet_area',
    'gated community': 'gated_community',
    'society': 'gated_community',
    'sea view': 'sea_view',
    'sea facing': 'sea_view',
    'garden view': 'garden_view',
    'parking': 'parking',
    'car park': 'parking',
    'balcony': 'has_balcony',
    'terrace': 'has_balcony',
    'gym': 'gym',
    'clubhouse': 'clubhouse',
    'swimming pool': 'swimming_pool',
    'pool': 'swimming_pool',
    'lift': 'has_lift',
    'elevator': 'has_lift',
  };

  const lifestyle: string[] = [];
  for (const [keyword, tag] of Object.entries(lifestyleKeywords)) {
    if (msg.includes(keyword) && !lifestyle.includes(tag)) {
      lifestyle.push(tag);
    }
  }
  if (lifestyle.length > 0) {
    extracted.lifestyle = lifestyle;
  }

  return extracted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preference merger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merges newly extracted preferences INTO the existing session preferences.
 *
 * Rules:
 * - New values ALWAYS override old values (user can correct themselves)
 * - Arrays (localities, lifestyle, mustHaves) are UNIONED, not replaced
 *
 * @param existing - The current session preferences (mutated in-place)
 * @param newPrefs - Freshly extracted preferences from latest message
 */
export function mergePreferences(
  existing: Partial<UserPreferences>,
  newPrefs: Partial<UserPreferences>
): Partial<UserPreferences> {
  const merged = { ...existing };

  if (newPrefs.propertyType !== undefined) merged.propertyType = newPrefs.propertyType;
  if (newPrefs.bedroomsMin !== undefined)  merged.bedroomsMin  = newPrefs.bedroomsMin;
  if (newPrefs.bedroomsMax !== undefined)  merged.bedroomsMax  = newPrefs.bedroomsMax;
  if (newPrefs.budgetMin !== undefined)    merged.budgetMin    = newPrefs.budgetMin;
  if (newPrefs.budgetMax !== undefined)    merged.budgetMax    = newPrefs.budgetMax;
  if (newPrefs.furnishedStatus !== undefined) merged.furnishedStatus = newPrefs.furnishedStatus;
  if (newPrefs.listingType !== undefined)  merged.listingType  = newPrefs.listingType;

  // Arrays: union (no duplicates)
  if (newPrefs.localities?.length) {
    const set = new Set([...(existing.localities ?? []), ...newPrefs.localities]);
    merged.localities = [...set];
  }
  if (newPrefs.lifestyle?.length) {
    const set = new Set([...(existing.lifestyle ?? []), ...newPrefs.lifestyle]);
    merged.lifestyle = [...set];
  }
  if (newPrefs.mustHaves?.length) {
    const set = new Set([...(existing.mustHaves ?? []), ...newPrefs.mustHaves]);
    merged.mustHaves = [...set];
  }

  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Completeness checker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines which CRITICAL fields are still missing.
 *
 * We consider three fields "must-have" before we can show recommendations:
 *   1. Localities (where?)
 *   2. budgetMax  (how much?)
 *   3. bedroomsMin (how big?)
 *
 * Returns a list of field names that are missing.
 */
export function getMissingFields(prefs: Partial<UserPreferences>): string[] {
  const missing: string[] = [];
  if (!prefs.localities?.length)                missing.push('localities');
  if (prefs.budgetMax === undefined)             missing.push('budget');
  if (prefs.bedroomsMin === undefined && prefs.propertyType !== 'PLOT') {
    missing.push('bedrooms');
  }
  return missing;
}

/**
 * Generates a natural follow-up question for the first missing field.
 * Returns null if nothing is missing (user has given enough info).
 */
export function generateFollowUp(missing: string[]): string | null {
  if (missing.length === 0) return null;

  const field = missing[0]!;

  const questions: Record<string, string> = {
    localities: 'Which area or neighbourhood in Mumbai are you looking in? (e.g. Andheri, Bandra, Powai)',
    budget: 'What is your budget range? (e.g. under 80 lakhs, between 1–1.5 crores)',
    bedrooms: 'How many bedrooms do you need? (e.g. 1 BHK, 2 BHK, studio)',
  };

  return questions[field] ?? 'Could you tell me more about what you\'re looking for?';
}
