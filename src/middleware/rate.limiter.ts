// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter Middleware
//
// CONCEPT: Why rate limiting?
//
// The Gemini free tier has per-minute and per-day limits.
// Without a rate limiter, a single misbehaving client (or a test loop)
// can exhaust your entire daily quota in seconds.
//
// We implement TWO layers of protection:
//
//  1. Per-IP rate limit  — 10 requests per minute per IP address
//     Prevents a single user from spamming the chat endpoint.
//
//  2. Global daily cap   — 150 Gemini calls per day (free tier: 1500/day)
//     Protects your overall quota. 150 = ~10% of free tier limit.
//     Adjust DAILY_GEMINI_LIMIT if you upgrade your plan.
//
// CONCEPT: In-memory counting
//
// We use a simple Map to track request counts.
// Each IP gets an entry { count, windowStart }.
// Every 60 seconds we reset the count for that IP.
//
// This is NOT production-grade (wouldn't survive a server restart,
// won't work across multiple servers). For production, use Redis.
// But for a free-tier personal project, this is exactly right.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';

// ── Configuration ──────────────────────────────────────────────────────────
const WINDOW_MS       = 60 * 1000;   // 1 minute window
const MAX_PER_IP      = 10;          // max requests per IP per minute
const DAILY_GEMINI_LIMIT = 150;      // max Gemini calls per day across all users

// ── Per-IP store ──────────────────────────────────────────────────────────
interface IpRecord {
  count: number;
  windowStart: number;
}
const ipStore = new Map<string, IpRecord>();

// ── Daily counter ─────────────────────────────────────────────────────────
let dailyCount   = 0;
let dayStart     = startOfDay();

function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function resetDailyIfNeeded(): void {
  const now = Date.now();
  if (now - dayStart >= 24 * 60 * 60 * 1000) {
    dailyCount = 0;
    dayStart   = startOfDay();
    console.log('[RateLimiter] Daily counter reset.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-IP rate limit middleware
// Apply this to the POST /api/chat route only.
// ─────────────────────────────────────────────────────────────────────────────
export function perIpRateLimit(req: Request, res: Response, next: NextFunction): void {
  // CONCEPT: Getting the client IP
  // Behind a proxy (Nginx, cloud load balancer), the real IP is in
  // X-Forwarded-For. We fall back to req.ip if that header isn't present.
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
// Apply this to the POST /api/chat route AFTER perIpRateLimit.
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

// ─────────────────────────────────────────────────────────────────────────────
// Stats — expose for the /health endpoint
// ─────────────────────────────────────────────────────────────────────────────
export function getRateLimitStats() {
  resetDailyIfNeeded();
  return {
    geminiCallsToday: dailyCount,
    geminiDailyLimit: DAILY_GEMINI_LIMIT,
    geminiCallsRemaining: Math.max(0, DAILY_GEMINI_LIMIT - dailyCount),
  };
}
