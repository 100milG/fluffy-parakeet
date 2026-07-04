// ─── Session Types ─────────────────────────────────────────────────────────────
//
// These are the TypeScript interfaces that define the shape of our session data.
// Think of interfaces as contracts — they describe what an object must look like.
//
// Every module in this project will use these types, which is why they live in
// the shared/types directory rather than inside any specific module.

/**
 * A single message in a conversation.
 * 'user'  = message from the person chatting
 * 'model' = response from our AI system
 */
export interface Turn {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

/**
 * Structured preferences we extract from the conversation.
 * All fields are optional because we build this up over multiple turns.
 * Module 2 will fill these in — for now it's always empty.
 */
export interface UserPreferences {
  propertyType?: 'APARTMENT' | 'VILLA' | 'PLOT' | 'OFFICE' | 'SHOP' | 'COMMERCIAL';
  bedroomsMin?: number;
  bedroomsMax?: number;
  budgetMin?: number;   // in INR
  budgetMax?: number;   // in INR
  localities?: string[];
  furnishedStatus?: string;
  listingType?: 'SALE' | 'RENT';
  lifestyle?: string[]; // e.g. ["near IT park", "quiet area"]
  mustHaves?: string[];
}

/**
 * The full session object stored in memory.
 * One session = one user's ongoing conversation with the AI.
 */
export interface Session {
  sessionId: string;
  turns: Turn[];
  preferences: Partial<UserPreferences>;
  lastRecommendations: ScoredProperty[];  // the properties shown in the last recommendation turn
  createdAt: Date;
  lastActiveAt: Date;
}


/**
 * Request body for the POST /api/chat endpoint.
 */
export interface ChatRequest {
  sessionId?: string;  // omit on first message → server creates a new session
  message: string;
}

/**
 * Response body from the POST /api/chat endpoint.
 */
export interface ChatResponse {
  sessionId: string;
  reply: string;
  preferences: Partial<UserPreferences>;  // current extracted preferences
  turnCount: number;                       // how many turns so far
}

// ─── Module 3 — Recommendation Engine Types ──────────────────────────────────

/**
 * A slim representation of a DB property row used inside the recommendation
 * engine. We only pull the fields we need for scoring + display — avoids
 * loading the full Prisma type everywhere.
 */
export interface RawProperty {
  id: string;
  title: string;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  address: string | null;
  localityName: string | null;    // resolved from the Locality relation
  propertyType: string;
  listingType: string;
  furnishedStatus: string | null;
  isResale: boolean;
  priceSqft: number | null;
}

/**
 * A property that has been scored against the user's preferences.
 * The `breakdown` field shows how each signal contributed — used by
 * the explanation engine (Module 4) and for debugging.
 */
export interface ScoredProperty extends RawProperty {
  score: number;                          // 0–100
  breakdown: Record<string, number>;      // signal → points awarded
}
