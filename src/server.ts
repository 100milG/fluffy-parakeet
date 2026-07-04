// ─────────────────────────────────────────────────────────────────────────────
// server.ts — Bootstrap entry point
//
// CONCEPT: Why a separate file?
//
// TypeScript `import` statements are hoisted. This means ALL imports at the
// top of a file run BEFORE any code in the file body — even if you write
// `dotenv.config()` before your other imports, the imports still win.
//
// The solution: put dotenv loading here with `require()`, which is NOT
// hoisted. It runs in the order it appears. Then we import app.ts AFTER
// the env is loaded.
//
// This guarantees that when gemini.service.ts calls `process.env.GEMINI_API_KEY`
// (lazily, on first use), the value is already populated.
// ─────────────────────────────────────────────────────────────────────────────

// Step 1: Load .env FIRST — synchronous, non-hoisted
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

// Step 2: NOW import and start the app
// By this point, process.env has all variables from .env
import './app';
