import { Router } from 'express';
import {
  handleChat,
  getSessionState,
  healthCheck,
} from '../modules/conversation/chat.controller';
import { perIpRateLimit, globalDailyCap } from '../middleware/rate.limiter';

const router = Router();

// Health check
router.get('/health', healthCheck);

// Main chat endpoint (rate-limited)
router.post('/chat', perIpRateLimit, globalDailyCap, handleChat);

// Session inspection
router.get('/chat/:sessionId', perIpRateLimit, getSessionState);

export default router;
