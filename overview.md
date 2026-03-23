# 🛡️ TruthScope: Project Overview & Architecture

**TruthScope** is a full-stack, AI-powered fact-checking and media forensics ecosystem. It is designed to verify textual claims, scrutinize media for AI generation (deepfakes), and instantly track verified content back to the user's dashboard utilizing a single source of truth database.

This document serves as the ultimate high-level technical overview of how TruthScope functions, the architectural decisions, and the data linkage.

---

## 🏗️ Directory Structure Overview

The project is split into two primary environments:

```text
TruthScope-Final/
├── extension/                   # The Chrome Browser Extension 
│   ├── .env                     # Extension-specific environment variables
│   ├── manifest.json            # Chrome V3 Extension config
│   ├── background.js            # API communication and background listening
│   └── popup/                   # Frontend UI for the Chrome Extension
│
└── landing/                     # The Next.js Web App & Python FastAPI Backend
    ├── app/                     # Next.js 14 Web UI (App Router)
    │   ├── fact-check/          # The main web dashboard for manual verification
    │   ├── fact-check/history/  # Personalized Fact-Check history fetching from DB
    │   └── fact-check/report/   # Detailed view of a verified job
    ├── components/              # Native React UI components (Tailwind, Lucide)
    │
    └── fact-check-api/          # Python 3.10+ FastAPI Backend Services
        ├── .env                 # Secret Keys (Gemini, Tavily, NeonDB, HF)
        ├── main.py              # Core FastApi Routing & Job initialization
        ├── requirements.txt     # Python Dependencies
        │
        ├── models/              # Database Schema & Pydantic Validation
        │   ├── database.py      # SQLAlchemy config to NeonDB PostgreSQL
        │   └── schemas.py       # Pydantic schemas for API typing
        │
        ├── pipeline/            # The Core Fact-Checking DAG Pipeline
        │   ├── scraper.py       # Extracts raw text from URL links
        │   ├── claim_extractor.py # Gemini-powered atomic claim decomposer
        │   ├── search_agent.py  # Tavily-powered evidence gathering
        │   ├── verifier.py      # Gemini-powered logical claim verifier
        │   └── report_builder.py # Aggregates the score and outputs JSON
        │
        └── utils/
            └── gemini_client.py # Base wrapper for Gemini Flash LLM API
```

---

## ⚙️ How the Ecosystem Works

TruthScope operates across two major clients (the **Web App** and the **Chrome Extension**), but both route back to the exact same central `fact-check-api` backend.

### 1. The Fact-Checking Pipeline (The "Brain")
Whenever a user submits an article (or a URL) via the Website or clicks "Analyze" within the Chrome Extension, the request hits the **Python FastAPI** backend in `landing/fact-check-api/main.py`.

The backend processes the request in a **Directed Acyclic Graph (DAG)** pipeline:
1. **Deduplication Check:** The backend immediately calculates an MD5 `url_hash`. It checks the NeonDB database (`FactCheckReport` table) to see if this URL was already verified by anyone else. If it was, it skips the LLM processing and clones the result immediately!
2. **Extraction:** If new, `pipeline/scraper.py` extracts the text. `pipeline/claim_extractor.py` asks Gemini 2.5 Flash to break the text down into individual, verifiable claims.
3. **Evidence Gathering:** `pipeline/search_agent.py` takes every single claim and queries the **Tavily API** to scrape live news and academic sources for supporting or refuting evidence.
4. **Verification:** `pipeline/verifier.py` compares the original claim against the Tavily evidence using Gemini to output a discrete verdict (`TRUE`, `FALSE`, `MISLEADING`, `UNVERIFIABLE`).
5. **Report Build:** `pipeline/report_builder.py` calculates the overall credibility score and bundles everything into a massive JSON object.

### 2. Media Forensics (Image Deepfakes)
If a user submits an image, the backend bypasses the text pipeline and sends the binary data to the **Hugging Face Inference API** (`umm-maybe/AI-image-detector`), returning a percentage score of whether the media is synthetic or real. 

---

## 🗄️ Database Integration & Linking

TruthScope uses a highly optimized, single-table PostgreSQL database hosted on **NeonDB**. It is controlled via **SQLAlchemy** inside `landing/fact-check-api/models/database.py`.

### The `FactCheckReport` Table
To eliminate redundancy and keep both the Chrome Extension and Web Dashboard fully synced, we utilize exactly **one authoritative table** named `FactCheckReport`.

**Key Columns:**
*   `id` (Primary Key): Standard integer ID.
*   `job_id`: A unique UUID for each specific run/report.
*   `url_hash`: The MD5 Hash of the URL. This acts as our deduplication anchor.
*   `user_id`: The Clerk Authentication ID of the user who requested the scan.
*   `source`: Denotes if the scan originated from the `"website"` or `"extension"`.
*   `report_json` / `claims_json`: The raw JSON payload returned by the Pipeline.

### Segmented User History Tracking
When a user logs into TruthScope (via **Clerk Auth**), their unique `user_id` is passed from the Next.js frontend to the FastAPI backend. 

**How Deduplication works seamlessly with User Accounts:**
1. User A scans `nytimes.com/article`. The pipeline runs, costs AI tokens, and saves to the Database under User A's `user_id` and the `url_hash`.
2. User B (from the Chrome Extension) scans the exact same `nytimes.com/article`. 
3. The backend calculates the `url_hash`, sees that it already exists in the database.
4. **The Magic:** Instead of just returning the cache, the backend creates a *new row* in the `FactCheckReport` table containing the cached JSON report, but specifically links it to **User B's `user_id`**.
5. The result? User B instantly gets the verification (0 AI processing time), and the report beautifully shows up on User B's **History Page Dashboard**.

---

## 🔐 Authentication Ecosystem
1. **Next.js Frontend:** Uses `@clerk/nextjs` for powerful, drop-in social and email login. 
2. **Web API Communication:** The `userId` is pulled via the `useAuth()` hook on the Next.js client and securely injected into the JSON payload of the POST request to the backend.
3. **History Retrieval:** The `/fact-check/history` page queries the backend with `?user_id=xyz`. The Python backend filters the `FactCheckReport` table in NeonDB using SQLAlchemy (`query.filter(FactCheckReport.user_id == user_id)`) and returns only that strictly permissioned data. 

## 🚀 Summary
TruthScope is incredibly lean. By routing the Extension and Web App into the exact same unified NeonDB table, the platform becomes a communal fact-checking powerhouse. Every verification makes the platform faster for the next user, while perfectly segmenting personal history.
