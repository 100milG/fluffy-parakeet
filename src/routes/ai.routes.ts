import { Router } from 'express';
import {
  handleChat,
  getSessionState,
  healthCheck,
} from '../modules/conversation/chat.controller';

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

// Health check — always define this first so you can quickly verify the server is up
router.get('/health', healthCheck);

// Main chat endpoint
router.post('/chat', handleChat);

// Session inspection — for debugging during development
router.get('/chat/:sessionId', getSessionState);

export default router;
