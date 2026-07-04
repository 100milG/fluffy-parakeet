# AI Realty Chatbot Server

This is the backend API and conversational intelligence layer for **Reeva**, an AI real estate assistant specializing in Mumbai properties.

> **Supporting Project Note:** This service functions as a standalone microservice supporting the main **AI Realty** web portal. It parses search preferences, runs recommendations against the shared PostgreSQL database, and generates contextual explanations.

---

## 🏗️ Architecture Design

To keep latency low and costs manageable, the system follows a hybrid rules-and-LLM model:
* **Preference Extraction:** Clean, regex-based keyword matching extracts parameters like location, BHK size, and budget from chat turns without calling the API.
* **DB Retrieval:** Relational database filters query the property dataset using Prisma.
* **Scoring/Ranking:** A custom, deterministic formula scores properties on a 0–100 scale based on match quality.
* **Presentation & Dialogue:** Gemini 2.5 Flash is used to format, present, and hold natural conversations.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js (TypeScript)
* **Framework:** Express
* **Database ORM:** Prisma (PostgreSQL)
* **AI Model:** Google Generative AI (Gemini 2.5 Flash / Gemini 2.5 Flash Lite)

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have PostgreSQL running locally and have imported the Mumbai real estate dataset.

### 2. Configuration
Create a `.env` file in the root folder with the following credentials:
```env
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/ai_realty?schema=public"
GEMINI_API_KEY="AIzaSyYourValidGoogleGeminiAPIKey"
```

### 3. Install & Start
```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

---

## 🧪 Documentation & Testing

* **Detailed Status & Roadmap:** See [chatbot_status.md](chatbot_status.md) to understand current progress and upcoming modules.
* **Terminal & API Tests:** See [run_and_test.md](run_and_test.md) for pre-written curl and PowerShell queries to test the chatbot's endpoint.
* **Visual UI Client:** Open [test-client.html](test-client.html) directly in your browser to interact with the chatbot using a clean UI.

