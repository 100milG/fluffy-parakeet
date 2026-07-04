import { Router } from 'express';
import {
  handleChat,
  getSessionState,
  healthCheck,
} from '../modules/conversation/chat.controller';
import { perIpRateLimit, globalDailyCap } from '../middleware/rate.limiter';

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT: Express Router
//
// A Router is a mini Express application that handles a group of related routes.
// We define routes here and mount them in app.ts under the /api prefix.
//
// This means:
//   Router: GET /health  →  Full path: GET /api/health
//   Router: POST /chat   →  Full path: POST /api/chat
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Health check — no rate limiting needed for this
router.get('/health', healthCheck);

// Main chat endpoint — rate limited:
//   1. perIpRateLimit  → max 10 messages/minute per IP
//   2. globalDailyCap  → max 150 Gemini calls/day globally
router.post('/chat', perIpRateLimit, globalDailyCap, handleChat);

// Session inspection — for debugging during development
// perIpRateLimit is applied here too to prevent scraping
router.get('/chat/:sessionId', perIpRateLimit, getSessionState);

export default router;
