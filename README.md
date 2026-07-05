# AI Realty Chatbot Server

This is the backend API and conversational intelligence layer for **Sudesh**, a premium AI real estate assistant specializing in Mumbai properties.

> **Supporting Project Note:** This service functions as a standalone microservice supporting the main **AI Realty** portal. It parses search preferences, queries the PostgreSQL database for matching listings, scores candidates deterministically, and presents them conversationally.

---

## 🏗️ Architecture Design

To keep latency low and costs manageable, the system follows a hybrid architecture constraint: **The LLM never queries the database directly.**

```
┌──────────────┐      ┌─────────────────┐      ┌────────────┐
│  User Chat   │ ───> │ Chat Controller │ ───> │ Database   │
│ (Test Client)│      └─────────────────┘      │ (Postgres) │
└──────────────┘               │               └────────────┘
       ▲                       ▼                      │
       │              ┌─────────────────┐             │
       └───────────── │  Gemini Model   │ <───────────┘
                      │ (Presentation)  │  (Factual Match Pool)
                      └─────────────────┘
```

1. **Extraction (Dual-Layer):**
   - **Layer 1 (Fast/Local):** Lightweight regex parsing runs locally on Node.js to instantly extract basic preferences (budget, BHK, localities) at zero cost.
   - **Layer 2 (AI/Schema):** Gemini extracts any remaining implicit preferences in a structured JSON schema constraint (`response_format`).
2. **Retrieval:** Express queries PostgreSQL using Prisma applying flexible locality and price matching.
3. **Scoring:** The backend scores candidate properties on a deterministic `0-100` scale:
   - Budget Match: up to 30 pts (perfect match; partial score if up to 10% over).
   - Bedrooms Match: up to 20 pts.
   - Locality Match: up to 20 pts.
   - Furnishing, transaction type, ready-to-move: 10 pts each.
   - *Filter:* Properties scoring below `50` are filtered out before formatting.
4. **Locality Intelligence & POIs:** The backend pulls JSON-formatted metadata (`Locality.poi` and `Locality.intelligence`) directly from the database during retrieval. It automatically computes whether a listing is a bargain (e.g. *priced 15% below area average*) and lists neighborhood attractions.
5. **Conversational Presentation:** The model receives the raw database results and the calculated locality details inside its `system_instruction` prompt. It uses these facts to present recommendations conversationally.

---

## ⚙️ Stateful Tool Lifecycle

We utilize the new Google GenAI **Interactions API** stateful design:
- Chat turns are managed using server-side interaction tracking via `previous_interaction_id` (no manual history array parsing needed).
- The model invokes the `search_properties` function tool autonomously when preference parameters are met. The backend intercepts the call, queries the database, and submits the results back via a `function_result` step.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js (TypeScript)
- **Framework:** Express.js
- **Database ORM:** Prisma + PostgreSQL
- **AI Platform:** `@google/genai` (JS SDK)
- **Model:** `gemini-3.1-flash-lite` (development/testing) | `gemini-3.5-flash` (production target)

---

## 🚀 Getting Started

### 1. Configuration
Create a `.env` file in the root folder:
```env
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/ai_realty?schema=public"
GEMINI_API_KEY="AIzaSyYourValidGoogleGeminiAPIKey"
```

### 2. Install & Import Dataset
```bash
# Install packages
npm install

# Run database migrations and generate client
npm run db:generate
npm run db:push

# Import the Mumbai property dataset
npm run db:import
```

### 3. Start Development Server
```bash
npm run dev
```

---

## 🧪 Testing the Chatbot

We provide an interactive HTML/CSS UI client for testing:
1. Open [test-client.html](test-client.html) directly in your browser (`file:///` protocol supported).
2. Enter your message (e.g., *"Hi, I want a 2 BHK in Bandra West under 3 Crores"*).
3. The client will connect to your local backend at `http://localhost:3001/api/chat` and show:
   - Chat conversation bubble with Sudesh's replies.
   - Extracted preferences panel updating live on the sidebar.
   - Interactive button to explain matching scores deterministically.
