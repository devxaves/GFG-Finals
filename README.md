<div align="center">
  <img src="extension/frontend/icon16.png" height="80" alt="TruthScope Logo">
  <h1>🛡️ TruthScope</h1>
  <p><strong>The Omniscient AI Fact-Checker & Media Forensics Engine</strong></p>
</div>

<br>

TruthScope is a deeply integrated, full-stack AI platform and browser extension designed to instantly combat misinformation as you browse. Combining high-speed fact verification, state-of-the-art deepfake detection, and bias analysis, it provides a transparent "truth layer" over the modern internet.

## 🚀 Key Features

*   **Real-Time Fact Verification:** Uses Tavily search pipelines coupled with Google's Gemini 2.5 Flash LLM to decompose paragraphs into atomic claims, querying live authoritative sources, and verifying them instantly.
*   **Deepfake & AI Media Forensics:** Seamlessly integrates with the Hugging Face Inference API (`umm-maybe/AI-image-detector`) to forensically scan images directly from your browser and flag synthetic, AI-generated media.
*   **Intelligent Highlighting:** The Chrome extension precisely anchors onto the exact HTML text nodes containing verified misinformation, highlighting them for the user without disrupting the page structure.
*   **Sentiment & Bias Profiling:** Scans articles to assign an objective bias and sentiment baseline, ensuring users are aware of potential psychological framing in their media.
*   **Chrome Sidebar Integration:** A beautiful, responsive Sidebar UI that dynamically maps fact-checked evidence into a "Related News" feed accompanied by AI-reasoning chains.

---

## 🏗️ Technical Architecture

TruthScope's infrastructure has been optimized for rapid, production-level deployment with strict separation of concerns:

1.  **Python FastAPI Core (`landing/fact-check-api`)**
    The heavy-lifting backend. Incoming text runs through a highly optimized Directed Acyclic Graph (DAG) pipeline:
    *   **Claim Extractor:** Decomposes complex paragraphs into independently verifiable facts.
    *   **Search Agent:** Uses the Tavily API to bypass generic scrape bans and securely fetch related academic & news context.
    *   **Verification Engine:** Passes the gathered evidence to an LLM evaluator to score the claim on a discrete confidence spectrum.
    *   **Media Analysis:** Proxies image binaries through Hugging Face pipelines for confidence scoring.
2.  **Next.js Web App (`landing/`)**
    The central hub and landing zone for the project ecosystem.
3.  **Chrome Extension (`extension/frontend`)**
    The interface layer. It uses isolated Context Scripts to extract the page DOM, passes it securely through Background Service Workers via Google OAuth 2.0 validation, and paints the results into the sidebar payload.

---

## 💻 Running Locally

### 1. The Fact-Checking Backend

Navigate to your command line and spin up the Python server. This will initialize the REST API and the LLM inference endpoints.

```cmd
cd landing\fact-check-api
.venv\Scripts\activate             
.venv\Scripts\pip install -r requirements.txt && .venv\Scripts\uvicorn main:app --reload --port 8000
```
*(Note: Be sure your `.env` contains your API Keys for Gemini, Tavily, and Hugging Face)*

### 2. The Chrome Extension

1.  Open your Chromium-based browser and navigate to `chrome://extensions/`.
2.  Enable **Developer mode** in the top right.
3.  Click **Load unpacked** and select the `/extension/frontend` directory.
4.  Pin the extension, run the backend, and start verifying the web!
