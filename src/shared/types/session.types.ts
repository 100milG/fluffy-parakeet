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
