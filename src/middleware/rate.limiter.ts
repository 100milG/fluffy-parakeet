import { Request, Response, NextFunction } from 'express';

// ── Configuration ──────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1000;         // 1 minute
const MAX_PER_IP = 10;               // max requests per IP/minute
const DAILY_GEMINI_LIMIT = 150;      // max Gemini calls per day globally

// ── Per-IP store ──────────────────────────────────────────────────────────
interface IpRecord {
  count: number;
  windowStart: number;
}
const ipStore = new Map<string, IpRecord>();

// ── Daily counter ─────────────────────────────────────────────────────────
let dailyCount = 0;
let dayStart = startOfDay();

function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function resetDailyIfNeeded(): void {
  const now = Date.now();
  if (now - dayStart >= 24 * 60 * 60 * 1000) {
    dailyCount = 0;
    dayStart = startOfDay();
    console.log('[RateLimiter] Daily counter reset.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-IP rate limit middleware
// ─────────────────────────────────────────────────────────────────────────────
export function perIpRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.ip
    ?? 'unknown';

  const now = Date.now();
  const record = ipStore.get(ip);

  if (!record || now - record.windowStart > WINDOW_MS) {
    // First request in this window — initialise counter
    ipStore.set(ip, { count: 1, windowStart: now });
    next();
    return;
  }

  if (record.count >= MAX_PER_IP) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - record.windowStart)) / 1000);
    console.warn(`[RateLimiter] IP ${ip} rate limited. Retry after ${retryAfter}s`);
    res.status(429).json({
      error: 'Too many requests. Please slow down and try again in a minute.',
      retryAfterSeconds: retryAfter,
    });
    return;
  }

  record.count++;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Global daily cap middleware
// ─────────────────────────────────────────────────────────────────────────────
export function globalDailyCap(_req: Request, res: Response, next: NextFunction): void {
  resetDailyIfNeeded();

  if (dailyCount >= DAILY_GEMINI_LIMIT) {
    console.warn(`[RateLimiter] Daily Gemini limit (${DAILY_GEMINI_LIMIT}) reached.`);
    res.status(503).json({
      error: 'The AI assistant has reached its daily usage limit. Please try again tomorrow.',
      limit: DAILY_GEMINI_LIMIT,
    });
    return;
  }
  dailyCount++;
  console.log(`[RateLimiter] Gemini call #${dailyCount}/${DAILY_GEMINI_LIMIT} today.`);
  next();
}
export function getRateLimitStats() {
  resetDailyIfNeeded();
  return {
    geminiCallsToday: dailyCount,
    geminiDailyLimit: DAILY_GEMINI_LIMIT,
    geminiCallsRemaining: Math.max(0, DAILY_GEMINI_LIMIT - dailyCount),
  };
}
