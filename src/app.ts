import express from 'express';
import aiRoutes from './routes/ai.routes';

// Note: dotenv is loaded in server.ts BEFORE this file is imported.
// process.env is already populated by the time this code runs.

const app = express();
const PORT = process.env.PORT ?? 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
//
// CONCEPT: Middleware
// Middleware are functions that run before your route handlers.
// express.json() parses incoming request bodies as JSON automatically.
// Without it, req.body would always be undefined.
//
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
//
// We mount all AI routes under /api.
// The router internally defines /health, /chat, /chat/:sessionId
// which become /api/health, /api/chat, /api/chat/:sessionId
//
app.use('/api', aiRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 AI Chatbot server running on http://localhost:${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  POST http://localhost:${PORT}/api/chat`);
  console.log(`  GET  http://localhost:${PORT}/api/chat/:sessionId`);
  console.log(`\nModule 2 — Preference Extraction + Gemini live.\n`);
});

export default app;
