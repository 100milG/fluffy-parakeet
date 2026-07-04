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

---

## 🚧 Upcoming Modules & Technical Designs

### **Module 5 — Structured Outputs & Function Calling Refactor**
Replace custom regex rules with native Gemini tool configurations.
* **Structured Outputs:** Force Gemini to return user preferences matching our exact JSON schema.
* **Function Calling:** Give Gemini a `search_database` function. Gemini decides exactly when to call it.

### **Module 6 — Grounding with Google Maps**
Allows users to ask geographical/lifestyle questions about properties.
* **Commutes:** *"How far is this flat from BKC?"*
* **POIs:** *"Are there hospitals near Listing 2?"*
* **How it works:** Backend fetches the coordinates of the property. Gemini receives the coordinates and calls the Google Maps tool to reply with real-world geographical facts.

### **Module 7 — Semantic Search with Embeddings**
Allows users to search using conceptual/lifestyle sentences instead of keywords.
* **Queries:** *"I want a peaceful area suitable for young children"* or *"Close to IT hubs with high connectivity"*.
* **Technology:** We will implement vector embeddings using `text-embedding-004` and PostgreSQL's `pgvector` extension to compute similarity.

### **Module 8 — Locality Intelligence & POIs**
* Pulls locality metadata from `Locality.poi` and `Locality.intelligence` JSON columns.
* Formats market averages vs listing prices (e.g., *"Andheri West average is ₹18k/sqft; this flat is a deal at ₹15k/sqft"*).

---

## 🛡️ Resilience Design: Gemini Model Cascade Fallback

To bypass rate limits (like 15 RPM on the free tier) and quota blocks, we will implement an automatic fallback cascade. 

### **The Model Chain**
If a model fails due to a `429 (Too Many Requests)` or quota issue, the service automatically retries the call using the next model in the chain:

```
[gemini-2.5-flash] (Best)
        │ 
        ├─── (429 Rate Limited / Out of Quota) ───> [gemini-2.5-flash-lite] (Cheaper, supports Structured Outputs)
                                                             │
                                                             └─── (Failed) ───> [gemini-1.5-flash] (High Quota Limit)
```

### **Hybrid Grounding (Advanced Cost Optimization)**
To save quota on maps grounding (which is only supported on premium models):
1. **Chat/Search:** Routed through cheap models (`gemini-2.5-flash-lite`).
2. **Map Queries:** Only when geographic questions are asked, route a single call to `gemini-2.5-flash` with Google Maps tool grounding.
3. **Synthesis:** Take the result and insert it back into the conversation history of the cheaper model.
