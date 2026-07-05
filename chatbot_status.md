# AI Realty Chatbot — Status & Roadmap

This document serves as the living source of truth for the **AI Realty Chatbot** project status, architecture, and next steps.

---

## 🛠️ System Architecture Overview

Our system is built on a key constraint: **The LLM (Gemini) must never query the database directly.** 

```
┌──────────────┐      ┌─────────────────┐      ┌────────────┐
│  User Chat   │ ───> │ Chat Controller │ ───> │ Database   │
└──────────────┘      └─────────────────┘      │ (Postgres) │
       ▲                       │               └────────────┘
       │                       ▼                      │
       │              ┌─────────────────┐             │
       └───────────── │ Gemini Model    │ <───────────┘
                      │ (Presentation)  │  (Factual Match Pool)
                      └─────────────────┘
```

1. **Extraction:** Backend uses rule-based extraction to parse the user's message.
2. **Retrieval:** Backend queries PostgreSQL using Prisma (applying budget, locality, and BHK filters).
3. **Scoring:** Backend ranks properties using a deterministic formula (0–100 points).
4. **Presentation:** Gemini receives the raw, matched listings and presents them conversationally.

---

## ✅ Completed Modules

### **Module 1 — Session & Conversation Layer**
- In-memory session tracking utilizing JavaScript `Map` structures.
- Conversation turn history tracking and session expiration timeouts (30-minute TTL).

### **Module 2 — Preference Extraction**
- High-speed, zero-cost deterministic extraction (regex) for localities, BHK count, and budget.
- Cumulative preference merging (preferences accumulate over multiple turns).
- Dual-layer rate limiting:
  - **IP-Based Cap:** 10 requests per minute.
  - **Global Daily Cap:** 150 requests per day.
- Off-topic redirection protection (the Reeva persona will not answer unrelated queries like *"Who is the PM of India"*).

### **Module 3 — Recommendation Engine**
- Prisma query layer using `contains` and `OR` for flexible locality matches (e.g. matching "Andheri" to "Andheri West").
- Additive 0-100 scoring system:
  - Budget match: 30 pts (perfect match; partial score if up to 10% over).
  - Bedrooms match: 20 pts (exact BHK matches; partial score if ±1 BHK).
  - Locality match: 20 pts.
  - Furnishing, ready-to-move status, and listing type: 10 pts each.
- Intent detection triggers recommendations when the user explicitly asks or when all preferences are gathered.

### **Module 4 — Explanation Engine**
- Extracts when the user asks *"why listing X?"* and short-circuits the pipeline.
- Automatically saves the last shown recommendations to the user's session.
- Feeds the calculated score breakdown to Gemini to explain the recommendation.
- **Visual Client:** HTML/CSS test client ([test-client.html](test-client.html)) created to test chat and view extracted preferences live in the browser.

### **Module 5 — Structured Outputs, Function Calling & Score Threshold**
- Migrated from deprecated `@google/generative-ai` to the new `@google/genai` (≥ 2.0.0) SDK.
- Implemented structured preference extraction schema using responseSchema constraints.
- Created `search_properties` function tool which Reeva autonomously invokes when preferences are collected and the user is ready.
- Implemented step execution handler loop resolving queries on PostgreSQL and submitting results back to the model.
- Added **score threshold filter** (`SCORE_THRESHOLD = 50`): properties scoring below 50/100 are excluded before presenting results. If nothing qualifies, Reeva handles it conversationally.

### **Module 6 — Grounding with Google Maps**
- Added regex classifier to detect geographical, travel, and commute-related queries.
- Built a grounded query builder extracting property latitude/longitude coordinates and address fields from PostgreSQL candidates.
- Implemented hybrid routing executing grounded queries on `gemini-2.5-flash` with the `googleSearch` grounding tool cited sources.

### **Module 8 — Locality Intelligence & POIs**
- Mapped schema columns for `localityPoi` and `localityIntelligence` in database queries.
- Dynamically calculated bargain deals (listing price/sqft vs area average).
- Embedded localized neighborhood highlights (parks, schools, dining, transit) into Gemini's system instructions.

---

## 🚧 Upcoming Modules & Technical Designs

### **Module 7 — Semantic Search with Embeddings**
Allows users to search using conceptual/lifestyle sentences instead of keywords.
* **Queries:** *"I want a peaceful area suitable for young children"* or *"Close to IT hubs with high connectivity"*.
* **Technology:** We will implement vector embeddings using `text-embedding-004` and PostgreSQL's `pgvector` extension to compute similarity.

---

## ⚙️ Active Models & Hybrid Routing

We use a hybrid model routing setup using the Interactions API:

1. **Standard Conversation:** `gemini-3.1-flash-lite` handles general user preferences, completeness checks, and recommendation execution.
2. **Maps Grounding Queries:** `gemini-3.1-flash-lite` with the `google_maps` grounding tool handles commute, travel time, and transit queries.

To upgrade standard flows to production, configure:
- `ACTIVE_MODEL = 'gemini-3.5-flash'` in `src/modules/extraction/gemini.service.ts` and `src/modules/explanation/explanation.engine.ts`.
